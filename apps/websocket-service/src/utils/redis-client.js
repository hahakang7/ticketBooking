import redis from 'redis'
import { config } from '../config.js'

const redisClient = redis.createClient({
  socket: {
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    reconnectStrategy: (retries) => Math.min(retries * 50, 500),
  },
  password: config.REDIS_PASSWORD || undefined,
  database: config.REDIS_DB,
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
