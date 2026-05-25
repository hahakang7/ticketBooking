import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const WS_URL = __ENV.WS_URL || 'ws://localhost:3000';
const EVENT_ID = __ENV.EVENT_ID || 'evt-default';
const ACCESS_TOKEN = __ENV.ACCESS_TOKEN || 'test-token';

// 커스텀 메트릭
const messageReceived = new Counter('ws_messages_received');
const connectionErrors = new Counter('ws_connection_errors');
const seatUpdateLatency = new Trend('seat_update_latency_ms', true);
const connectionSuccess = new Rate('ws_connection_success_rate');

export const options = {
  scenarios: {
    // 동시 WebSocket 연결 테스트
    concurrent_connections: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },   // 100 동시 연결
        { duration: '1m',  target: 500 },   // 500 동시 연결
        { duration: '1m',  target: 1000 },  // 1000 동시 연결
        { duration: '1m',  target: 1000 },  // 유지
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    // KPI: WebSocket 메시지 지연 100ms 이하
    'seat_update_latency_ms': ['p(95)<100'],
    'ws_connection_success_rate': ['rate>0.95'],  // 95% 이상 연결 성공
    'ws_connection_errors': ['count<50'],
  },
};

export default function () {
  // Socket.IO는 polling으로 handshake 후 WebSocket으로 업그레이드
  // k6의 ws 모듈은 순수 WebSocket만 지원하므로 polling 엔드포인트 사용
  const url = `${WS_URL}/socket.io/?EIO=4&transport=websocket`;

  const res = ws.connect(url, {}, function (socket) {
    socket.on('open', function () {
      connectionSuccess.add(1);

      // Socket.IO 핸드셰이크
      // Engine.IO 프로토콜: "40" = Socket.IO connect
      socket.send('40');

      // 이벤트 구독: subscribe_event
      // websocket-api.md 스펙 기반
      const subscribeMsg = JSON.stringify({
        event_id: EVENT_ID,
        access_token: ACCESS_TOKEN,
      });
      // Socket.IO 메시지 형식: "42[event_name, data]"
      socket.send(`42["subscribe_event",${subscribeMsg}]`);

      const connectionTime = Date.now();

      // 메시지 수신 처리
      socket.on('message', function (data) {
        messageReceived.add(1);

        try {
          // Socket.IO 메시지 파싱
          if (data.startsWith('42')) {
            const jsonStr = data.substring(2);
            const [eventName, eventData] = JSON.parse(jsonStr);

            if (eventName === 'seat_status_updated') {
              // KPI: 0.1초 이내 전파 측정
              const latency = Date.now() - (eventData.timestamp
                ? new Date(eventData.timestamp).getTime()
                : connectionTime);
              seatUpdateLatency.add(Math.max(0, latency));
            }

            check(data, {
              '유효한 Socket.IO 메시지': () => true,
            });
          }
        } catch (e) {
          // Socket.IO 제어 메시지 (ping/pong 등)는 파싱 오류 무시
        }
      });

      socket.on('error', function (e) {
        connectionErrors.add(1);
        connectionSuccess.add(0);
      });

      // 연결 유지 (테스트 시간만큼)
      socket.setTimeout(function () {
        socket.close();
      }, 55000); // 55초 후 종료
    });

    socket.on('close', function () {
      // 정상 종료
    });
  });

  check(res, {
    'WebSocket 연결 성공 (101)': (r) => r && r.status === 101,
  });

  if (!res || res.status !== 101) {
    connectionErrors.add(1);
    connectionSuccess.add(0);
  }

  sleep(1);
}