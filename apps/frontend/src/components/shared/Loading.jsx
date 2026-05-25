import React from 'react'
import './Loading.css'

const Loading = ({ size = 'md', text = '로딩 중...' }) => {
  return (
    <div className="loading-container">
      <div className={`loading-spinner loading-${size}`}></div>
      {text && <p className="loading-text">{text}</p>}
    </div>
  )
}

export default Loading
