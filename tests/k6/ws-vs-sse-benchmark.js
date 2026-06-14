/**
 * k6 WS vs SSE 성능 비교 벤치마크
 *
 * 사전 준비:
 *   1. Redis:          docker run -d -p 6379:6379 redis:7-alpine
 *   2. WebSocket 서비스: cd apps/websocket-service && npm start
 *   3. Redis 발행자:    node tests/benchmark/redis-publisher.js (선택 — latency 측정 시)
 *   4. k6 실행:        k6 run tests/k6/ws-vs-sse-benchmark.js
 *
 * 환경 변수:
 *   WS_URL       WebSocket 서비스 주소 (기본: ws://localhost:3000)
 *   HTTP_URL     SSE 서비스 주소      (기본: http://localhost:3000)
 *   EVENT_ID     이벤트 UUID          (기본: test-event-bench-001)
 *   ACCESS_TOKEN JWT access token     (기본: test-token)
 *   SCENARIO     'ws' | 'sse' | 'both' (기본: both)
 */

import ws from 'k6/ws'
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter, Rate, Trend, Gauge } from 'k6/metrics'

const WS_URL      = __ENV.WS_URL      || 'ws://localhost:3000'
const HTTP_URL    = __ENV.HTTP_URL    || 'http://localhost:3000'
const EVENT_ID    = __ENV.EVENT_ID    || 'test-event-bench-001'
const ACCESS_TOKEN = __ENV.ACCESS_TOKEN || 'test-token'
const SCENARIO    = __ENV.SCENARIO    || 'both'

// ── WebSocket 메트릭 ──────────────────────────────────
const wsConnTime      = new Trend('ws_connection_time_ms',  true)
const wsLatency       = new Trend('ws_message_latency_ms',  true)
const wsMsgReceived   = new Counter('ws_messages_received')
const wsConnErrors    = new Counter('ws_connection_errors')
const wsConnSuccess   = new Rate('ws_connection_success_rate')

// ── SSE 메트릭 ────────────────────────────────────────
const sseConnTime     = new Trend('sse_connection_time_ms', true)
const sseLatency      = new Trend('sse_message_latency_ms', true)
const sseMsgReceived  = new Counter('sse_messages_received')
const sseConnErrors   = new Counter('sse_connection_errors')
const sseConnSuccess  = new Rate('sse_connection_success_rate')

// ── 비교 메트릭 ───────────────────────────────────────
const connTimeDelta   = new Trend('conn_time_delta_ws_minus_sse_ms', true)

export const options = {
  scenarios: {
    // WebSocket 동시 연결 부하
    ws_load: {
      executor: 'ramping-vus',
      exec: 'runWebSocket',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 50  },
        { duration: '30s', target: 100 },
        { duration: '20s', target: 200 },
        { duration: '20s', target: 0   },
      ],
      env: { SCENARIO: 'ws' },
    },
    // SSE 동시 연결 부하 — ws_load 와 30초 차이로 순차 실행
    sse_load: {
      executor: 'ramping-vus',
      exec: 'runSSE',
      startVUs: 0,
      startTime: '100s',   // ws_load 완료 후 시작
      stages: [
        { duration: '20s', target: 50  },
        { duration: '30s', target: 100 },
        { duration: '20s', target: 200 },
        { duration: '20s', target: 0   },
      ],
      env: { SCENARIO: 'sse' },
    },
  },
  thresholds: {
    'ws_connection_time_ms':  ['p(95)<500'],
    'sse_connection_time_ms': ['p(95)<500'],
    'ws_message_latency_ms':  ['p(95)<50'],
    'sse_message_latency_ms': ['p(95)<50'],
    'ws_connection_success_rate':  ['rate>0.90'],
    'sse_connection_success_rate': ['rate>0.90'],
  },
}

// ────────────────────────────────────────────────────────────────
// Socket.IO WebSocket 핸드셰이크 (Engine.IO polling → WS upgrade)
// ────────────────────────────────────────────────────────────────
function getSocketIOSid() {
  const pollRes = http.get(
    `${HTTP_URL}/socket.io/?EIO=4&transport=polling`,
    { timeout: '5s' }
  )
  if (pollRes.status !== 200) return null
  try {
    const body = pollRes.body
    const start = body.indexOf('{')
    return start === -1 ? null : JSON.parse(body.substring(start)).sid
  } catch {
    return null
  }
}

export function runWebSocket() {
  const sid = getSocketIOSid()
  if (!sid) {
    wsConnErrors.add(1)
    wsConnSuccess.add(0)
    sleep(1)
    return
  }

  const url = `${WS_URL}/socket.io/?EIO=4&transport=websocket&sid=${sid}`
  const connStart = Date.now()
  let connTimeMeasured = false

  const res = ws.connect(url, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }, (socket) => {
    socket.on('open', () => {
      wsConnSuccess.add(1)
      socket.send('2probe')  // Engine.IO upgrade probe

      socket.on('message', (data) => {
        if (data === '3probe') {
          socket.send('5')  // upgrade complete
          return
        }
        if (data === '2') { socket.send('3'); return }  // ping → pong

        if (data.startsWith('42')) {
          try {
            const [eventName, eventData] = JSON.parse(data.substring(2))

            if (eventName === 'connection_info' && !connTimeMeasured) {
              connTimeMeasured = true
              const elapsed = Date.now() - connStart
              wsConnTime.add(elapsed)

              // 이벤트 구독
              socket.send(`42["subscribe_event",${JSON.stringify({
                event_id: EVENT_ID,
                access_token: ACCESS_TOKEN,
              })}]`)
            }

            if (eventName === 'seat_status_updated') {
              wsMsgReceived.add(1)
              if (eventData?.timestamp) {
                const latency = Date.now() - new Date(eventData.timestamp).getTime()
                if (latency >= 0 && latency < 60000) wsLatency.add(latency)
              }
              check(eventData, {
                'WS: event_id 존재': (d) => !!d?.event_id,
                'WS: updates 배열 존재': (d) => Array.isArray(d?.updates),
              })
            }
          } catch { /* ignore parse errors */ }
        }
      })

      socket.on('error', () => wsConnErrors.add(1))

      socket.setTimeout(() => socket.close(), 55000)
    })
  })

  check(res, { 'WS: HTTP 101 upgrade': (r) => r && r.status === 101 })
  if (!res || res.status !== 101) {
    wsConnErrors.add(1)
    wsConnSuccess.add(0)
  }

  sleep(1)
}

// ────────────────────────────────────────────────────────────────
// SSE 연결 및 메시지 수신
// ────────────────────────────────────────────────────────────────
export function runSSE() {
  const connStart = Date.now()

  const res = http.get(
    `${HTTP_URL}/sse/seat-updates/${EVENT_ID}`,
    {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      timeout: '60s',
      responseType: 'text',
    }
  )

  if (res.status !== 200) {
    sseConnErrors.add(1)
    sseConnSuccess.add(0)
    check(res, { 'SSE: HTTP 200': (r) => r.status === 200 })
    sleep(1)
    return
  }

  // k6 HTTP GET 은 스트리밍 수신 불가(응답 완료 후 body 반환) —
  // 연결 시간과 수신한 전체 body 내 이벤트 수만 측정
  const connTime = Date.now() - connStart
  sseConnTime.add(connTime)
  sseConnSuccess.add(1)

  const body = res.body || ''
  const blocks = body.split('\n\n').filter((b) => b.trim())

  let connected = false
  for (const block of blocks) {
    const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
    if (!dataLine) continue

    let parsed
    try { parsed = JSON.parse(dataLine.slice(5).trim()) } catch { continue }

    if (!connected && parsed.type === 'connected') {
      connected = true
    }

    if (parsed.type === 'seat_status_updated') {
      sseMsgReceived.add(1)
      if (parsed.timestamp) {
        const latency = Date.now() - new Date(parsed.timestamp).getTime()
        if (latency >= 0 && latency < 60000) sseLatency.add(latency)
      }
      check(parsed, {
        'SSE: event_id 존재': (d) => !!d?.event_id,
        'SSE: updates 배열 존재': (d) => Array.isArray(d?.updates),
      })
    }
  }

  check(res, {
    'SSE: HTTP 200': (r) => r.status === 200,
    'SSE: connected 이벤트 수신': () => connected,
  })

  sleep(1)
}

// 기본 export — SCENARIO 환경변수로 분기
export default function () {
  if (SCENARIO === 'ws')  return runWebSocket()
  if (SCENARIO === 'sse') return runSSE()
  // both: VU 홀수/짝수로 분기
  if (__VU % 2 === 0) runWebSocket()
  else runSSE()
}
