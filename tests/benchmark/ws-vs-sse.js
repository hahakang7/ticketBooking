/**
 * WebSocket (Socket.IO) vs SSE 성능 비교 벤치마크
 *
 * 측정 항목:
 *  - 연결 수립 시간 (Connection Time): connect() 호출 → 첫 확인 이벤트 수신까지
 *  - 메시지 지연 시간 (Message Latency): 서버 send → 클라이언트 receive 델타
 *  - 전체 연결 수립 시간 (Batch Connect): N개 동시 연결에 걸리는 총 시간
 *  - 처리량 (Throughput): 단위 시간당 클라이언트 전체에 도달한 메시지 수
 *
 * 서버 구조:
 *  - Express + Socket.IO + SSE 엔드포인트를 단일 프로세스에서 기동
 *  - Redis 불필요: 인메모리 EventEmitter 로 pub/sub 시뮬레이션
 */

import express from 'express'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { io as ioClient } from 'socket.io-client'
import http from 'http'
import { performance } from 'perf_hooks'
import { EventEmitter } from 'events'

// ──────────────────────────────────────────────
// 설정
// ──────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '14100')
const EVENT_ID = process.env.EVENT_ID || 'bench-event-001'
const CONCURRENT = parseInt(process.env.CONCURRENT || '50')
const MESSAGES = parseInt(process.env.MESSAGES || '30')
const MSG_GAP_MS = parseInt(process.env.MSG_GAP_MS || '20') // 메시지 간 간격
const CONNECT_TIMEOUT_MS = 8000
const RECV_TIMEOUT_MS = 3000

// ──────────────────────────────────────────────
// 인메모리 pub/sub (Redis 대체)
// ──────────────────────────────────────────────
const internalBus = new EventEmitter()
internalBus.setMaxListeners(5000)

// ──────────────────────────────────────────────
// 테스트 서버 구성
// ──────────────────────────────────────────────
const app = express()
const httpServer = createServer(app)
const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' },
  transports: ['websocket'],   // polling 없이 순수 WebSocket 만 사용
  pingInterval: 25000,
  pingTimeout: 30000,
  connectTimeout: 10000,
})

// SSE fan-out 테이블
const sseClients = new Map() // eventId -> Set<res>

// SSE 엔드포인트
app.get('/sse/:eventId', (req, res) => {
  const { eventId } = req.params
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders()

  if (!sseClients.has(eventId)) sseClients.set(eventId, new Set())
  sseClients.get(eventId).add(res)

  res.write(`data: ${JSON.stringify({ type: 'connected', event_id: eventId })}\n\n`)

  const onMsg = (data) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch { /* 이미 닫힌 연결 */ }
  }
  internalBus.on(`sse:${eventId}`, onMsg)

  req.on('close', () => {
    internalBus.off(`sse:${eventId}`, onMsg)
    sseClients.get(eventId)?.delete(res)
    if (sseClients.get(eventId)?.size === 0) sseClients.delete(eventId)
  })
})

// WebSocket 이벤트 핸들러
io.on('connection', (socket) => {
  socket.on('subscribe_event', ({ event_id }) => {
    socket.join(`event_${event_id}`)
    socket.emit('subscription_confirmed', { event_id })
  })
})

/**
 * 두 프로토콜에 동시에 메시지를 발행.
 * 실제 환경에서는 Redis Publish → 각 리스너가 처리하는 구조이나
 * 벤치마크에서는 직접 발행하여 Redis 왕복 지연을 제거하고 순수 전송 지연만 측정.
 */
function publishUpdate(eventId, payload) {
  // WebSocket (Socket.IO room broadcast)
  io.to(`event_${eventId}`).emit('seat_status_updated', payload)
  // SSE fan-out
  internalBus.emit(`sse:${eventId}`, payload)
}

// ──────────────────────────────────────────────
// 통계 유틸
// ──────────────────────────────────────────────
function computeStats(arr) {
  if (!arr.length) return { avg: 0, p50: 0, p95: 0, p99: 0, max: 0, min: 0 }
  const sorted = [...arr].sort((a, b) => a - b)
  const n = sorted.length
  const p = (pct) => sorted[Math.min(Math.floor(n * pct), n - 1)]
  return {
    avg: arr.reduce((s, v) => s + v, 0) / n,
    min: sorted[0],
    p50: p(0.5),
    p95: p(0.95),
    p99: p(0.99),
    max: sorted[n - 1],
  }
}

function fmt(ms) { return ms.toFixed(2).padStart(8) }

// ──────────────────────────────────────────────
// WebSocket 벤치마크
// ──────────────────────────────────────────────
async function runWebSocketBench(concurrent, messages) {
  const connTimes = []
  const latencies = []

  // 1) 연결 수립
  const batchStart = performance.now()
  const clients = await Promise.all(
    Array.from({ length: concurrent }, (_, i) => new Promise((resolve, reject) => {
      const t0 = performance.now()
      const socket = ioClient(`http://localhost:${PORT}`, {
        transports: ['websocket'],
        forceNew: true,
        timeout: CONNECT_TIMEOUT_MS,
      })

      const timer = setTimeout(() => {
        socket.disconnect()
        reject(new Error(`WS connect timeout [${i}]`))
      }, CONNECT_TIMEOUT_MS)

      socket.once('connect', () => {
        socket.emit('subscribe_event', { event_id: EVENT_ID })
      })

      socket.once('subscription_confirmed', () => {
        clearTimeout(timer)
        connTimes.push(performance.now() - t0)
        resolve(socket)
      })

      socket.once('connect_error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
    }))
  )

  const batchConnMs = performance.now() - batchStart

  // 2) 메시지 지연 측정
  for (let m = 0; m < messages; m++) {
    const msgId = `ws-msg-${m}`
    const sendTime = performance.now()
    const payload = {
      event_id: EVENT_ID,
      msg_id: msgId,
      send_time: sendTime,
      updates: [{ seat_id: `seat-${m}`, status: 'hold' }],
      timestamp: new Date().toISOString(),
    }

    const receipts = clients.map((socket) =>
      new Promise((resolve) => {
        const handler = (data) => {
          if (data.msg_id === msgId) {
            latencies.push(performance.now() - data.send_time)
            socket.off('seat_status_updated', handler)
            resolve()
          }
        }
        socket.on('seat_status_updated', handler)
      })
    )

    publishUpdate(EVENT_ID, payload)

    await Promise.race([
      Promise.all(receipts),
      new Promise((r) => setTimeout(r, RECV_TIMEOUT_MS)),
    ])

    if (m < messages - 1) await sleep(MSG_GAP_MS)
  }

  // 3) 정리
  const throughput = (concurrent * messages) / ((performance.now() - batchStart) / 1000)
  clients.forEach((s) => s.disconnect())
  await sleep(300)

  return { connTimes, latencies, batchConnMs, throughput }
}

// ──────────────────────────────────────────────
// SSE 벤치마크
// ──────────────────────────────────────────────
async function runSSEBench(concurrent, messages) {
  const connTimes = []
  const latencies = []

  // 1) SSE 연결 수립
  const batchStart = performance.now()
  const connections = await Promise.all(
    Array.from({ length: concurrent }, (_, i) => new Promise((resolve, reject) => {
      const t0 = performance.now()
      let connected = false
      let buffer = ''
      const emitter = new EventEmitter()
      emitter.setMaxListeners(500)

      const timer = setTimeout(() => {
        reject(new Error(`SSE connect timeout [${i}]`))
      }, CONNECT_TIMEOUT_MS)

      const req = http.request(
        { host: 'localhost', port: PORT, path: `/sse/${EVENT_ID}`, method: 'GET' },
        (res) => {
          if (res.statusCode !== 200) {
            clearTimeout(timer)
            return reject(new Error(`SSE HTTP ${res.statusCode}`))
          }

          res.setEncoding('utf8')
          res.on('data', (chunk) => {
            buffer += chunk
            const blocks = buffer.split('\n\n')
            buffer = blocks.pop()

            for (const block of blocks) {
              const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
              if (!dataLine) continue
              let parsed
              try { parsed = JSON.parse(dataLine.slice(5).trim()) } catch { continue }

              if (!connected && parsed.type === 'connected') {
                connected = true
                clearTimeout(timer)
                connTimes.push(performance.now() - t0)
                resolve({ req, emitter })
              } else {
                emitter.emit('msg', parsed)
              }
            }
          })

          res.on('end', () => emitter.emit('close'))
          // 종료 시 ECONNRESET 은 정상 — 무시
          res.on('error', () => {})
        }
      )

      req.on('error', (e) => {
        if (connected) return // 이미 연결됐다면 종료 오류 무시
        clearTimeout(timer)
        reject(e)
      })
      req.end()
    }))
  )

  const batchConnMs = performance.now() - batchStart

  // 2) 메시지 지연 측정
  for (let m = 0; m < messages; m++) {
    const msgId = `sse-msg-${m}`
    const sendTime = performance.now()
    const payload = {
      event_id: EVENT_ID,
      msg_id: msgId,
      send_time: sendTime,
      updates: [{ seat_id: `seat-${m}`, status: 'hold' }],
      timestamp: new Date().toISOString(),
    }

    const receipts = connections.map(({ emitter }) =>
      new Promise((resolve) => {
        const handler = (data) => {
          if (data.msg_id === msgId) {
            latencies.push(performance.now() - data.send_time)
            emitter.off('msg', handler)
            resolve()
          }
        }
        emitter.on('msg', handler)
      })
    )

    publishUpdate(EVENT_ID, payload)

    await Promise.race([
      Promise.all(receipts),
      new Promise((r) => setTimeout(r, RECV_TIMEOUT_MS)),
    ])

    if (m < messages - 1) await sleep(MSG_GAP_MS)
  }

  // 3) 정리
  const throughput = (concurrent * messages) / ((performance.now() - batchStart) / 1000)
  connections.forEach(({ req }) => { try { req.destroy() } catch { /* 이미 닫힘 */ } })
  await sleep(300)

  return { connTimes, latencies, batchConnMs, throughput }
}

// ──────────────────────────────────────────────
// 결과 출력
// ──────────────────────────────────────────────
function printTable(label, stats) {
  console.log(`  ${label}`)
  console.log(`    avg=${fmt(stats.avg)}ms  p50=${fmt(stats.p50)}ms  p95=${fmt(stats.p95)}ms  p99=${fmt(stats.p99)}ms  max=${fmt(stats.max)}ms`)
}

function printComparison(wsResult, sseResult) {
  const wsConn = computeStats(wsResult.connTimes)
  const sseConn = computeStats(sseResult.connTimes)
  const wsLat = computeStats(wsResult.latencies)
  const sseLat = computeStats(sseResult.latencies)

  const delta = (ws, sse) => {
    const diff = sse - ws
    const sign = diff >= 0 ? '+' : ''
    return `SSE가 ${sign}${diff.toFixed(2)}ms (${(diff / ws * 100).toFixed(1)}%)`
  }

  console.log('\n  ┌──────────────────────────────────────────────────────────┐')
  console.log('  │              연결 수립 시간 (Connection Time)             │')
  console.log('  ├──────────────────────────────────────────────────────────┤')
  printTable('WebSocket', wsConn)
  printTable('SSE      ', sseConn)
  console.log(`  │  비교: ${delta(wsConn.avg, sseConn.avg).padEnd(50)} │`)
  console.log('  ├──────────────────────────────────────────────────────────┤')
  console.log('  │              메시지 지연 시간 (Message Latency)           │')
  console.log('  ├──────────────────────────────────────────────────────────┤')
  printTable('WebSocket', wsLat)
  printTable('SSE      ', sseLat)
  console.log(`  │  비교: ${delta(wsLat.avg, sseLat.avg).padEnd(50)} │`)
  console.log('  ├──────────────────────────────────────────────────────────┤')
  console.log(`  │  처리량 WebSocket: ${wsResult.throughput.toFixed(0).padEnd(8)} msg/s                        │`)
  console.log(`  │  처리량 SSE      : ${sseResult.throughput.toFixed(0).padEnd(8)} msg/s                        │`)
  console.log(`  │  전체 연결 시간 WebSocket: ${wsResult.batchConnMs.toFixed(0).padEnd(6)}ms                    │`)
  console.log(`  │  전체 연결 시간 SSE      : ${sseResult.batchConnMs.toFixed(0).padEnd(6)}ms                    │`)
  console.log('  └──────────────────────────────────────────────────────────┘')

  return { wsConn, sseConn, wsLat, sseLat }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

// ──────────────────────────────────────────────
// 메인
// ──────────────────────────────────────────────
async function main() {
  await new Promise((resolve) => httpServer.listen(PORT, resolve))
  console.log(`\n🚀 벤치마크 서버 기동 완료 — port ${PORT}`)
  console.log(`   동시 클라이언트: ${CONCURRENT}, 메시지 수: ${MESSAGES}, 간격: ${MSG_GAP_MS}ms\n`)

  const scenarios = [
    { concurrent: 10,  messages: MESSAGES },
    { concurrent: 50,  messages: MESSAGES },
    { concurrent: CONCURRENT, messages: MESSAGES },
  ]

  // 중복 제거 (CONCURRENT 가 이미 10/50 인 경우)
  const unique = [...new Map(scenarios.map((s) => [`${s.concurrent}`, s])).values()]

  const summary = []

  for (const { concurrent, messages } of unique) {
    console.log(`${'═'.repeat(62)}`)
    console.log(` 시나리오: 동시 클라이언트 ${concurrent}명, 메시지 ${messages}건`)
    console.log('═'.repeat(62))

    console.log('\n🔌 WebSocket 테스트 실행 중...')
    let wsResult
    try {
      wsResult = await runWebSocketBench(concurrent, messages)
      console.log(`   ✅ 완료 — 지연 샘플 ${wsResult.latencies.length}개`)
    } catch (e) {
      console.error('   ❌ WebSocket 테스트 실패:', e.message)
      continue
    }

    await sleep(500)

    console.log('\n📡 SSE 테스트 실행 중...')
    let sseResult
    try {
      sseResult = await runSSEBench(concurrent, messages)
      console.log(`   ✅ 완료 — 지연 샘플 ${sseResult.latencies.length}개`)
    } catch (e) {
      console.error('   ❌ SSE 테스트 실패:', e.message)
      continue
    }

    const stats = printComparison(wsResult, sseResult)
    summary.push({ concurrent, messages, ...stats, wsResult, sseResult })

    await sleep(500)
  }

  // ── 최종 요약 ──
  if (summary.length) {
    console.log('\n')
    console.log('╔══════════════════════════════════════════════════════════╗')
    console.log('║                  최종 성능 비교 요약                     ║')
    console.log('╠══════════════════════════════════════════════════════════╣')
    console.log('║ 클라이언트 │ 지표          │ WebSocket  │ SSE        │   ║')
    console.log('╠════════════╪═══════════════╪════════════╪════════════╪═══╣')

    for (const { concurrent, wsLat, sseLat, wsResult, sseResult } of summary) {
      const win = wsLat.p95 <= sseLat.p95 ? 'WS ✓' : 'SSE✓'
      console.log(
        `║ ${String(concurrent).padEnd(10)} │ 지연 P95(ms)   │ ${wsLat.p95.toFixed(2).padEnd(10)} │ ${sseLat.p95.toFixed(2).padEnd(10)} │ ${win} ║`
      )
      console.log(
        `║            │ 처리량(msg/s) │ ${wsResult.throughput.toFixed(0).padEnd(10)} │ ${sseResult.throughput.toFixed(0).padEnd(10)} │     ║`
      )
      console.log('╠════════════╪═══════════════╪════════════╪════════════╪═══╣')
    }

    console.log('╚══════════════════════════════════════════════════════════╝')
    console.log()
    console.log('📌 해석 가이드')
    console.log('  • 연결 시간: SSE는 HTTP 핸드셰이크만, WebSocket은 HTTP → WS 업그레이드 추가')
    console.log('  • 메시지 지연: Socket.IO room.emit vs HTTP res.write 순수 차이')
    console.log('  • 처리량: 클라이언트 수 × 메시지 수 ÷ 경과 시간')
    console.log('  • 실제 환경에서는 Redis Pub/Sub 왕복 지연(~1ms)이 양쪽에 동일하게 추가됨')
    console.log()
  }

  httpServer.close()
  process.exit(0)
}

main().catch((e) => {
  console.error('벤치마크 오류:', e)
  process.exit(1)
})
