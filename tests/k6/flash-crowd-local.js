/**
 * Flash Crowd 로컬 시뮬레이션
 *
 * 목적: 티켓 오픈 직후 폭발적 유입 패턴 재현 + WebSocket 유지율 검증
 *
 * 로컬 현실적 규모: 100~500 RPS (5000~10000은 전용 서버 필요)
 * 대신 spike 패턴(0→MAX→0)은 동일하게 재현
 *
 * 사전 준비:
 *   docker compose --profile monitoring up -d
 *   (websocket-service 포함: docker compose up -d 로도 가능)
 *
 * 실행:
 *   & "C:\Program Files\k6\k6.exe" run tests/k6/flash-crowd-local.js
 *
 * 스케일 조정:
 *   CROWD_RATE=300 CROWD_VUS=200 & "C:\Program Files\k6\k6.exe" run tests/k6/flash-crowd-local.js
 *
 * Prometheus 확인:
 *   http://localhost:9090
 *   쿼리: socket_io_connections_active
 *         rate(http_requests_total[10s])
 */

import http from 'k6/http'
import ws from 'k6/ws'
import { check, sleep, group } from 'k6'
import { Counter, Rate, Trend, Gauge } from 'k6/metrics'

// ── 환경 변수 ──────────────────────────────────────────────────────────────
const BASE_URL  = __ENV.BASE_URL  || 'http://localhost:8000'
const WS_URL    = __ENV.WS_URL    || 'ws://localhost:3000'
const EVENT_ID  = __ENV.EVENT_ID  || ''

// Flash Crowd 규모 조정 (로컬 현실: 200 RPS / 전용서버: 5000 RPS)
const CROWD_RATE = parseInt(__ENV.CROWD_RATE || '200')   // 목표 RPS
const CROWD_VUS  = parseInt(__ENV.CROWD_VUS  || '150')   // 사전 할당 VU

// ── 커스텀 메트릭 ──────────────────────────────────────────────────────────
// HTTP (Queue)
const queueJoinOk     = new Counter('flash_queue_join_ok')
const queueJoin429    = new Counter('flash_queue_join_429')
const queueJoinErr    = new Counter('flash_queue_join_error')
const queueJoinDur    = new Trend('flash_queue_join_duration_ms', true)
const httpErrorRate   = new Rate('flash_http_error_rate')

// WebSocket 유지율
const wsConnected     = new Counter('flash_ws_connected')
const wsDropped       = new Counter('flash_ws_dropped')
const wsRetentionRate = new Rate('flash_ws_retention_rate')
const wsLatency       = new Trend('flash_ws_msg_latency_ms', true)

// ── 시나리오 ────────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // ① 워밍업: 점진적 증가 (30s)
    warmup: {
      executor: 'ramping-arrival-rate',
      exec: 'runQueueJoin',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 100,
      stages: [
        { duration: '30s', target: 50 },
      ],
    },

    // ② Flash Crowd: 급증 (워밍업 완료 후 즉시)
    flash_crowd: {
      executor: 'ramping-arrival-rate',
      exec: 'runQueueJoin',
      startTime: '30s',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: CROWD_VUS,
      maxVUs: CROWD_VUS * 2,
      stages: [
        { duration: '20s', target: CROWD_RATE },  // 급증
        { duration: '60s', target: CROWD_RATE },  // 유지
        { duration: '20s', target: 0 },           // 감소
      ],
    },

    // ③ WebSocket 유지율: flash_crowd 와 동시 실행
    //    100 VU가 WS 연결을 유지한 채로 HTTP flood를 버티는지 확인
    ws_retention: {
      executor: 'constant-vus',
      exec: 'runWSRetention',
      startTime: '20s',     // 워밍업 중반부터 WS 연결 수립
      vus: 50,
      duration: '120s',     // flash_crowd 내내 유지
    },
  },

  thresholds: {
    // KPI: P95 < 300ms, 에러율 < 5%
    'flash_queue_join_duration_ms':  ['p(95)<300'],
    'flash_http_error_rate':         ['rate<0.05'],
    // WebSocket: 유지율 90% 이상
    'flash_ws_retention_rate':       ['rate>0.90'],
  },
}

// ── 헬스체크 + event_id 확보 ───────────────────────────────────────────────
export function setup() {
  const health = http.get(`${BASE_URL}/health`)
  if (health.status !== 200) {
    throw new Error(`core-api 미응답: ${health.status}`)
  }

  let eventId = EVENT_ID
  if (!eventId) {
    const evRes = http.get(`${BASE_URL}/api/v1/events`)
    if (evRes.status === 200) {
      try {
        const body = JSON.parse(evRes.body)
        eventId = body?.data?.items?.[0]?.event_id || ''
      } catch { /* ignore */ }
    }
  }

  if (!eventId) {
    console.warn('[setup] event_id 없음 — EVENT_ID 환경변수로 지정하거나 DB에 이벤트를 생성하세요')
  } else {
    console.log(`[setup] event_id: ${eventId}`)
  }

  // WebSocket 서비스 헬스체크
  const wsHealth = http.get('http://localhost:3000/health')
  if (wsHealth.status === 200) {
    console.log('[setup] websocket-service 정상')
  } else {
    console.warn('[setup] websocket-service 미응답 — WS 유지율 시나리오 실패 예상')
  }

  return { eventId }
}

// ── 시나리오 ①②: 대기열 진입 (HTTP Flash Crowd) ──────────────────────────
export function runQueueJoin(data) {
  const eventId = data.eventId
  if (!eventId) { sleep(1); return }

  const userId = `flash-user-${__VU}-${__ITER}`
  const t0 = Date.now()

  const res = http.post(
    `${BASE_URL}/api/queue/join`,
    JSON.stringify({ user_id: userId, event_id: eventId }),
    { headers: { 'Content-Type': 'application/json' }, timeout: '5s' },
  )

  const dur = Date.now() - t0
  queueJoinDur.add(dur)

  if (res.status === 200) {
    queueJoinOk.add(1)
    httpErrorRate.add(0)
  } else if (res.status === 429) {
    queueJoin429.add(1)
    httpErrorRate.add(0)  // rate limit은 정상 동작
  } else {
    queueJoinErr.add(1)
    httpErrorRate.add(1)
  }

  check(res, {
    'queue join: 200 또는 429': (r) => r.status === 200 || r.status === 429,
  })
}

// ── 시나리오 ③: WebSocket 유지율 ─────────────────────────────────────────
export function runWSRetention(data) {
  const eventId = data.eventId

  // Engine.IO polling → sid 획득
  const pollRes = http.get(
    'http://localhost:3000/socket.io/?EIO=4&transport=polling',
    { timeout: '5s' },
  )
  if (pollRes.status !== 200) {
    wsDropped.add(1)
    wsRetentionRate.add(0)
    sleep(2)
    return
  }

  let sid
  try {
    const body = pollRes.body
    sid = JSON.parse(body.substring(body.indexOf('{'))).sid
  } catch {
    wsDropped.add(1)
    wsRetentionRate.add(0)
    sleep(2)
    return
  }

  const url = `ws://localhost:3000/socket.io/?EIO=4&transport=websocket&sid=${sid}`
  let connected = false
  let msgCount = 0

  const res = ws.connect(url, {}, (socket) => {
    socket.on('open', () => {
      connected = true
      wsConnected.add(1)
      wsRetentionRate.add(1)
      socket.send('2probe')

      socket.on('message', (data) => {
        if (data === '3probe') { socket.send('5'); return }
        if (data === '2')      { socket.send('3'); return }

        if (data.startsWith('42')) {
          msgCount++
          try {
            const [event, payload] = JSON.parse(data.substring(2))
            if (event === 'connection_info' && eventId) {
              socket.send(`42["subscribe_event",${JSON.stringify({ event_id: eventId })}]`)
            }
            if (event === 'seat_status_updated' && payload?.timestamp) {
              const lat = Date.now() - new Date(payload.timestamp).getTime()
              if (lat >= 0 && lat < 60000) wsLatency.add(lat)
            }
          } catch { /* ignore */ }
        }
      })

      socket.on('error', () => {
        if (connected) {
          wsDropped.add(1)
          wsRetentionRate.add(0)
          connected = false
        }
      })

      // flash_crowd 동안 연결 유지 (90s)
      socket.setTimeout(() => socket.close(), 90000)
    })

    socket.on('close', () => {
      if (connected) {
        // 정상 종료(timeout)는 유지율에 이미 1 기록됨 — 별도 처리 불필요
      }
    })
  })

  // WS 업그레이드 실패
  if (!res || res.status !== 101) {
    if (!connected) {
      wsDropped.add(1)
      wsRetentionRate.add(0)
    }
  }

  sleep(1)
}

// ── 테스트 종료 요약 ─────────────────────────────────────────────────────
export function teardown(data) {
  console.log('\n=== Flash Crowd 결과 요약 ===')
  console.log(`event_id: ${data.eventId}`)
  console.log('Prometheus: http://localhost:9090')
  console.log('쿼리 예시:')
  console.log('  socket_io_connections_active')
  console.log('  rate(http_requests_total[10s])')
  console.log('  histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[10s]))')
}
