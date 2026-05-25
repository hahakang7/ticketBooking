import http from 'k6/http';
import { sleep, check, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ── 환경 변수 ──────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const EVENT_ID = __ENV.EVENT_ID || 'evt-default';

// ── 커스텀 메트릭 ──────────────────────────────────────────────
const queueJoinErrors = new Counter('queue_join_errors');
const queueJoinSuccess = new Counter('queue_join_success');
const queueJoinDuration = new Trend('queue_join_duration_ms', true);
const queueStatusDuration = new Trend('queue_status_duration_ms', true);
const errorRate = new Rate('error_rate');

// ── 테스트 시나리오 설정 ────────────────────────────────────────
// Queue API 부하 테스트
export const options = {
  scenarios: {
    // 기본 부하: 점진적으로 늘리고 줄이기
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
  // KPI 임계값: P95 < 300ms, 에러율 < 1%
  thresholds: {
    'http_req_duration': ['p(95)<300'],     // P95 300ms 이하
    'http_req_failed': ['rate<0.01'],       // 에러율 1% 이하
    'queue_join_duration_ms': ['p(95)<300'],
    'error_rate': ['rate<0.01'],
  },
};

// ── 공통 헤더 ──────────────────────────────────────────────────
const headers = { 'Content-Type': 'application/json' };

// ── 헬스 체크 (사전 조건 검증) ──────────────────────────────────
export function setup() {
  const res = http.get(`${BASE_URL}/health`);
  if (res.status !== 200) {
    throw new Error(`Core API is not healthy: ${res.status} - ${res.body}`);
  }
  console.log(`✅ Core API healthy: ${JSON.parse(res.body).status}`);

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

  // 각 가상 사용자는 고유한 user_id를 가짐
  // queue.py의 join_queue()는 동일 user_id면 ZADD 안 하고 기존 순번 반환
  const userId = `user-${__VU}-${__ITER}`;

  group('대기열 진입', function () {
    const startTime = Date.now();

    // POST /api/queue/join
    // queue_schema.py: QueueJoinRequest { user_id, event_id }
    const payload = JSON.stringify({
      user_id: userId,
      event_id: eventId,
    });

    const res = http.post(`${BASE_URL}/api/queue/join`, payload, { headers });
    const duration = Date.now() - startTime;
    queueJoinDuration.add(duration);

    const success = check(res, {
      '상태 코드 200': (r) => r.status === 200,
      '응답에 position 포함': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data && body.data.position !== undefined;
        } catch { return false; }
      },
      '응답에 queue_token 포함': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data && body.data.queue_token !== undefined;
        } catch { return false; }
      },
      'P95 300ms 이하': () => duration < 300,
    });

    if (success) {
      queueJoinSuccess.add(1);
      errorRate.add(0);
    } else {
      queueJoinErrors.add(1);
      errorRate.add(1);
    }

    // 대기열 진입 후 상태 조회
    if (res.status === 200) {
      sleep(0.5);

      // GET /api/queue/status?user_id=&event_id=
      const statusStart = Date.now();
      const statusRes = http.get(
        `${BASE_URL}/api/queue/status?user_id=${userId}&event_id=${eventId}`,
        { headers }
      );
      queueStatusDuration.add(Date.now() - statusStart);

      check(statusRes, {
        '상태 조회 200': (r) => r.status === 200,
        '순번 정보 포함': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.data && body.data.position !== undefined;
          } catch { return false; }
        },
      });
    }

    // rate_limiter.py: /api/queue/join = 1 req/sec per IP
    // 동일 IP에서 너무 빠르게 요청하면 429 응답 — 적절히 sleep
    sleep(1 + Math.random() * 0.5);
  });
}

// ── 테스트 종료 후 요약 출력 ────────────────────────────────────
export function teardown(data) {
  console.log('\n테스트 결과 요약:');
  console.log(`  이벤트 ID: ${data.eventId}`);
  console.log('  자세한 지표는 위의 k6 출력 확인');
}