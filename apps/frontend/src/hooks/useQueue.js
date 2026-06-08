import { useState, useEffect, useCallback, useRef } from 'react'
import { sseService, api, storageService } from '../services'

// VITE_MOCK_QUEUE=true 로 설정하면 Core API 없이 프론트 단독 개발 가능
const IS_MOCK = import.meta.env.VITE_MOCK_QUEUE === 'true'

// 목 모드: 대기 → 순번 카운트다운 → 입장 시뮬레이션
function runMockQueue(onUpdate, onReady) {
  let position = 150
  const estimatedWaitTime = 30 // 초

  onUpdate({ position, estimated_wait_time: estimatedWaitTime })

  const interval = setInterval(() => {
    position -= 10
    if (position <= 0) {
      clearInterval(interval)
      onReady({ access_token: 'mock-access-token-dev' })
    } else {
      onUpdate({
        position,
        estimated_wait_time: Math.max(estimatedWaitTime - (150 - position) / 5, 1),
      })
    }
  }, 2000)

  return () => clearInterval(interval)
}

export const useQueue = () => {
  const [position, setPosition] = useState(null)
  const [estimatedWaitTime, setEstimatedWaitTime] = useState(null)
  const [status, setStatus] = useState('idle')
  const [accessToken, setAccessToken] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const mockCleanupRef = useRef(null)

  useEffect(() => {
    const handleConnected = () => { setIsConnected(true); setError(null) }
    const handleDisconnected = () => setIsConnected(false)
    const handleError = () => { setError('실시간 연결 오류가 발생했습니다.'); setIsConnected(false) }
    const handleQueueUpdate = (data) => {
      setPosition(data.position)
      setEstimatedWaitTime(data.estimated_wait_time)
      if (data.status) setStatus(data.status)
    }
    const handleTokenReady = (data) => {
      storageService.setAccessToken(data.access_token)
      setAccessToken(data.access_token)
      setStatus('ready')
      sseService.close()
    }

    const handleTokenExpired = () => {
      storageService.removeQueueToken()
      storageService.removeQueueUser()
      setStatus('error')
      setError('대기 토큰이 만료되었습니다. 다시 대기열에 참가해 주세요.')
    }

    sseService.on('connected', handleConnected)
    sseService.on('disconnected', handleDisconnected)
    sseService.on('error', handleError)
    sseService.on('queue_update', handleQueueUpdate)
    sseService.on('queue_token_ready', handleTokenReady)
    sseService.on('token_expired', handleTokenExpired)

    const existingToken = storageService.getQueueToken()
    const queueUser = storageService.getQueueUser()
    if (existingToken && queueUser && !IS_MOCK) {
      setStatus('waiting')
      sseService.connect(queueUser.userId, queueUser.eventId, existingToken)
    }

    return () => {
      sseService.off('connected', handleConnected)
      sseService.off('disconnected', handleDisconnected)
      sseService.off('error', handleError)
      sseService.off('queue_update', handleQueueUpdate)
      sseService.off('queue_token_ready', handleTokenReady)
      sseService.off('token_expired', handleTokenExpired)
      if (mockCleanupRef.current) mockCleanupRef.current()
    }
  }, [])

  const joinQueue = useCallback(async (eventId, userId) => {
    setLoading(true)
    setError(null)
    setStatus('joining')

    if (IS_MOCK) {
      await new Promise((r) => setTimeout(r, 800))
      storageService.setQueueToken('mock-queue-token-dev')
      setStatus('waiting')
      setIsConnected(true)
      setLoading(false)

      const cleanup = runMockQueue(
        (data) => {
          setPosition(data.position)
          setEstimatedWaitTime(data.estimated_wait_time)
        },
        (data) => {
          storageService.setAccessToken(data.access_token)
          setAccessToken(data.access_token)
          setStatus('ready')
        }
      )
      mockCleanupRef.current = cleanup
      return
    }

    try {
      // api.post 가 ApiResponse<T> 전체를 반환하므로 .data로 실제 데이터 접근
      const response = await api.post('/queue/join', {
        event_id: eventId,
        user_id: userId,
      })
      const inner = response?.data ?? response
      storageService.setQueueToken(inner.queue_token)
      storageService.setQueueUser(userId, eventId)
      setPosition(inner.position)
      setStatus('waiting')
      sseService.connect(userId, eventId, inner.queue_token)
    } catch (err) {
      const msg = err.response?.data?.message || '대기열 진입에 실패했습니다.'
      setError(msg)
      setStatus('error')
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    position,
    estimatedWaitTime,
    status,
    accessToken,
    loading,
    error,
    isConnected,
    isMock: IS_MOCK,
    joinQueue,
  }
}
