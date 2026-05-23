import React, { useEffect, useState } from 'react'
import './Toast.css'

const Toast = ({ message, type = 'info', duration = 3000, onClose }) => {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false)
      setTimeout(onClose, 300)
    }, duration)

    return () => clearTimeout(timer)
  }, [duration, onClose])

  return (
    <div className={`toast toast-${type} ${isVisible ? 'show' : 'hide'}`}>
      <div className="toast-icon">
        {type === 'success' && '✓'}
        {type === 'danger' && '✕'}
        {type === 'warning' && '⚠'}
        {type === 'info' && 'ℹ'}
      </div>
      <div className="toast-message">{message}</div>
      <button className="toast-close" onClick={() => setIsVisible(false)}>
        ✕
      </button>
    </div>
  )
}

export default Toast
