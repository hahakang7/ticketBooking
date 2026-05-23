import { useState, useEffect, useRef, useCallback } from 'react'
import socketService from '../services/socket'
import storageService from '../services/storage'

const HEARTBEAT_INTERVAL = 25000

export const useWebSocket = (eventId) => {
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState(null)
  // { backendSeatId: 'available' | 'hold' | 'sold' }
  const [seatUpdates, setSeatUpdates] = useState({})
  const heartbeatRef = useRef(null)

  const clearHeartbeat = () => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
  }

  useEffect(() => {
    if (!eventId) return

    const accessToken = storageService.getAccessToken()
    socketService.connect(accessToken)

    const handleConnected = () => {
      setIsConnected(true)
      setError(null)
      socketService.subscribeToEvent(eventId)
      clearHeartbeat()
      heartbeatRef.current = setInterval(() => {
        socketService.emit('heartbeat', { timestamp: Date.now() })
      }, HEARTBEAT_INTERVAL)
    }

    const handleDisconnected = () => {
      setIsConnected(false)
      clearHeartbeat()
    }

    const handleError = (err) => {
      setError(err?.message || 'WebSocket 연결 오류')
      setIsConnected(false)
    }

    // { event_id, timestamp, updates: [{ seat_id, status }] }
    const handleSeatStatusUpdated = (data) => {
      const updates = data?.updates || []
      if (!updates.length) return
      setSeatUpdates((prev) => {
        const next = { ...prev }
        updates.forEach(({ seat_id, status }) => {
          if (seat_id) next[seat_id] = status
        })
        return next
      })
    }

    // { event_id, seat_ids: [] }
    const handleSeatHoldExpired = (data) => {
      const seatIds = data?.seat_ids || []
      if (!seatIds.length) return
      setSeatUpdates((prev) => {
        const next = { ...prev }
        seatIds.forEach((id) => { next[id] = 'available' })
        return next
      })
    }

    socketService.on('connected', handleConnected)
    socketService.on('disconnected', handleDisconnected)
    socketService.on('error', handleError)
    socketService.on('seat_status_updated', handleSeatStatusUpdated)
    socketService.on('seat_hold_expired', handleSeatHoldExpired)

    // 이미 연결된 경우 즉시 구독
    if (socketService.isConnected()) {
      setIsConnected(true)
      socketService.subscribeToEvent(eventId)
    }

    return () => {
      socketService.off('connected', handleConnected)
      socketService.off('disconnected', handleDisconnected)
      socketService.off('error', handleError)
      socketService.off('seat_status_updated', handleSeatStatusUpdated)
      socketService.off('seat_hold_expired', handleSeatHoldExpired)
      clearHeartbeat()
    }
  }, [eventId])

  const requestSeatSummary = useCallback(() => {
    if (eventId) socketService.emit('request_seat_summary', { event_id: eventId })
  }, [eventId])

  return { isConnected, seatUpdates, error, requestSeatSummary }
}
