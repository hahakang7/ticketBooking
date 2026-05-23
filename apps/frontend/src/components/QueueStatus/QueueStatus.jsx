import React from 'react'
import WaitTimeGauge from './WaitTimeGauge'
import './QueueStatus.css'

function formatWaitTime(seconds) {
  if (seconds == null) return '계산 중...'
  const minutes = Math.ceil(seconds / 60)
  return `약 ${minutes}분`
}

export default function QueueStatus({ position, estimatedWaitTime, isConnected, error }) {
  return (
    <div className="queue-status">
      <div className="queue-status__header">
        <h1 className="queue-status__title">대기 중입니다</h1>
        <div className={`queue-status__indicator ${isConnected ? 'connected' : 'disconnected'}`}>
          {isConnected ? '● 실시간 연결됨' : '● 재연결 중...'}
        </div>
      </div>

      {error && <div className="queue-status__error">{error}</div>}

      <div className="queue-status__cards">
        <div className="queue-card">
          <div className="queue-card__label">현재 위치</div>
          <div className="queue-card__value">
            {position != null ? `${position}번` : '—'}
          </div>
        </div>
        <div className="queue-card">
          <div className="queue-card__label">예상 대기 시간</div>
          <div className="queue-card__value">{formatWaitTime(estimatedWaitTime)}</div>
        </div>
      </div>

      {estimatedWaitTime != null && (
        <WaitTimeGauge estimatedWaitTime={estimatedWaitTime} />
      )}

      <div className="queue-status__message">
        <p>자리가 나면 자동으로 입장됩니다.</p>
        <p>페이지를 닫지 마세요.</p>
      </div>
    </div>
  )
}
