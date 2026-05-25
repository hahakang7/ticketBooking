import logger from '../utils/logger.js'
import { SOCKET_EVENTS, HEARTBEAT_INTERVAL } from '../utils/constants.js'
import { wsConnectionsActive, wsDisconnectionsTotal } from '../metrics.js'

class SocketService {
  constructor(io) {
    this.io = io
    this.connections = new Map()
  }

  handleConnection(socket) {
    logger.info(`🔌 Client connected: ${socket.id}`)
    this.connections.set(socket.id, {
      id: socket.id,
      connectedAt: Date.now(),
      subscribedEvents: [],
    })

    // 연결 정보 전송 (WebSocket API 스펙 준수)
    socket.emit(SOCKET_EVENTS.CONNECTION_INFO, {
      socket_id: socket.id,
      server_time: new Date().toISOString(),
      version: '1.0.0',
    })

    // Heartbeat 설정
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
