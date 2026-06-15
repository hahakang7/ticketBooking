import http from 'k6/http';
import { sleep, check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

const queueJoinDuration = new Trend('queue_join_duration_ms', true);
const errorRate = new Rate('error_rate');

export const options = {
  scenarios: {
    ramp_up_down: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m',  target: 50 },
        { duration: '30s', target: 100 },
        { duration: '1m',  target: 100 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<300'],
    'queue_join_duration_ms': ['p(95)<300'],
    'error_rate': ['rate<0.05'],
  },
};

const headers = { 'Content-Type': 'application/json' };

export function setup() {
  const res = http.get(BASE_URL + '/health');
  if (res.status !== 200) {
    throw new Error('Health check failed');
  }
}

export default function() {
  const userId = 'user-' + __VU;
  const eventId = '550e8400-e29b-41d4-a716-446655440000';

  const startTime = new Date().getTime();
  const res = http.post(
    BASE_URL + '/api/queue/join',
    JSON.stringify({ user_id: userId, event_id: eventId }),
    { headers: headers }
  );
  const duration = new Date().getTime() - startTime;

  queueJoinDuration.add(duration);

  if (res.status === 200 || res.status === 429) {
    check(res, {
      'queue join success': (r) => r.status === 200 || r.status === 429,
    });
  } else {
    errorRate.add(1);
    check(res, {
      'queue join failed': (r) => r.status === 200 || r.status === 429,
    });
  }

  sleep(0.5);
}
