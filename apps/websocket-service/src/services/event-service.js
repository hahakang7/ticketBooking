import logger from '../utils/logger.js'
import { unsubscribeFromSeatUpdates } from '../events/seat-events.js'

class EventService {
  constructor(io, socketService, seatService) {
    this.io = io
    this.socketService = socketService
    this.seatService = seatService
    this.eventRooms = new Map()
  }

  subscribeToEvent(socket, eventId) {
    const roomName = `event_${eventId}`

    // 이미 구독 중인 경우 무시 (중복 subscribe_event 이벤트 방어)
    if (socket.rooms.has(roomName)) {
      logger.debug(`📍 Socket ${socket.id} already subscribed to event ${eventId}, skipping`)
      return
    }

    socket.join(roomName)

    if (!this.eventRooms.has(eventId)) {
      this.eventRooms.set(eventId, {
        eventId,
        subscribers: new Set(),
        createdAt: Date.now(),
      })
    }

    this.eventRooms.get(eventId).subscribers.add(socket.id)

    const roomSize = this.io.sockets.adapter.rooms.get(roomName)?.size || 0
    socket.emit('subscription_confirmed', {
      event_id: eventId,
      room: roomName,
      clients_in_room: roomSize,
    })

    logger.info(`📍 Socket ${socket.id} subscribed to event ${eventId}`)
  }

  unsubscribeFromEvent(socket, eventId) {
    const roomName = `event_${eventId}`
    socket.leave(roomName)

    const eventRoom = this.eventRooms.get(eventId)
    if (eventRoom) {
      eventRoom.subscribers.delete(socket.id)
      if (eventRoom.subscribers.size === 0) {
        this.eventRooms.delete(eventId)
        this.seatService?.clearEvent(eventId)
        unsubscribeFromSeatUpdates(eventId)
      }
    }

    logger.info(`📍 Socket ${socket.id} unsubscribed from event ${eventId}`)
  }

  broadcastToEvent(eventId, event, data) {
    const roomName = `event_${eventId}`
    this.io.to(roomName).emit(event, data)
    logger.debug(`📡 Broadcasted to event ${eventId}:`, event)
  }

  getEventStats(eventId) {
    const eventRoom = this.eventRooms.get(eventId)
    return {
      eventId,
      subscribers: eventRoom?.subscribers.size || 0,
      createdAt: eventRoom?.createdAt,
    }
  }
}

export default EventService
