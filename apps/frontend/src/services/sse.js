class SSEService {
  constructor() {
    this.eventSource = null
    this.listeners = {}
    this.userId = null
    this.eventId = null
    this.queueToken = null
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.reconnectTimer = null
  }

  connect(userId, eventId, queueToken) {
    this.userId = userId
    this.eventId = eventId
    this.queueToken = queueToken
    this.reconnectAttempts = 0
    this._createConnection(userId, eventId, queueToken)
  }

  _createConnection(userId, eventId, queueToken) {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }

    const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'
    const url = new URL(`${baseUrl}/queue/sse`)
    url.searchParams.append('user_id', userId)
    url.searchParams.append('event_id', eventId)
    if (queueToken) {
      url.searchParams.append('queue_token', queueToken)
    }

    this.eventSource = new EventSource(url.toString())

    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0
      this.dispatch('connected')
    }

    this.eventSource.onerror = () => {
      if (this.eventSource.readyState === EventSource.CLOSED) {
        this.dispatch('disconnected')
        this._scheduleReconnect()
      }
    }

    // 백엔드가 unnamed data: 이벤트를 보내므로 onmessage로 수신
    this.eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.status === 'ready') {
          this.dispatch('queue_token_ready', { access_token: data.access_token })
        } else {
          this.dispatch('queue_update', {
            position: data.position,
            estimated_wait_time: data.position ? data.position * 2 : null,
            status: data.status,
          })
        }
      } catch (_) {}
    }
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts || !this.userId) return
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this._createConnection(this.userId, this.eventId, this.queueToken)
    }, delay)
  }

  close() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
    this.userId = null
    this.eventId = null
    this.queueToken = null
    this.reconnectAttempts = 0
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

  dispatch(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((cb) => cb(data))
    }
  }
}

export default new SSEService()
