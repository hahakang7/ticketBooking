import logger from '../utils/logger.js'
import { SOCKET_EVENTS, HEARTBEAT_INTERVAL } from '../utils/constants.js'
import { wsConnectionsActive, wsDisconnectionsTotal } from '../metrics.js'
import { config } from '../config.js'

// 연결 끊김 후 hold를 해제하기 전 유예 시간 (재연결 허용)
const DISCONNECT_GRACE_MS = 60_000

class SocketService {
  constructor(io) {
    this.io = io
    this.connections = new Map()      // socketId → connection info
    this.userSocketCount = new Map()  // userId → 활성 소켓 수
    this.pendingReleases = new Map()  // userId → setTimeout handle
  }

  handleConnection(socket) {
    logger.info(`🔌 Client connected: ${socket.id}`)
    this.connections.set(socket.id, {
      id: socket.id,
      connectedAt: Date.now(),
      subscribedEvents: [],
    })

    // 같은 userId로 재연결한 경우 대기 중인 hold 해제 타이머를 취소
    const userId = socket.data.userId
    if (userId) {
      const prev = this.userSocketCount.get(userId) || 0
      this.userSocketCount.set(userId, prev + 1)

      if (this.pendingReleases.has(userId)) {
        clearTimeout(this.pendingReleases.get(userId))
        this.pendingReleases.delete(userId)
        logger.info(`⏱ Grace timer cancelled for user ${userId} (reconnected)`)
      }
    }

    // 연결 정보 전송 (WebSocket API 스펙 준수)
    socket.emit(SOCKET_EVENTS.CONNECTION_INFO, {
      socket_id: socket.id,
      server_time: new Date().toISOString(),
      version: '1.0.0',
    })

    this.setupHeartbeat(socket)

    socket.on('disconnect', () => {
      this.handleDisconnection(socket)
    })
    wsConnectionsActive.inc()
  }

  setupHeartbeat(socket) {
    const heartbeatInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit(SOCKET_EVENTS.HEARTBEAT, { timestamp: Date.now() })
      } else {
        clearInterval(heartbeatInterval)
      }
    }, HEARTBEAT_INTERVAL)
  }

  handleDisconnection(socket) {
    logger.info(`🔌 Client disconnected: ${socket.id}`)
    this.connections.delete(socket.id)
    wsConnectionsActive.dec()
    wsDisconnectionsTotal.inc()

    const userId = socket.data.userId
    if (!userId) return

    const remaining = (this.userSocketCount.get(userId) || 1) - 1
    if (remaining <= 0) {
      this.userSocketCount.delete(userId)
      // 마지막 소켓이 끊겼을 때만 유예 타이머 시작
      const timer = setTimeout(
        () => this._releaseUserHolds(userId),
        DISCONNECT_GRACE_MS,
      )
      this.pendingReleases.set(userId, timer)
      logger.info(
        `⏱ Grace timer started for user ${userId} (${DISCONNECT_GRACE_MS / 1000}s)`,
      )
    } else {
      this.userSocketCount.set(userId, remaining)
    }
  }

  async _releaseUserHolds(userId) {
    this.pendingReleases.delete(userId)
    logger.info(`🪑 Releasing holds for disconnected user ${userId}`)

    if (!config.INTERNAL_SECRET) {
      logger.warn('INTERNAL_SECRET not configured, skipping hold release')
      return
    }

    try {
      const res = await fetch(`${config.API_BASE_URL}/api/v1/reservations/internal/release-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': config.INTERNAL_SECRET,
        },
        body: JSON.stringify({ user_id: userId }),
      })

      if (!res.ok) {
        logger.warn(`Hold release failed for user ${userId}: HTTP ${res.status}`)
      } else {
        const data = await res.json()
        logger.info(`Released ${data.released_seats} seat(s) for user ${userId}`)
      }
    } catch (err) {
      logger.error(`Failed to call release-user API for ${userId}: ${err.message}`)
    }
  }

  broadcastToRoom(roomName, event, data) {
    this.io.to(roomName).emit(event, data)
    logger.debug(`Broadcasted to room ${roomName}:`, event)
  }

  broadcastToAll(event, data) {
    this.io.emit(event, data)
    logger.debug(`Broadcasted to all clients:`, event)
  }

  getConnectionStats() {
    return {
      totalConnections: this.connections.size,
      connections: Array.from(this.connections.values()),
    }
  }
}

export default SocketService
