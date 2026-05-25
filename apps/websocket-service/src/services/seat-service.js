import logger from '../utils/logger.js'

class SeatService {
  constructor(io) {
    this.io = io
    this.seatStates = new Map() // eventId -> { seats }
  }

  updateSeatState(eventId, seatData) {
    if (!this.seatStates.has(eventId)) {
      this.seatStates.set(eventId, {})
    }

    const eventSeats = this.seatStates.get(eventId)
    eventSeats[seatData.seatId] = seatData

    logger.debug(`Seat ${seatData.seatId} in event ${eventId} updated:`, seatData.status)
  }

  getSeatState(eventId, seatId) {
    const eventSeats = this.seatStates.get(eventId)
    return eventSeats?.[seatId] || null
  }

  broadcastSeatUpdate(eventId, seatData) {
    this.updateSeatState(eventId, seatData)
    this.io.to(`event_${eventId}`).emit('seat_status_updated', {
      event_id: eventId,
      updates: [{ seat_id: seatData.seatId, status: seatData.status }],
      timestamp: new Date().toISOString(),
    })
  }

  broadcastBatchSeatUpdate(eventId, seats) {
    seats.forEach((seat) => this.updateSeatState(eventId, seat))
    this.io.to(`event_${eventId}`).emit('seat_status_updated', {
      event_id: eventId,
      updates: seats.map((s) => ({ seat_id: s.seatId, status: s.status })),
      timestamp: new Date().toISOString(),
    })
    const reserved = seats.filter((s) => s.status === 'sold')
    if (reserved.length) {
      this.io.to(`event_${eventId}`).emit('seat_reserved', {
        event_id: eventId,
        seat_ids: reserved.map((s) => s.seatId),
        timestamp: new Date().toISOString(),
      })
    }
  }

  getAvailableSeatsCount(eventId) {
    const eventSeats = this.seatStates.get(eventId)
    if (!eventSeats) return 0

    return Object.values(eventSeats).filter((s) => s.status === 'available').length
  }

  getSeatsSummary(eventId) {
    const eventSeats = this.seatStates.get(eventId) || {}
    const statusCounts = {
      available: 0,
      hold: 0,
      sold: 0,
    }

    Object.values(eventSeats).forEach((seat) => {
      if (statusCounts.hasOwnProperty(seat.status)) {
        statusCounts[seat.status]++
      }
    })

    return {
      eventId,
      totalSeats: Object.keys(eventSeats).length,
      ...statusCounts,
    }
  }
}

export default SeatService
