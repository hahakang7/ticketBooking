import redis from 'redis'
import { config } from '../config.js'

const redisClient = redis.createClient({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD || undefined,
  db: config.REDIS_DB,
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 50, 500),
  },
})

redisClient.on('error', (err) => {
  console.error('Redis Client Error', err)
})

redisClient.on('connect', () => {
  console.log('✓ Redis client connected')
})

redisClient.on('disconnect', () => {
  console.log('✕ Redis client disconnected')
})

export default redisClient
