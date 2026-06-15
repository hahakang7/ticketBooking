import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  scenarios: {
    step_load: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      // 3500 RPS × 0.3s(P95) = 1050 concurrent → 여유 있게 1500 preAlloc
      preAllocatedVUs: 1500,
      maxVUs: 5000,
      stages: [
        { target: 250,  duration: '3m' },  // Step 1: 250 req/s
        { target: 500,  duration: '3m' },  // Step 2: 500 req/s
        { target: 1000, duration: '3m' },  // Step 3: 1000 req/s
        { target: 2000, duration: '3m' },  // Step 4: 2000 req/s
        { target: 3500, duration: '5m' },  // Step 5: 3500 req/s (목표)
        { target: 0,    duration: '2m' },  // 쿨다운
      ],
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<300'],
    'http_req_failed': ['rate<0.10'],
  },
};

export default function () {
  // VU별 가상 IP: rate_limiter.py가 X-Forwarded-For 헤더를 우선 읽음
  const params = {
    headers: {
      'X-Forwarded-For': `10.${Math.floor(__VU / 256)}.${__VU % 256}.1`,
    },
    tags: { phase: 'step_load' },
  };

  // 인증 불필요한 이벤트 목록 조회 (읽기 부하 위주)
  const res = http.get(`${__ENV.BASE_URL}/api/v1/events?limit=10`, params);
  check(res, {
    'status 200': (r) => r.status === 200,
    'p95 target': (r) => r.timings.duration < 300,
  });
}
