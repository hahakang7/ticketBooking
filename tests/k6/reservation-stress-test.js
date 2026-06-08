import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// 409(좌석 충돌), 429(rate limit)는 비즈니스 로직상 예상된 응답 — 실패로 집계 제외
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 409, 429));

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const POLL_INTERVAL_S  = 2;   // queue/status 폴링 주기 (서버 SSE 주기와 동일)
const QUEUE_TIMEOUT_S  = 60;  // 대기열 최대 대기 시간

// 커스텀 메트릭
const reservationSuccess    = new Counter('reservation_success_total');
const reservationConflict   = new Counter('reservation_conflict_total');
const duplicateReservations = new Counter('duplicate_reservations_total');
const reservationDuration   = new Trend('reservation_duration_ms', true);
const paymentSuccessRate    = new Rate('payment_success_rate');
const queueWaitDuration     = new Trend('queue_wait_duration_ms', true);

export const options = {
  scenarios: {
    reservation_stress: {
      executor: 'constant-vus',
      vus: 50,
      duration: '120s',
    },
  },
  thresholds: {
    'http_req_duration':            ['p(95)<300'],
    'http_req_failed':              ['rate<0.05'],
    'duplicate_reservations_total': ['count<1'],   // ⭐ 핵심 KPI: 중복 예매 0건
    'reservation_duration_ms':      ['p(95)<300'],
    'payment_success_rate':         ['rate>0.9'],
  },
};

export function setup() {
  const healthRes = http.get(`${BASE_URL}/health`);
  if (healthRes.status !== 200) {
    throw new Error(`Core API not healthy: ${healthRes.status}`);
  }

  // 실제 이벤트 + 좌석 UUID 조회
  const eventsRes = http.get(`${BASE_URL}/api/v1/events`);
  if (eventsRes.status !== 200) throw new Error(`이벤트 목록 조회 실패: ${eventsRes.status}`);

  const items = JSON.parse(eventsRes.body).data?.items ?? [];
  if (!items.length) throw new Error('이벤트가 없습니다');

  const eventId = items[0].event_id;

  const seatsRes = http.get(`${BASE_URL}/api/v1/events/${eventId}/seats`);
  if (seatsRes.status !== 200) throw new Error(`좌석 조회 실패: ${seatsRes.status}`);

  const allSeats = JSON.parse(seatsRes.body).data?.items ?? [];
  const available = allSeats
    .filter(s => s.status === 'available')
    .slice(0, 100)
    .map(s => ({ seat_id: s.seat_id, price: parseFloat(s.price) || 0 }));

  if (!available.length) throw new Error('예약 가능한 좌석이 없습니다');

  console.log(`이벤트: ${eventId}, 가용 좌석: ${available.length}개`);
  return { eventId, seats: available };
}

export default function (data) {
  const { eventId, seats } = data;
  // DB users 테이블에 삽입된 UUID 형식 (10000000-0000-0000-0000-000000000001 ~ 50)
  const vuHex = __VU.toString(16).padStart(12, '0');
  const userId = `10000000-0000-0000-0000-${vuHex}`;

  // ── Step 1: 대기열 진입 ──────────────────────────────────────────
  let queueToken = null;

  group('1. 대기열 진입', function () {
    for (let retry = 0; retry < 3; retry++) {
      const res = http.post(
        `${BASE_URL}/api/queue/join`,
        JSON.stringify({ user_id: userId, event_id: eventId }),
        { headers: { 'Content-Type': 'application/json' } }
      );

      if (res.status === 429) {
        sleep(1);  // rate limiter 대기 후 재시도
        continue;
      }

      const ok = check(res, {
        '대기열 진입 성공 (200)': (r) => r.status === 200,
        'queue_token 포함':       (r) => {
          try { return !!JSON.parse(r.body).data?.queue_token; } catch { return false; }
        },
      });

      if (ok) {
        try { queueToken = JSON.parse(res.body).data.queue_token; } catch { /* ignore */ }
      }
      break;
    }
  });

  if (!queueToken) return;

  // ── Step 2: 폴링으로 position=1 대기 ────────────────────────────
  // SSE 대신 /api/queue/status 를 2초마다 폴링
  // position=1 도달 후 SSE 단 1회 호출 → 서버가 즉시 access_token 발급 후 종료
  let accessToken = null;

  group('2. 대기열 순번 대기 (폴링)', function () {
    const waitStart = Date.now();
    const deadline  = waitStart + QUEUE_TIMEOUT_S * 1000;
    let   ready     = false;

    while (Date.now() < deadline) {
      const res = http.get(
        `${BASE_URL}/api/queue/status?user_id=${userId}&event_id=${eventId}`,
        {
          headers: { 'Authorization': `Bearer ${queueToken}` },
          tags: { name: 'queue_status_poll' },
        }
      );

      if (res.status !== 200) break;

      let body;
      try { body = JSON.parse(res.body).data; } catch { break; }

      if (!body?.is_in_queue) break;   // 큐에서 제거됨

      if (body.position === 1) {
        ready = true;
        break;
      }

      sleep(POLL_INTERVAL_S);
    }

    queueWaitDuration.add(Date.now() - waitStart);
    check(null, { '대기열 position=1 도달': () => ready });

    if (!ready) return;

    // position=1 확인 후 SSE 단 1회 — 서버가 즉시 access_token 발급 후 연결 종료
    const sseRes = http.get(
      `${BASE_URL}/api/queue/sse?user_id=${userId}&event_id=${eventId}&queue_token=${queueToken}`,
      {
        headers: { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' },
        timeout: '10s',   // 즉시 응답해야 하므로 짧게 설정
        tags: { name: 'queue_sse_consume' },
      }
    );

    check(sseRes, { 'SSE access_token 수신 (200)': (r) => r.status === 200 });

    if (sseRes.status === 200) {
      for (const line of (sseRes.body || '').split('\n')) {
        if (!line.startsWith('data:')) continue;
        try {
          const payload = JSON.parse(line.slice(5).trim());
          if (payload.access_token) { accessToken = payload.access_token; break; }
        } catch { /* ignore */ }
      }
    }
  });

  if (!accessToken) return;

  const authHeader = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` };

  // ── Step 3: 좌석 예약 (최대 5회, 409 시 다음 좌석) ──────────────
  let reservationId = null;
  let reservedPrice = 0;
  const baseIdx = __VU % seats.length;

  group('3. 좌석 예약 (분산 락 검증)', function () {
    for (let attempt = 0; attempt < 5; attempt++) {
      const seat  = seats[(baseIdx + attempt) % seats.length];
      const start = Date.now();

      const res = http.post(
        `${BASE_URL}/api/v1/reservations`,
        JSON.stringify({ seat_ids: [seat.seat_id] }),
        { headers: authHeader }
      );

      reservationDuration.add(Date.now() - start);

      if (res.status === 200 || res.status === 201) {
        reservationSuccess.add(1);
        reservedPrice = seat.price;
        try {
          const body = JSON.parse(res.body);
          reservationId = body.data?.reservation_id ?? body.reservation_id;
        } catch { /* ignore */ }

        check(res, {
          '예약 성공':           () => true,
          'reservation_id 포함': () => !!reservationId,
        });
        break;

      } else if (res.status === 409) {
        reservationConflict.add(1);
        check(res, { '충돌 정상 처리 (409)': (r) => r.status === 409 });

      } else if (res.status === 429) {
        // rate limiter — retry_after만큼 대기 후 재시도 (attempt 소모 안 함)
        let retryAfter = 1;
        try { retryAfter = JSON.parse(res.body).data?.retry_after || 1; } catch { /* ignore */ }
        sleep(retryAfter);
        attempt--;  // 이 attempt는 소모하지 않음

      } else if (res.status === 401 || res.status === 403) {
        console.error(`인증 실패 (${res.status}) — VU ${__VU}`);
        break;

      } else {
        // 5xx 등 예상 외 오류만 중복 예매 가능성으로 카운트
        console.error(`예약 오류 (${res.status}): ${res.body}`);
        if (res.status >= 500) duplicateReservations.add(1);
        break;
      }
    }
  });

  if (!reservationId) return;

  // ── Step 4: 결제 (PG 실패 시 최대 3회 재시도) ───────────────────
  group('4. 결제', function () {
    let succeeded = false;

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = http.post(
        `${BASE_URL}/api/v1/payments`,
        JSON.stringify({
          reservation_id: reservationId,
          payment_method: 'card',
          amount:         reservedPrice || 0,
        }),
        { headers: authHeader }
      );

      if (res.status === 200 || res.status === 201) {
        succeeded = true;
        break;
      }

      // 409: PG declined — 재시도 (서버가 95% 성공 시뮬레이션)
      if (res.status === 409) {
        console.warn(`결제 PG 거절 (시도 ${attempt + 1}/3), 재시도...`);
        sleep(0.5);
        continue;
      }

      console.warn(`결제 실패 (${res.status}): ${res.body}`);
      break;
    }

    paymentSuccessRate.add(succeeded);
    check(null, { '결제 성공': () => succeeded });
  });
}
