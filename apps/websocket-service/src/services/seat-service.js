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
      eventId,
      seat: seatData,
      timestamp: new Date().toISOString(),
    })
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
