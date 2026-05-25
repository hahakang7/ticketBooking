import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// 서비스 모킹
vi.mock('../services', () => {
  const listeners = {}
  const sseService = {
    on: vi.fn((event, cb) => { if (!listeners[event]) listeners[event] = []; listeners[event].push(cb) }),
    off: vi.fn((event, cb) => { listeners[event] = listeners[event]?.filter((f) => f !== cb) }),
    connect: vi.fn(),
    close: vi.fn(),
    _emit: (event, data) => listeners[event]?.forEach((cb) => cb(data)),
  }
  const api = { post: vi.fn() }
  const storageService = {
    getQueueToken: vi.fn(() => null),
    getQueueUser: vi.fn(() => null),
    setQueueToken: vi.fn(),
    setQueueUser: vi.fn(),
    setAccessToken: vi.fn(),
    getAccessToken: vi.fn(() => null),
  }
  return { sseService, api, storageService }
})

import { useQueue } from '../hooks/useQueue.js'
import { sseService, api, storageService } from '../services'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useQueue Hook', () => {
  it('초기 상태는 idle이고 position/error가 null이다', () => {
    const { result } = renderHook(() => useQueue())
    expect(result.current.status).toBe('idle')
    expect(result.current.position).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('joinQueue 호출 시 status가 joining → waiting으로 변한다', async () => {
    api.post.mockResolvedValue({
      data: { queue_token: 'token-q', position: 100 },
    })

    const { result } = renderHook(() => useQueue())

    await act(async () => {
      await result.current.joinQueue('event-1', 'user-1')
    })

    expect(result.current.status).toBe('waiting')
    expect(result.current.position).toBe(100)
    expect(storageService.setQueueToken).toHaveBeenCalledWith('token-q')
    expect(sseService.connect).toHaveBeenCalledWith('user-1', 'event-1')
  })

  it('joinQueue API 실패 시 status가 error로 변하고 에러 메시지가 설정된다', async () => {
    api.post.mockRejectedValue({
      response: { data: { message: '대기열 진입에 실패했습니다.' } },
    })

    const { result } = renderHook(() => useQueue())

    await act(async () => {
      await result.current.joinQueue('event-1', 'user-1')
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('대기열 진입에 실패했습니다.')
  })

  it('queue_update 이벤트 수신 시 position과 estimatedWaitTime이 업데이트된다', async () => {
    const { result } = renderHook(() => useQueue())

    act(() => {
      sseService._emit('queue_update', { position: 75, estimated_wait_time: 15 })
    })

    expect(result.current.position).toBe(75)
    expect(result.current.estimatedWaitTime).toBe(15)
  })

  it('queue_token_ready 이벤트 수신 시 status가 ready가 되고 accessToken이 저장된다', async () => {
    const { result } = renderHook(() => useQueue())

    act(() => {
      sseService._emit('queue_token_ready', { access_token: 'access-tok-xyz' })
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.accessToken).toBe('access-tok-xyz')
    expect(storageService.setAccessToken).toHaveBeenCalledWith('access-tok-xyz')
    expect(sseService.close).toHaveBeenCalled()
  })

  it('SSE error 이벤트 수신 시 isConnected가 false가 된다', async () => {
    const { result } = renderHook(() => useQueue())

    act(() => { sseService._emit('connected') })
    expect(result.current.isConnected).toBe(true)

    act(() => { sseService._emit('error') })
    expect(result.current.isConnected).toBe(false)
    expect(result.current.error).toBeTruthy()
  })

  it('컴포넌트 언마운트 시 SSE 리스너가 해제된다', () => {
    const { unmount } = renderHook(() => useQueue())
    unmount()
    expect(sseService.off).toHaveBeenCalled()
  })
})
