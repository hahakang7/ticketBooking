export const errorHandler = (error, socket) => {
  console.error('Socket error:', error)

  if (error.code === 'ERR_INVALID_EVENT_TYPE') {
    socket.emit('error', { message: '유효하지 않은 이벤트 타입입니다.' })
  } else if (error.code === 'ERR_UNAUTHORIZED') {
    socket.emit('error', { message: '인증되지 않았습니다.' })
  } else {
    socket.emit('error', { message: '서버 오류가 발생했습니다.' })
  }
}

export const handleError = (err, res) => {
  console.error(err)
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  })
}
