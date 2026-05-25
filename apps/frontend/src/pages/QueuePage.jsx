import React, { useState, useEffect } from 'react'
import { useQueue } from '../hooks/useQueue'
import QueueStatus from '../components/QueueStatus/QueueStatus'
import { Loading } from '../components/shared'
import api from '../services/api'

// 개발용 고정 UUID — seed.py dev 사용자와 일치
const DEV_USER_ID = '00000000-0000-0000-0000-000000000001'

export default function QueuePage({ onReady }) {
  const [eventId, setEventId] = useState(null)
  const userId = import.meta.env.VITE_USER_ID || DEV_USER_ID

  const { position, estimatedWaitTime, status, accessToken, loading, error, isConnected, isMock, joinQueue } =
    useQueue()

  // 실제 event_id를 DB에서 조회
  useEffect(() => {
    api.get('/v1/events')
      .then(res => {
        const items = res?.data?.items ?? res?.items ?? []
        setEventId(items.length > 0 ? items[0].event_id : 'evt-default')
      })
      .catch(() => setEventId('evt-default'))
  }, [])

  useEffect(() => {
    if (status === 'ready' && accessToken) {
      onReady?.(accessToken)
    }
  }, [status, accessToken, onReady])

  if (loading || eventId === null) {
    return <Loading message="초기화 중..." />
  }

  if (status === 'idle') {
    return (
      <div className="queue-page">
        <div className="queue-join-screen">
          {isMock && (
            <div className="queue-mock-badge">⚙️ 개발 목 모드 (백엔드 없이 시뮬레이션)</div>
          )}
          <h1>티켓 예매 대기열</h1>
          <p>대기열에 입장하여 좌석을 선택하세요.</p>
          {error && <div className="queue-error">{error}</div>}
          <button className="btn-primary" onClick={() => joinQueue(eventId, userId)}>
            대기열 입장
          </button>
        </div>
      </div>
    )
  }

  if (status === 'joining') {
    return <Loading message="대기열 진입 중..." />
  }

  if (status === 'waiting') {
    return (
      <div className="queue-page">
        <QueueStatus
          position={position}
          estimatedWaitTime={estimatedWaitTime}
          isConnected={isConnected}
          error={error}
        />
      </div>
    )
  }

  if (status === 'ready') {
    return (
      <div className="queue-page">
        <div className="queue-ready-screen">
          <h2>입장 준비 완료!</h2>
          <p>좌석 선택 화면으로 이동합니다...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="queue-page">
      <div className="queue-error-screen">
        <h2>오류 발생</h2>
        <p>{error || '알 수 없는 오류가 발생했습니다.'}</p>
        <button className="btn-primary" onClick={() => joinQueue(eventId, userId)}>
          다시 시도
        </button>
      </div>
    </div>
  )
}
