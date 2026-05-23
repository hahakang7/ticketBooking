import React, { useState, useEffect } from 'react'

export default function WaitTimeGauge({ estimatedWaitTime }) {
  const [elapsed, setElapsed] = useState(0)

  // estimatedWaitTime이 바뀌면 경과 시간 리셋
  useEffect(() => {
    setElapsed(0)
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [estimatedWaitTime])

  const total = estimatedWaitTime || 1
  const progress = Math.min((elapsed / total) * 100, 100)
  const remaining = Math.max(total - elapsed, 0)
  const remainingMin = Math.ceil(remaining / 60)
  const elapsedMin = Math.floor(elapsed / 60)

  return (
    <div className="wait-gauge">
      <div className="wait-gauge__bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <div className="wait-gauge__fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="wait-gauge__labels">
        <span>경과 {elapsedMin}분</span>
        <span>남은 시간 {remainingMin}분</span>
      </div>
    </div>
  )
}
