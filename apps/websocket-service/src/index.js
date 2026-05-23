import { httpServer } from './server.js'
import { config } from './config.js'
import logger from './utils/logger.js'
import redisService from './services/redis-service.js'

const PORT = config.PORT
const HOST = config.HOST

async function start() {
  try {
    await redisService.connect()
    logger.info('Redis Pub/Sub service ready')
  } catch (err) {
    logger.warn(`Redis Pub/Sub unavailable, continuing without it: ${err.message}`)
  }

  httpServer.listen(PORT, HOST, () => {
    logger.info(`🚀 WebSocket server running at http://${HOST}:${PORT}`)
    logger.info(`Environment: ${config.NODE_ENV}`)
    logger.info(`CORS Origin: ${config.CORS_ORIGIN}`)
  })
}

start()

// Graceful Shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server')
  httpServer.close(() => {
    logger.info('HTTP server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server')
  httpServer.close(() => {
    logger.info('HTTP server closed')
    process.exit(0)
  })
})
