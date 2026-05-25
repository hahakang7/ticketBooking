import redisService from '../services/redis-service.js'
import logger from '../utils/logger.js'

// 이미 구독한 Redis 채널 추적 (중복 구독 방지)
const subscribedChannels = new Set()

async function subscribeToSeatUpdates(eventId, seatService) {
  const channel = `seat_updates:${eventId}`
  if (subscribedChannels.has(channel)) return

  subscribedChannels.add(channel)
  try {
    await redisService.subscribe(channel, (data) => {
      // 팀원 2가 발행하는 형식: { seat_id, status, held_by, event_id }
      const targetEventId = data.event_id || eventId
      seatService.broadcastSeatUpdate(targetEventId, {
        seatId: data.seat_id,
        status: data.status,
        heldBy: data.held_by || null,
      })
      logger.debug(`Seat update broadcasted: event=${targetEventId} seat=${data.seat_id} status=${data.status}`)
    })
    logger.info(`Subscribed to Redis channel: ${channel}`)
  } catch (err) {
    logger.error(`Failed to subscribe to ${channel}:`, err)
    subscribedChannels.delete(channel)
  }
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

    // 좌석 현황 요청
    socket.on('request_seat_summary', (data) => {
      const { event_id } = data || {}
      if (!event_id) return
      const summary = seatService.getSeatsSummary(event_id)
      socket.emit('seat_availability_summary', summary)
    })
  })
}
