import logger from '../utils/logger.js'

export const loggerMiddleware = (socket, next) => {
  logger.info(`[Client Connected] ${socket.id}`)

  socket.on('disconnect', () => {
    logger.info(`[Client Disconnected] ${socket.id}`)
  })

  next()
}
