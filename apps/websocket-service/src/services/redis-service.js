import redisClient from '../utils/redis-client.js'
import logger from '../utils/logger.js'
import { REDIS_KEYS } from '../utils/constants.js'

class RedisService {
  constructor() {
    this.subscriberClient = null
  }

  async connect() {
    this.subscriberClient = redisClient.duplicate()
    await this.subscriberClient.connect()
    logger.info('✓ Redis Service connected')
  }

  async subscribe(channel, callback) {
    if (!this.subscriberClient) {
      logger.error('Subscriber not connected')
      return
    }

    await this.subscriberClient.subscribe(channel, (message, channel) => {
      try {
        const data = JSON.parse(message)
        callback(data)
      } catch (err) {
        logger.error(`Failed to parse message from ${channel}:`, err)
      }
    })

    logger.debug(`Subscribed to channel: ${channel}`)
  }

  async disconnect() {
    if (this.subscriberClient) {
      await this.subscriberClient.quit()
    }
    logger.info('✓ Redis Service disconnected')
  }
}

export default new RedisService()
