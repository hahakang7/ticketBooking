import express from 'express'
import logger from '../utils/logger.js'

const router = express.Router()

// eventId -> Set<res>  (fan-out table)
const sseClients = new Map()

/**
 * SSE 클라이언트들에게 브로드캐스트.
 * seat-events.js 에서 Redis 메시지 수신 시 호출.
 * @returns {number} 전송된 클라이언트 수
 */
export function broadcastToSSEClients(eventId, data) {
  const clients = sseClients.get(eventId)
  if (!clients || clients.size === 0) return 0

  const payload = `data: ${JSON.stringify(data)}\n\n`
  const dead = []

  for (const res of clients) {
    try {
      res.write(payload)
    } catch {
      dead.push(res)
    }
  }

  dead.forEach((r) => clients.delete(r))
  return clients.size
}

export function getSSEClientCount(eventId) {
  return sseClients.get(eventId)?.size ?? 0
}

/**
 * GET /sse/seat-updates/:eventId
 * WebSocket 과 동일한 좌석 업데이트를 SSE 로 수신하는 엔드포인트.
 * Redis 구독은 WebSocket 경로(seat-events.js)와 공유하여 Redis 연결을 추가하지 않음.
 */
router.get('/seat-updates/:eventId', (req, res) => {
  const { eventId } = req.params

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders()

  if (!sseClients.has(eventId)) {
    sseClients.set(eventId, new Set())
  }
  const clients = sseClients.get(eventId)
  clients.add(res)

  logger.debug(`SSE client connected [event=${eventId}] total=${clients.size}`)

  // 연결 확인 이벤트
  res.write(`data: ${JSON.stringify({ type: 'connected', event_id: eventId })}\n\n`)

  // 25초 heartbeat — WebSocket pingInterval 과 동일
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n')
    } catch {
      clearInterval(heartbeat)
    }
  }, 25000)

  req.on('close', () => {
    clearInterval(heartbeat)
    clients.delete(res)
    if (clients.size === 0) sseClients.delete(eventId)
    logger.debug(`SSE client disconnected [event=${eventId}] remaining=${clients.size}`)
  })
})

export default router
