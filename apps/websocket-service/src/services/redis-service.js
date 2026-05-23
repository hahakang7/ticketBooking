import redisClient from '../utils/redis-client.js'
import logger from '../utils/logger.js'
import { REDIS_KEYS } from '../utils/constants.js'

class RedisService {
  constructor() {
    this.subscriberClient = null
    this.publisherClient = null
  }

  async connect() {
    this.subscriberClient = redisClient.duplicate()
    this.publisherClient = redisClient.duplicate()

    await this.subscriberClient.connect()
    await this.publisherClient.connect()

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

  async publish(channel, data) {
    if (!this.publisherClient) {
      logger.error('Publisher not connected')
      return
    }

    try {
      await this.publisherClient.publish(channel, JSON.stringify(data))
      logger.debug(`Published message to ${channel}:`, data)
    } catch (err) {
      logger.error(`Failed to publish to ${channel}:`, err)
    }
  }

  async disconnect() {
    if (this.subscriberClient) {
      await this.subscriberClient.quit()
    }
    if (this.publisherClient) {
      await this.publisherClient.quit()
    }
    logger.info('✓ Redis Service disconnected')
  }
}

export default new RedisService()
