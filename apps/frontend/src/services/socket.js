import io from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000'

class SocketService {
  constructor() {
    this.socket = null
    this.listeners = {}
  }

  connect(accessToken) {
    if (this.socket?.connected) return

    this.socket = io(SOCKET_URL, {
      auth: { token: accessToken || '' },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      transports: ['websocket', 'polling'],
    })

    this.socket.on('connect', () => {
      this._dispatch('connected')
    })

    this.socket.on('disconnect', () => {
      this._dispatch('disconnected')
    })

    this.socket.on('connect_error', (error) => {
      this._dispatch('error', error)
    })

    // 소켓 이벤트를 SocketService 리스너로 전달
    const socketEvents = [
      'seat_status_updated',
      'seat_hold_expired',
      'seat_availability_summary',
      'subscription_confirmed',
      'connection_info',
    ]
    socketEvents.forEach((event) => {
      this.socket.on(event, (data) => this._dispatch(event, data))
    })
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
  }

  subscribeToEvent(eventId) {
    this.emit('subscribe_event', { event_id: eventId })
  }

  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = []
    this.listeners[event].push(callback)
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback)
    }
  }

  emit(event, data) {
    if (this.socket?.connected) {
      this.socket.emit(event, data)
    }
  }

  _dispatch(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((cb) => cb(data))
    }
  }

  isConnected() {
    return this.socket?.connected || false
  }
}

export default new SocketService()
