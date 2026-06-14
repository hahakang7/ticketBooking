/**
 * Redis 좌석 업데이트 발행자
 *
 * k6 WS/SSE 벤치마크와 함께 실행하여 실제 Redis Pub/Sub 경로를 통한
 * 메시지 지연 시간을 측정하기 위한 보조 스크립트.
 *
 * 사용법:
 *   node redis-publisher.js
 *   REDIS_URL=redis://localhost:6379 EVENT_ID=<uuid> INTERVAL_MS=500 node redis-publisher.js
 */

import { createClient } from 'redis'

const REDIS_URL   = process.env.REDIS_URL   || 'redis://localhost:6379'
const EVENT_ID    = process.env.EVENT_ID    || 'test-event-bench-001'
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '500')
const TOTAL_MSGS  = parseInt(process.env.TOTAL_MSGS  || '60')   // 0 = 무제한

const client = createClient({ url: REDIS_URL })

client.on('error', (e) => console.error('[publisher] Redis error:', e.message))

await client.connect()
console.log(`[publisher] Connected to Redis: ${REDIS_URL}`)
console.log(`[publisher] Event: ${EVENT_ID}, interval: ${INTERVAL_MS}ms, total: ${TOTAL_MSGS || '∞'}`)

const SEAT_IDS = [
  'seat-aaa', 'seat-bbb', 'seat-ccc', 'seat-ddd',
  'seat-eee', 'seat-fff', 'seat-ggg', 'seat-hhh',
]
const STATUSES = ['hold', 'available', 'sold']

let count = 0

const publish = async () => {
  count++
  const seatId  = SEAT_IDS[count % SEAT_IDS.length]
  const status  = STATUSES[count % STATUSES.length]
  const payload = {
    event_id: EVENT_ID,
    seats: [{ seat_id: seatId, status }],
    timestamp: new Date().toISOString(),
    seq: count,
  }

  const channel = `seat_updates:${EVENT_ID}`
  const subscribers = await client.publish(channel, JSON.stringify(payload))
  console.log(`[publisher] #${count} → ${channel} (${subscribers} subscribers)  ${seatId}:${status}`)
}

const interval = setInterval(async () => {
  try {
    await publish()
    if (TOTAL_MSGS > 0 && count >= TOTAL_MSGS) {
      clearInterval(interval)
      await client.quit()
      console.log(`[publisher] Done — ${count} messages sent`)
    }
  } catch (e) {
    console.error('[publisher] Error:', e.message)
  }
}, INTERVAL_MS)

process.on('SIGINT', async () => {
  clearInterval(interval)
  await client.quit()
  console.log(`\n[publisher] Stopped after ${count} messages`)
  process.exit(0)
})
