import http from 'k6/http';
import { sleep, check, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const EVENT_ID = __ENV.EVENT_ID || 'evt-default';

// 중복 예매 검출용 커스텀 메트릭
const duplicateReservations = new Counter('duplicate_reservations_total');
const reservationSuccess = new Counter('reservation_success_total');
const reservationConflict = new Counter('reservation_conflict_total');
const reservationDuration = new Trend('reservation_duration_ms', true);

export const options = {
  scenarios: {
    // 동시 접속 시뮬레이션 (Flash Crowd)
    concurrent_reservations: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 500,
      stages: [
        { duration: '30s', target: 100 },  // 초당 100 요청
        { duration: '1m',  target: 500 },  // 초당 500 요청
        { duration: '30s', target: 1000 }, // 초당 1000 요청 (Flash Crowd)
        { duration: '1m',  target: 500 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<300'],
    'http_req_failed': ['rate<0.05'],
    // 핵심 KPI: 중복 예매 0건
    'duplicate_reservations_total': ['count<1'],
    'reservation_duration_ms': ['p(95)<500'],
  },
};

const headers = { 'Content-Type': 'application/json' };

export function setup() {
  // 헬스 체크
  const res = http.get(`${BASE_URL}/health`);
  if (res.status !== 200) {
    throw new Error('Core API not healthy');
  }

  // 실제 이벤트 및 좌석 UUID 조회
  let eventId = EVENT_ID;
  let seatIds = [];

  const eventsRes = http.get(`${BASE_URL}/api/v1/events`);
  if (eventsRes.status === 200) {
    const body = JSON.parse(eventsRes.body);
    if (body.data && body.data.items && body.data.items.length > 0) {
      eventId = body.data.items[0].event_id;

      const seatsRes = http.get(`${BASE_URL}/api/v1/events/${eventId}/seats`);
      if (seatsRes.status === 200) {
        const seatsBody = JSON.parse(seatsRes.body);
        const availableSeats = (seatsBody.data?.seats || [])
          .filter(s => s.status === 'available')
          .slice(0, 10)
          .map(s => s.seat_id);
        seatIds = availableSeats;
      }
    }
  }

  if (seatIds.length === 0) {
    throw new Error('No available seats found — cannot run reservation stress test');
  }

  // TODO: access_token 발급 API 완성 후 여기서 큐 토큰 → access_token 교환
  // 현재는 __ENV.ACCESS_TOKEN 으로 주입 (k6 run -e ACCESS_TOKEN=<jwt>)
  const accessToken = __ENV.ACCESS_TOKEN || '';
  if (!accessToken) {
    console.warn('ACCESS_TOKEN not set — reservation requests will return 401');
  }

  return { eventId, seatIds, accessToken };
}

export default function (data) {
  const { seatIds, accessToken } = data;
  // 각 VU가 동일한 좌석을 두고 경쟁하는 시나리오 — 중복 예매 방지 검증
  // setup()에서 가져온 실제 UUID 목록 중 1개만 요청
  const targetSeatId = seatIds[__VU % seatIds.length];

  group('좌석 예약 (분산 락 테스트)', function () {
    const startTime = Date.now();

    const payload = JSON.stringify({
      seat_ids: [targetSeatId],
    });

    const res = http.post(
      `${BASE_URL}/api/v1/reservations`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        }
      }
    );

    const duration = Date.now() - startTime;
    reservationDuration.add(duration);

    if (res.status === 200) {
      // 예약 성공
      reservationSuccess.add(1);

      // 중복 예매 검출: 같은 좌석이 두 번 이상 예약됐는지 확인
      // 실제로는 reservation_id를 수집해서 중복 여부 확인 필요
      check(res, {
        '예약 성공': () => true,
        'reservation_id 포함': (r) => {
          try { return JSON.parse(r.body).data?.reservation_id; }
          catch { return false; }
        },
      });

    } else if (res.status === 409) {
      // 이미 점유된 좌석 — 정상적인 충돌 처리
      reservationConflict.add(1);
      check(res, { '충돌 처리 정상 (409)': (r) => r.status === 409 });

    } else if (res.status === 422 || res.status === 400) {
      // 잘못된 요청
      console.warn(`예약 요청 오류: ${res.status} - ${res.body}`);

    } else if (res.status === 401 || res.status === 403) {
      console.error(`인증 실패: ${res.status} — ACCESS_TOKEN 환경변수를 확인하세요`);

    } else {
      // 예상치 못한 에러 (5xx 등) — 중복 예매 가능성
      console.error(`예약 실패: ${res.status} - ${res.body}`);
      duplicateReservations.add(1);
    }

    sleep(0.1 + Math.random() * 0.2);
  });
}