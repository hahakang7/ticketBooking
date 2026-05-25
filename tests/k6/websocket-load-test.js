
import ws from 'k6/ws';
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const WS_URL = __ENV.WS_URL || 'ws://localhost:3000';
const HTTP_URL = __ENV.HTTP_URL || 'http://localhost:3000';
const EVENT_ID = __ENV.EVENT_ID || 'evt-default';
const ACCESS_TOKEN = __ENV.ACCESS_TOKEN || 'test-token';

const messageReceived = new Counter('ws_messages_received');
const connectionErrors = new Counter('ws_connection_errors');
const seatUpdateLatency = new Trend('seat_update_latency_ms', true);
const connectionSuccess = new Rate('ws_connection_success_rate');

export const options = {
  scenarios: {
    concurrent_connections: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '1m',  target: 500 },
        { duration: '1m',  target: 1000 },
        { duration: '1m',  target: 1000 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    'seat_update_latency_ms': ['p(95)<100'],
    'ws_connection_success_rate': ['rate>0.95'],
    'ws_connection_errors': ['count<50'],
  },
};

// Socket.IO handshake를 HTTP polling으로 먼저 수행 후 WebSocket 업그레이드
function getSocketIOSid() {
  // Step 1: Engine.IO polling handshake
  const pollRes = http.get(
    `${HTTP_URL}/socket.io/?EIO=4&transport=polling`,
    { timeout: '5s' }
  );
  if (pollRes.status !== 200) return null;

  try {
    // 응답 형식: 숫자 접두사 제거 후 JSON 파싱
    // 예: "97:{...json...}"
    const body = pollRes.body;
    const jsonStart = body.indexOf('{');
    if (jsonStart === -1) return null;
    const data = JSON.parse(body.substring(jsonStart));
    return data.sid;
  } catch (_) {
    return null;
  }
}

export default function () {
  // Step 1: HTTP polling으로 sid 획득
  const sid = getSocketIOSid();
  if (!sid) {
    connectionErrors.add(1);
    connectionSuccess.add(0);
    sleep(1);
    return;
  }

  // Step 2: WebSocket으로 업그레이드 (sid 포함)
  const url = `${WS_URL}/socket.io/?EIO=4&transport=websocket&sid=${sid}`;

  const res = ws.connect(url, {
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
    }
  }, function (socket) {
    socket.on('open', function () {
      connectionSuccess.add(1);

      // Engine.IO 프로브 전송
      socket.send('2probe');

      socket.on('message', function (data) {
        // Engine.IO 제어 메시지 처리
        if (data === '3probe') {
          socket.send('5');  // upgrade 완료
          return;
        }
        if (data === '2') {
          socket.send('3');  // pong
          return;
        }

        // Socket.IO 메시지 처리 (42 접두사)
        if (data.startsWith('42')) {
          messageReceived.add(1);
          try {
            const payload = JSON.parse(data.substring(2));
            const [eventName, eventData] = payload;

            if (eventName === 'connection_info') {
              // 연결 확인 후 이벤트 구독
              // ✅ Socket.IO emit 형식: 42["event_name", data]
              socket.send(`42["subscribe_event",${JSON.stringify({
                event_id: EVENT_ID,
                access_token: ACCESS_TOKEN,
              })}]`);
            }

            if (eventName === 'seat_status_updated') {
              const timestamp = eventData?.timestamp
                ? new Date(eventData.timestamp).getTime()
                : Date.now();
              const latency = Date.now() - timestamp;
              seatUpdateLatency.add(Math.max(0, latency));

              check(eventData, {
                '좌석 업데이트에 event_id 포함': (d) => !!d?.event_id,
                '업데이트 배열 존재': (d) => Array.isArray(d?.updates),
              });
            }
          } catch (_) {}
        }
      });

      socket.on('error', function (e) {
        connectionErrors.add(1);
        connectionSuccess.add(0);
      });

      // 50초 후 연결 종료
      socket.setTimeout(function () {
        socket.close();
      }, 50000);
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