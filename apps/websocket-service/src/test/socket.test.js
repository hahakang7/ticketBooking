import { createServer } from 'http'
import { Server } from 'socket.io'
import { io as ioc } from 'socket.io-client'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import SocketService from '../services/socket-service.js'
import EventService from '../services/event-service.js'
import SeatService from '../services/seat-service.js'
import { setupConnectionEvents } from '../events/connection.js'
import { setupSubscriptionEvents } from '../events/subscription.js'

function createTestServer() {
  const httpServer = createServer()
  const io = new Server(httpServer, { transports: ['websocket'] })

  const socketService = new SocketService(io)
  const eventService = new EventService(io, socketService)
  const seatService = new SeatService(io)

  setupConnectionEvents(io, socketService, eventService)
  setupSubscriptionEvents(io, eventService, seatService)

  return { httpServer, io, socketService, eventService, seatService }
}

function waitFor(socket, event, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeout)
    socket.once(event, (data) => { clearTimeout(timer); resolve(data) })
  })
}

function connectClient(port) {
  return ioc(`http://localhost:${port}`, {
    transports: ['websocket'],
    forceNew: true,
  })
}

let httpServer, io, seatService, port

beforeAll(() => new Promise((resolve) => {
  const setup = createTestServer()
  httpServer = setup.httpServer
  io = setup.io
  seatService = setup.seatService
  httpServer.listen(0, () => {
    port = httpServer.address().port
    resolve()
  })
}))

afterAll(() => new Promise((resolve) => {
  io.close()
  httpServer.close(resolve)
}))

// ─── 연결 테스트 ───────────────────────────────────────────────────────────────

describe('Socket.IO 클라이언트 연결', () => {
  it('서버에 연결되고 connection_info 이벤트를 수신한다', async () => {
    const client = connectClient(port)
    const data = await waitFor(client, 'connection_info')

    expect(data).toHaveProperty('socket_id')
    expect(data).toHaveProperty('server_time')
    expect(data).toHaveProperty('version', '1.0.0')
    client.disconnect()
  })

  it('연결 해제 시 서버 connections 맵에서 제거된다', async () => {
    const client = connectClient(port)
    await waitFor(client, 'connection_info')

    const socketId = client.id
    client.disconnect()
    await new Promise((r) => setTimeout(r, 100))

    const stats = io.engine.clientsCount
    expect(stats).toBe(0)
  })
})

// ─── 이벤트 구독 테스트 ────────────────────────────────────────────────────────

describe('subscribe_event / 기본 이벤트 송수신', () => {
  it('subscribe_event 발송 후 subscription_confirmed 수신', async () => {
    const client = connectClient(port)
    await waitFor(client, 'connection_info')

    client.emit('subscribe_event', { event_id: 'evt-001' })
    const confirmed = await waitFor(client, 'subscription_confirmed')

    expect(confirmed).toHaveProperty('event_id', 'evt-001')
    expect(confirmed).toHaveProperty('room')
    client.disconnect()
  })

  it('seat_hold 이벤트 → 같은 방의 클라이언트가 seat_status_updated 수신', async () => {
    const client1 = connectClient(port)
    const client2 = connectClient(port)
    await Promise.all([waitFor(client1, 'connection_info'), waitFor(client2, 'connection_info')])

    client1.emit('subscribe_event', { event_id: 'evt-002' })
    client2.emit('subscribe_event', { event_id: 'evt-002' })
    await Promise.all([
      waitFor(client1, 'subscription_confirmed'),
      waitFor(client2, 'subscription_confirmed'),
    ])

    const updatePromise = waitFor(client2, 'seat_status_updated')
    client1.emit('seat_hold', { event_id: 'evt-002', seat_ids: ['seat-1', 'seat-2'] })
    const update = await updatePromise

    expect(update.event_id).toBe('evt-002')
    expect(update.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ seat_id: 'seat-1', status: 'hold' }),
        expect.objectContaining({ seat_id: 'seat-2', status: 'hold' }),
      ])
    )
    client1.disconnect()
    client2.disconnect()
  })

  it('seat_unhold 이벤트 → available 상태로 브로드캐스트', async () => {
    const client = connectClient(port)
    await waitFor(client, 'connection_info')
    client.emit('subscribe_event', { event_id: 'evt-003' })
    await waitFor(client, 'subscription_confirmed')

    const updatePromise = waitFor(client, 'seat_status_updated')
    client.emit('seat_unhold', { event_id: 'evt-003', seat_ids: ['seat-5'] })
    const update = await updatePromise

    expect(update.updates[0]).toMatchObject({ seat_id: 'seat-5', status: 'available' })
    client.disconnect()
  })

  it('request_seat_summary → seat_availability_summary 응답', async () => {
    const client = connectClient(port)
    await waitFor(client, 'connection_info')
    client.emit('subscribe_event', { event_id: 'evt-004' })
    await waitFor(client, 'subscription_confirmed')

    const summaryPromise = waitFor(client, 'seat_availability_summary')
    client.emit('request_seat_summary', { event_id: 'evt-004' })
    const summary = await summaryPromise

    expect(summary).toHaveProperty('eventId', 'evt-004')
    expect(summary).toHaveProperty('available')
    expect(summary).toHaveProperty('hold')
    expect(summary).toHaveProperty('sold')
    client.disconnect()
  })
})

// ─── 0.1초 이내 업데이트 성능 테스트 ─────────────────────────────────────────────

describe('0.1초 이내 업데이트 성능 테스트', () => {
  it('broadcastBatchSeatUpdate 후 100ms 이내에 클라이언트가 수신한다', async () => {
    const client = connectClient(port)
    await waitFor(client, 'connection_info')
    client.emit('subscribe_event', { event_id: 'perf-001' })
    await waitFor(client, 'subscription_confirmed')

    const start = Date.now()
    const updatePromise = waitFor(client, 'seat_status_updated')
    seatService.broadcastBatchSeatUpdate('perf-001', [{ seatId: 'seat-p1', status: 'hold' }])
    await updatePromise
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(100)
    client.disconnect()
  })

  it('seat_hold 이벤트도 100ms 이내에 브로드캐스트된다', async () => {
    const sender = connectClient(port)
    const receiver = connectClient(port)
    await Promise.all([waitFor(sender, 'connection_info'), waitFor(receiver, 'connection_info')])

    sender.emit('subscribe_event', { event_id: 'perf-002' })
    receiver.emit('subscribe_event', { event_id: 'perf-002' })
    await Promise.all([
      waitFor(sender, 'subscription_confirmed'),
      waitFor(receiver, 'subscription_confirmed'),
    ])

    const start = Date.now()
    const updatePromise = waitFor(receiver, 'seat_status_updated')
    sender.emit('seat_hold', { event_id: 'perf-002', seat_ids: ['seat-p2'] })
    await updatePromise
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(100)
    sender.disconnect()
    receiver.disconnect()
  })
})

// ─── 재연결 테스트 ────────────────────────────────────────────────────────────

describe('재연결 테스트', () => {
  it('클라이언트가 재연결 후 subscribe_event를 재발송하면 정상 구독된다', async () => {
    const client = connectClient(port)
    await waitFor(client, 'connection_info')
    client.emit('subscribe_event', { event_id: 'reconnect-001' })
    await waitFor(client, 'subscription_confirmed')

    // 연결 해제 후 재연결 시뮬레이션
    client.disconnect()
    await new Promise((r) => setTimeout(r, 100))

    const client2 = connectClient(port)
    await waitFor(client2, 'connection_info')
    client2.emit('subscribe_event', { event_id: 'reconnect-001' })
    const confirmed = await waitFor(client2, 'subscription_confirmed')

    expect(confirmed).toHaveProperty('event_id', 'reconnect-001')
    client2.disconnect()
  })

  it('재연결 후 해당 이벤트 룸의 브로드캐스트를 정상 수신한다', async () => {
    const client = connectClient(port)
    await waitFor(client, 'connection_info')
    client.emit('subscribe_event', { event_id: 'reconnect-002' })
    await waitFor(client, 'subscription_confirmed')

    client.disconnect()
    await new Promise((r) => setTimeout(r, 100))

    const client2 = connectClient(port)
    await waitFor(client2, 'connection_info')
    client2.emit('subscribe_event', { event_id: 'reconnect-002' })
    await waitFor(client2, 'subscription_confirmed')

    const updatePromise = waitFor(client2, 'seat_status_updated')
    seatService.broadcastBatchSeatUpdate('reconnect-002', [{ seatId: 'seat-r1', status: 'available' }])
    const update = await updatePromise

    expect(update.event_id).toBe('reconnect-002')
    client2.disconnect()
  })
})

// ─── 동시 100+ 연결 테스트 ────────────────────────────────────────────────────

describe('동시 100+ 연결 테스트', () => {
  it('100개 클라이언트가 동시에 연결되고 모두 connection_info를 수신한다', async () => {
    const COUNT = 100
    const clients = Array.from({ length: COUNT }, () => connectClient(port))
    const results = await Promise.all(clients.map((c) => waitFor(c, 'connection_info')))

    expect(results).toHaveLength(COUNT)
    results.forEach((r) => {
      expect(r).toHaveProperty('socket_id')
      expect(r).toHaveProperty('version', '1.0.0')
    })

    clients.forEach((c) => c.disconnect())
    await new Promise((r) => setTimeout(r, 200))
  }, 10000)

  it('100개 클라이언트가 같은 이벤트 구독 후 브로드캐스트를 모두 수신한다', async () => {
    const COUNT = 100
    const EVENT_ID = 'concurrent-001'
    const clients = Array.from({ length: COUNT }, () => connectClient(port))

    await Promise.all(clients.map((c) => waitFor(c, 'connection_info')))
    clients.forEach((c) => c.emit('subscribe_event', { event_id: EVENT_ID }))
    await Promise.all(clients.map((c) => waitFor(c, 'subscription_confirmed')))

    const receivePromises = clients.map((c) => waitFor(c, 'seat_status_updated', 3000))
    seatService.broadcastBatchSeatUpdate(EVENT_ID, [{ seatId: 'seat-c1', status: 'hold' }])
    const updates = await Promise.all(receivePromises)

    expect(updates).toHaveLength(COUNT)
    updates.forEach((u) => expect(u.event_id).toBe(EVENT_ID))

    clients.forEach((c) => c.disconnect())
    await new Promise((r) => setTimeout(r, 200))
  }, 15000)
})

// ─── seat_reserved 이벤트 테스트 ───────────────────────────────────────────────

describe('seat_reserved 이벤트 (broadcastBatchSeatUpdate)', () => {
  it('sold 상태 배치 업데이트 시 seat_status_updated + seat_reserved 모두 수신', async () => {
    const client = connectClient(port)
    await waitFor(client, 'connection_info')
    client.emit('subscribe_event', { event_id: 'evt-005' })
    await waitFor(client, 'subscription_confirmed')

    const statusPromise = waitFor(client, 'seat_status_updated')
    const reservedPromise = waitFor(client, 'seat_reserved')

    seatService.broadcastBatchSeatUpdate('evt-005', [
      { seatId: 'seat-10', status: 'sold' },
      { seatId: 'seat-11', status: 'sold' },
    ])

    const [statusUpdate, reserved] = await Promise.all([statusPromise, reservedPromise])

    expect(statusUpdate.updates).toHaveLength(2)
    expect(reserved.seat_ids).toEqual(expect.arrayContaining(['seat-10', 'seat-11']))
    client.disconnect()
  })

  it('available/hold 배치 업데이트 시 seat_reserved 이벤트는 발행하지 않음', async () => {
    const client = connectClient(port)
    await waitFor(client, 'connection_info')
    client.emit('subscribe_event', { event_id: 'evt-006' })
    await waitFor(client, 'subscription_confirmed')

    let reservedFired = false
    client.on('seat_reserved', () => { reservedFired = true })

    seatService.broadcastBatchSeatUpdate('evt-006', [
      { seatId: 'seat-20', status: 'hold' },
    ])

    await new Promise((r) => setTimeout(r, 200))
    expect(reservedFired).toBe(false)
    client.disconnect()
  })
})
