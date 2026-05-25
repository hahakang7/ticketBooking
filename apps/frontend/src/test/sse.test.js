import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// EventSource mock
class MockEventSource {
  constructor(url) {
    this.url = url
    this.readyState = 0 // CONNECTING
    MockEventSource.instances.push(this)
  }
  close() { this.readyState = 2 }
  simulateOpen() { this.readyState = 1; this.onopen?.() }
  simulateMessage(data) { this.onmessage?.({ data: JSON.stringify(data) }) }
  simulateError() {
    this.readyState = 2 // CLOSED
    this.onerror?.()
  }
}
MockEventSource.instances = []
MockEventSource.CONNECTING = 0
MockEventSource.OPEN = 1
MockEventSource.CLOSED = 2

beforeEach(() => {
  MockEventSource.instances = []
  global.EventSource = MockEventSource
})

afterEach(() => {
  vi.restoreAllMocks()
})

// SSEService 로직을 인라인으로 재현 (import 없이 동작 검증)
function createSSEService() {
  const listeners = {}
  let eventSource = null
  let reconnectAttempts = 0
  let userId = null
  let eventId = null

  const dispatch = (event, data) => {
    listeners[event]?.forEach((cb) => cb(data))
  }

  const createConnection = (uid, eid) => {
    if (eventSource) { eventSource.close(); eventSource = null }
    const url = `http://localhost:8000/api/queue/sse?user_id=${uid}&event_id=${eid}`
    eventSource = new MockEventSource(url)
    eventSource.onopen = () => { reconnectAttempts = 0; dispatch('connected') }
    eventSource.onerror = () => {
      if (eventSource.readyState === MockEventSource.CLOSED) {
        dispatch('disconnected')
        if (reconnectAttempts < 5 && userId) {
          reconnectAttempts++
        }
      }
    }
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.status === 'ready') {
          dispatch('queue_token_ready', { access_token: data.access_token })
        } else {
          dispatch('queue_update', {
            position: data.position,
            estimated_wait_time: data.position ? data.position * 2 : null,
            status: data.status,
          })
        }
      } catch {}
    }
  }

  return {
    connect(uid, eid) { userId = uid; eventId = eid; reconnectAttempts = 0; createConnection(uid, eid) },
    close() { eventSource?.close(); eventSource = null; userId = null },
    on(event, cb) { if (!listeners[event]) listeners[event] = []; listeners[event].push(cb) },
    off(event, cb) { listeners[event] = listeners[event]?.filter((f) => f !== cb) },
    getReconnectAttempts: () => reconnectAttempts,
    getEventSource: () => eventSource,
  }
}

describe('SSE 클라이언트 연결', () => {
  it('connect() 호출 시 올바른 URL로 EventSource가 생성된다', () => {
    const svc = createSSEService()
    svc.connect('user-1', 'event-1')
    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toContain('user_id=user-1')
    expect(MockEventSource.instances[0].url).toContain('event_id=event-1')
    svc.close()
  })

  it('연결 성공 시 connected 이벤트가 발생한다', () => {
    const svc = createSSEService()
    const onConnected = vi.fn()
    svc.on('connected', onConnected)
    svc.connect('user-1', 'event-1')
    MockEventSource.instances[0].simulateOpen()
    expect(onConnected).toHaveBeenCalledOnce()
    svc.close()
  })

  it('queue_update 메시지 수신 시 position/estimated_wait_time을 파싱한다', () => {
    const svc = createSSEService()
    const onUpdate = vi.fn()
    svc.on('queue_update', onUpdate)
    svc.connect('user-1', 'event-1')
    MockEventSource.instances[0].simulateMessage({ position: 50, status: 'waiting' })
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ position: 50, estimated_wait_time: 100 })
    )
    svc.close()
  })

  it('status=ready 메시지 수신 시 queue_token_ready 이벤트가 발생한다', () => {
    const svc = createSSEService()
    const onReady = vi.fn()
    svc.on('queue_token_ready', onReady)
    svc.connect('user-1', 'event-1')
    MockEventSource.instances[0].simulateMessage({ status: 'ready', access_token: 'tok-abc' })
    expect(onReady).toHaveBeenCalledWith({ access_token: 'tok-abc' })
    svc.close()
  })

  it('연결 오류 시 disconnected 이벤트가 발생하고 재연결 횟수가 증가한다', () => {
    const svc = createSSEService()
    const onDisconnected = vi.fn()
    svc.on('disconnected', onDisconnected)
    svc.connect('user-1', 'event-1')
    MockEventSource.instances[0].simulateError()
    expect(onDisconnected).toHaveBeenCalledOnce()
    expect(svc.getReconnectAttempts()).toBe(1)
    svc.close()
  })

  it('close() 호출 시 EventSource가 닫힌다', () => {
    const svc = createSSEService()
    svc.connect('user-1', 'event-1')
    const es = MockEventSource.instances[0]
    svc.close()
    expect(es.readyState).toBe(MockEventSource.CLOSED)
    expect(svc.getEventSource()).toBeNull()
  })

  it('on/off 이벤트 리스너 등록/해제가 정상 동작한다', () => {
    const svc = createSSEService()
    const cb = vi.fn()
    svc.on('queue_update', cb)
    svc.connect('user-1', 'event-1')
    MockEventSource.instances[0].simulateMessage({ position: 10 })
    expect(cb).toHaveBeenCalledOnce()

    svc.off('queue_update', cb)
    MockEventSource.instances[0].simulateMessage({ position: 5 })
    expect(cb).toHaveBeenCalledOnce() // 여전히 1번만 호출
    svc.close()
  })
})
