/**
 * 티켓 오픈 시나리오 부하 테스트
 *
 * 트래픽 패턴:
 *   [오픈 5분 전] 0 → PRE_VUS 완만한 상승  (이벤트 페이지 조회)
 *   [오픈 순간]   15초 만에 PEAK_VUS 수직 상승
 *   [피크 5분]    PEAK_VUS 유지 (대기열 → 예약 → 결제 풀 플로우)
 *   [마무리]      30초 감소
 *
 * 실행:
 *   # 기본 (EKS, PEAK 200 VU)
 *   k6 run -e BASE_URL=http://<INGRESS_IP>:8000 tests/k6/ticket-open-scenario.js
 *
 *   # 로컬 경량 테스트
 *   k6 run -e BASE_URL=http://localhost:8000 -e PEAK_VUS=30 -e PRE_VUS=10 tests/k6/ticket-open-scenario.js
 *
 * 발표 시연 비교:
 *   1) LSTM 예측 스케일링 OFF → 오픈 순간 레이턴시 스파이크 확인
 *   2) LSTM 예측 스케일링 ON  → 선제 스케일업으로 스파이크 없음 확인
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL      = __ENV.BASE_URL  || 'http://localhost:8000';
const PEAK_VUS      = parseInt(__ENV.PEAK_VUS  || '200');
const PRE_VUS       = parseInt(__ENV.PRE_VUS   || '50');
const MAX_SEED_USERS = 200;  // seed.py 생성 k6 유저 수

// 커스텀 메트릭
const reservationSuccess    = new Counter('reservation_success_total');
const reservationConflict   = new Counter('reservation_conflict_total');
const duplicateReservations = new Counter('duplicate_reservations_total');
const reservationDuration   = new Trend('reservation_duration_ms', true);
const paymentSuccessRate    = new Rate('payment_success_rate');
const queueWaitDuration     = new Trend('queue_wait_duration_ms', true);

export const options = {
  scenarios: {
    // ── 오픈 전: 사용자들이 이벤트 페이지 조회하며 대기 ────────────────
    pre_open_traffic: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m',  target: PRE_VUS },  // 완만한 상승 (오픈 1분 전)
        { duration: '1m',  target: 0 },         // 피크 끝나면 자연 감소
      ],
      exec: 'browseEvents',
      tags: { phase: 'pre_open' },
      gracefulStop: '10s',
    },

    // ── 오픈 순간: 수직 상승 → 2분 피크 유지 ───────────────────────────
    open_spike: {
      executor: 'ramping-vus',
      startTime: '1m',   // 오픈 시점
      startVUs: 0,
      stages: [
        { duration: '15s', target: PEAK_VUS },  // 15초 만에 수직 상승
        { duration: '2m',  target: PEAK_VUS },  // 2분 피크 유지
        { duration: '15s', target: 0 },          // 마무리
      ],
      exec: 'fullTicketFlow',
      tags: { phase: 'open_spike' },
      gracefulStop: '30s',
    },
  },

  thresholds: {
    // 전체 KPI
    'http_req_duration':                    ['p(95)<300'],
    'http_req_failed':                      ['rate<0.05'],
    'duplicate_reservations_total':         ['count<1'],
    'reservation_duration_ms':              ['p(95)<300'],
    'payment_success_rate':                 ['rate>0.9'],
    // 오픈 순간만 별도 — 5xx 1% 미만
    'http_req_failed{phase:open_spike}':    ['rate<0.01'],
  },
};

// ── setup: 이벤트/좌석 ID 조회 ────────────────────────────────────────────
export function setup() {
  const healthRes = http.get(`${BASE_URL}/health`);
  if (healthRes.status !== 200) {
    throw new Error(`Core API not healthy: ${healthRes.status}`);
  }

  const eventsRes = http.get(`${BASE_URL}/api/v1/events`);
  if (eventsRes.status !== 200) throw new Error(`이벤트 목록 조회 실패: ${eventsRes.status}`);

  const items = JSON.parse(eventsRes.body).data?.items ?? [];
  if (!items.length) throw new Error('이벤트가 없습니다. seed 데이터를 확인하세요.');

  const eventId = items[0].event_id;
  const seatsRes = http.get(`${BASE_URL}/api/v1/events/${eventId}/seats`);
  if (seatsRes.status !== 200) throw new Error(`좌석 조회 실패: ${seatsRes.status}`);

  const allSeats = JSON.parse(seatsRes.body).data?.items ?? [];
  const available = allSeats
    .filter(s => s.status === 'available')
    .slice(0, 300)
    .map(s => ({ seat_id: s.seat_id, price: parseFloat(s.price) || 0 }));

  if (!available.length) throw new Error('예약 가능한 좌석이 없습니다.');

  console.log(`이벤트: ${eventId}, 가용 좌석: ${available.length}개, PEAK_VUS: ${PEAK_VUS}`);
  return { eventId, seats: available };
}

// ── 오픈 전 시나리오: 이벤트 페이지 조회 (인증 불필요) ───────────────────
export function browseEvents(data) {
  const { eventId } = data;

  group('이벤트 조회 (오픈 대기)', function () {
    http.get(`${BASE_URL}/api/v1/events`, { tags: { name: 'event_list' } });
    sleep(1);
    http.get(`${BASE_URL}/api/v1/events/${eventId}`, { tags: { name: 'event_detail' } });
    sleep(1);
    http.get(`${BASE_URL}/api/v1/events/${eventId}/seats`, { tags: { name: 'seats_browse' } });
    sleep(Math.random() * 2 + 1);  // 1~3초 랜덤 대기 (실제 사용자처럼)
  });
}

// ── 오픈 후 시나리오: 대기열 → 예약 → 결제 풀 플로우 ────────────────────
export function fullTicketFlow(data) {
  const { eventId, seats } = data;

  // seed.py 에 등록된 200명 유저 풀에서 VU 번호로 매핑
  const userIdx = ((__VU - 1) % MAX_SEED_USERS) + 1;
  const vuHex   = userIdx.toString(16).padStart(12, '0');
  const userId  = `10000000-0000-0000-0000-${vuHex}`;

  let queueToken = null;

  // ── 1단계: 대기열 진입 ────────────────────────────────────────────────
  group('1. 대기열 진입', function () {
    for (let retry = 0; retry < 3; retry++) {
      const res = http.post(
        `${BASE_URL}/api/queue/join`,
        JSON.stringify({ user_id: userId, event_id: eventId }),
        { headers: { 'Content-Type': 'application/json' } }
      );

      if (res.status === 429) { sleep(1); continue; }

      check(res, { '대기열 진입 성공 (200)': r => r.status === 200 });
      try { queueToken = JSON.parse(res.body).data.queue_token; } catch {}
      break;
    }
  });

  if (!queueToken) return;

  let accessToken = null;

  // ── 2단계: 대기열 순번 폴링 → position=1 도달 → SSE access_token 발급 ──
  group('2. 대기열 대기', function () {
    const waitStart = Date.now();
    const deadline  = waitStart + 60 * 1000;   // 1분 타임아웃

    while (Date.now() < deadline) {
      const res = http.get(
        `${BASE_URL}/api/queue/status?user_id=${userId}&event_id=${eventId}`,
        { headers: { 'Authorization': `Bearer ${queueToken}` } }
      );

      if (res.status !== 200) break;

      let body;
      try { body = JSON.parse(res.body).data; } catch { break; }
      if (!body?.is_in_queue) break;

      if (body.position === 1) {
        const sseRes = http.get(
          `${BASE_URL}/api/queue/sse?user_id=${userId}&event_id=${eventId}&queue_token=${queueToken}`,
          { headers: { 'Accept': 'text/event-stream' }, timeout: '10s' }
        );
        for (const line of (sseRes.body || '').split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            const p = JSON.parse(line.slice(5).trim());
            if (p.access_token) { accessToken = p.access_token; break; }
          } catch {}
        }
        break;
      }
      sleep(2);
    }

    queueWaitDuration.add(Date.now() - waitStart);
    check(null, { 'access_token 발급': () => !!accessToken });
  });

  if (!accessToken) return;

  const authHeader = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` };
  let reservationId = null;
  let reservedPrice = 0;
  const baseIdx = userIdx % seats.length;

  // ── 3단계: 좌석 예약 (Redlock 동시성 검증) ───────────────────────────
  group('3. 좌석 예약', function () {
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
        try { reservationId = JSON.parse(res.body).data?.reservation_id; } catch {}
        break;
      } else if (res.status === 409) {
        reservationConflict.add(1);
      } else if (res.status === 429) {
        let retryAfter = 1;
        try { retryAfter = JSON.parse(res.body).data?.retry_after || 1; } catch {}
        sleep(retryAfter);
        attempt--;
      } else if (res.status >= 500) {
        duplicateReservations.add(1);
        break;
      } else {
        break;
      }
    }
  });

  if (!reservationId) return;

  // ── 4단계: 결제 ──────────────────────────────────────────────────────
  group('4. 결제', function () {
    let succeeded = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = http.post(
        `${BASE_URL}/api/v1/payments`,
        JSON.stringify({
          reservation_id: reservationId,
          payment_method: 'card',
          amount: reservedPrice || 0,
        }),
        { headers: authHeader }
      );
      if (res.status === 200 || res.status === 201) { succeeded = true; break; }
      if (res.status === 409) { sleep(0.5); continue; }
      break;
    }
    paymentSuccessRate.add(succeeded);
    check(null, { '결제 성공': () => succeeded });
  });
}
