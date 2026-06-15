import http from 'k6/http';
import { sleep, check, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ── 환경 변수 ──────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const EVENT_ID = __ENV.EVENT_ID || 'evt-default';
const FLASH_RATE = parseInt(__ENV.FLASH_RATE || '5000');

// ── 커스텀 메트릭 ──────────────────────────────────────────────
const queueJoinErrors = new Counter('queue_join_errors');
const queueJoinSuccess = new Counter('queue_join_success');
const queueJoinDuration = new Trend('queue_join_duration_ms', true);
const queueStatusDuration = new Trend('queue_status_duration_ms', true);
const errorRate = new Rate('error_rate');

// ── 테스트 시나리오 설정 ────────────────────────────────────────
// Queue API 부하 테스트
//
// 실행 방법:
//   전체 (ramp_up_down → flash_crowd 순차):
//     k6 run tests/k6/queue-load-test.js
//
//   스모크 테스트 (ramp_up_down만):
//     k6 run -e SKIP_FLASH=true tests/k6/queue-load-test.js
//
//   Flash Crowd 2000 req/s:
//     k6 run -e FLASH_RATE=2000 -e FLASH_VUS=200 tests/k6/queue-load-test.js
//
//   Flash Crowd 커스텀 req/s:
//     k6 run -e FLASH_RATE=3000 -e FLASH_VUS=300 tests/k6/queue-load-test.js

// Flash Crowd 시나리오 (SKIP_FLASH=true면 제외)
const flashScenario = __ENV.SKIP_FLASH === 'true' ? {} : {
  flash_crowd: {
    executor: 'ramping-arrival-rate',
    startTime: '210s',
    startRate: 0,
    timeUnit: '1s',
    preAllocatedVUs: parseInt(__ENV.FLASH_VUS || '500'),
    maxVUs: Math.max(FLASH_RATE, parseInt(__ENV.FLASH_VUS || '500')),
    stages: [
      { duration: '30s', target: FLASH_RATE },  // 급증
      { duration: '2m',  target: FLASH_RATE },  // 유지
      { duration: '30s', target: 0 },           // 감소
    ],
  },
};

const baseOptions = {
  scenarios: {
    // 기본 부하: 점진적으로 늘리고 줄이기 (총 3m30s)
    ramp_up_down: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },   // 30초 동안 10명으로 증가
        { duration: '1m',  target: 50 },   // 1분 동안 50명으로 증가
        { duration: '30s', target: 100 },  // 30초 동안 100명으로 증가
        { duration: '1m',  target: 100 },  // 1분 동안 100명 유지
        { duration: '30s', target: 0 },    // 30초 동안 0으로 감소
      ],
    },
  },
  // KPI 임계값: P95 < 300ms, 에러율 < 5%
  thresholds: {
    'http_req_duration': ['p(95)<300'],
    //'http_req_failed': ['rate<0.01'],       // 에러율 1% 이하
    'queue_join_duration_ms': ['p(95)<300'],
    'error_rate': ['rate<0.05'],
  },
};

// Flash Crowd 시나리오 동적 추가
if (__ENV.SKIP_FLASH !== 'true') {
  baseOptions.scenarios.flash_crowd = flashScenario.flash_crowd;
}

export const options = baseOptions;

// ── 공통 헤더 ──────────────────────────────────────────────────
const headers = { 'Content-Type': 'application/json' };

// ── 헬스 체크 (사전 조건 검증) ──────────────────────────────────
export function setup() {
  const res = http.get(`${BASE_URL}/health`);
  if (res.status !== 200) {
    throw new Error(`Core API is not healthy: ${res.status} - ${res.body}`);
  }
  console.log(`Core API healthy: ${JSON.parse(res.body).status}`);

  // 이벤트 목록 조회해서 실제 event_id 가져오기
  const eventsRes = http.get(`${BASE_URL}/api/v1/events`);
  if (eventsRes.status === 200) {
    const events = JSON.parse(eventsRes.body);
    if (events.data && events.data.items && events.data.items.length > 0) {
      return { eventId: events.data.items[0].event_id };
    }
  }
  return { eventId: EVENT_ID };
}

// ── 메인 테스트 시나리오 ────────────────────────────────────────
export default function (data) {
  const eventId = data.eventId || EVENT_ID;

  // 같은 VU는 같은 userId 재사용 (이미 있으면 현재 순번 반환)
  const userId = `load-test-user-${__VU}`;  // __ITER 제거

  group('대기열 진입', function () {
    const startTime = Date.now();

    const payload = JSON.stringify({
      user_id: userId,
      event_id: eventId,
    });

    const res = http.post(`${BASE_URL}/api/queue/join`, payload, { headers });
    const duration = Date.now() - startTime;
    queueJoinDuration.add(duration);

    const success = check(res, {
      '상태 코드 200 또는 429': (r) => r.status === 200 || r.status === 429,
      '200일 때 position 포함': (r) => {
        if (r.status !== 200) return true;
        try {
          const body = JSON.parse(r.body);
          return body?.data?.position !== undefined;
        } catch { return false; }
      },
    });

    if (res.status === 200) {
      queueJoinSuccess.add(1);
      errorRate.add(0);
    } else if (res.status === 429) {
      errorRate.add(0);
    } else {
      queueJoinErrors.add(1);
      errorRate.add(1);
    }

    if (res.status === 200) {
      // join 응답에서 queue_token 추출
      const joinBody = JSON.parse(res.body);
      const queueToken = joinBody?.data?.queue_token;
      const authHeaders = {
        ...headers,
        'Authorization': `Bearer ${queueToken}`,
      };

      sleep(0.5);
      const statusRes = http.get(
        `${BASE_URL}/api/queue/status?user_id=${userId}&event_id=${eventId}`,
        { headers: authHeaders }
      );
      queueStatusDuration.add(Date.now() - startTime - 500);

      check(statusRes, {
        '상태 조회 200': (r) => r.status === 200,
        '상태 조회 position 포함': (r) => {
          try { return JSON.parse(r.body)?.data?.position !== undefined; }
          catch { return false; }
        },
      });
    }

    sleep(1.0);
  });
}

// ── 테스트 종료 후 요약 출력 ────────────────────────────────────
export function teardown(data) {
  // /api/queue/leave 엔드포인트 미구현으로 별도 정리 불필요
  // Redis TTL에 의해 대기열 항목이 자동 만료됨
  console.log(`\n 테스트 완료. eventId: ${data.eventId}`);
  console.log(' 대기열 항목은 Redis TTL로 자동 정리됩니다.');
}