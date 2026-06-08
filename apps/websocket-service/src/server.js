import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { config } from './config.js'
import logger from './utils/logger.js'
import { authMiddleware } from './middleware/auth.js'
import { loggerMiddleware } from './middleware/logger.js'
import SocketService from './services/socket-service.js'
import EventService from './services/event-service.js'
import SeatService from './services/seat-service.js'
import { setupConnectionEvents } from './events/connection.js'
import { setupSeatEvents } from './events/seat-events.js'
import { setupSubscriptionEvents } from './events/subscription.js'
import { register, wsConnectionsActive, wsDisconnectionsTotal } from './metrics.js'

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: config.CORS_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 30000,
})

// 미들웨어
app.use(express.json())

// Socket.IO 미들웨어
io.use(authMiddleware)
io.use(loggerMiddleware)

// 서비스 초기화
const socketService = new SocketService(io)
const seatService = new SeatService(io)
const eventService = new EventService(io, socketService, seatService)

// 이벤트 핸들러 설정
setupConnectionEvents(io, socketService, eventService)
setupSeatEvents(io, eventService, seatService)
setupSubscriptionEvents(io, eventService, seatService)

// Health Check 엔드포인트
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connections: socketService.getConnectionStats(),
  })
})

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType)
  res.end(await register.metrics())
})

// Stats 엔드포인트
app.get('/stats', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    connections: socketService.getConnectionStats(),
    events: {
      activeEvents: io.engine.clientsCount,
    },
  })
})

// 404 핸들러
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' })
})

// 에러 핸들러
app.use((err, req, res, next) => {
  logger.error('Express error:', err)
  res.status(500).json({ error: 'Internal Server Error' })
})

export { httpServer, io, socketService, eventService, seatService }
