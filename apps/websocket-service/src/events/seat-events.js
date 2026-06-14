import redisService from '../services/redis-service.js'
import logger from '../utils/logger.js'
import { broadcastToSSEClients } from '../routes/sse-routes.js'

// 이미 구독한 Redis 채널 추적 (중복 구독 방지)
const subscribedChannels = new Set()

async function subscribeToSeatUpdates(eventId, seatService) {
  const channel = `seat_updates:${eventId}`
  if (subscribedChannels.has(channel)) return

  subscribedChannels.add(channel)
  try {
    await redisService.subscribe(channel, (data) => {
      // core-api 발행 형식: { event_id, seats: [{seat_id, status}], timestamp }
      const targetEventId = data.event_id || eventId
      const seats = Array.isArray(data.seats)
        ? data.seats.map((s) => ({ seatId: s.seat_id, status: s.status }))
        : [{ seatId: data.seat_id, status: data.status }]
      seatService.broadcastBatchSeatUpdate(targetEventId, seats)

      // SSE 클라이언트에도 동일 메시지 팬아웃 (Redis 구독 공유)
      broadcastToSSEClients(targetEventId, {
        type: 'seat_status_updated',
        event_id: targetEventId,
        updates: seats.map((s) => ({ seat_id: s.seatId, status: s.status })),
        timestamp: data.timestamp,
      })

      logger.debug(`Seat batch update broadcasted: event=${targetEventId} count=${seats.length}`)
    })
    logger.info(`Subscribed to Redis channel: ${channel}`)
  } catch (err) {
    logger.error(`Failed to subscribe to ${channel}:`, err)
    subscribedChannels.delete(channel)
  }
}

export async function unsubscribeFromSeatUpdates(eventId) {
  const channel = `seat_updates:${eventId}`
  if (!subscribedChannels.has(channel)) return
  subscribedChannels.delete(channel)
  await redisService.unsubscribe(channel)
  logger.info(`Unsubscribed from Redis channel: ${channel}`)
}

export const setupSeatEvents = (io, eventService, seatService) => {
  io.on('connection', (socket) => {
    // subscribe_event 시 해당 이벤트의 Redis 채널도 구독
    socket.on('subscribe_event', (data) => {
      const eventId = data?.event_id
      if (eventId) {
        subscribeToSeatUpdates(eventId, seatService)
      }
    })

  })
}
