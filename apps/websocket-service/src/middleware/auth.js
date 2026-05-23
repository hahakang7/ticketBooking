export const authMiddleware = (socket, next) => {
  // Week 1에서는 기본 인증만 구현
  // 나중에 토큰 검증 로직 추가 예정

  const token = socket.handshake.auth.token || socket.handshake.headers.authorization

  if (!token) {
    // 기본적으로 모든 연결 허용 (개발 단계)
    console.warn(`⚠️ No auth token for socket ${socket.id}, allowing connection`)
  }

  next()
}
