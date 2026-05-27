import jwt from 'jsonwebtoken'
import { config } from '../config.js'

export const authMiddleware = (socket, next) => {
  const token =
    socket.handshake.auth.token ||
    socket.handshake.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    console.warn(`⚠️ No auth token for socket ${socket.id}, allowing connection`)
    return next()
  }

  if (!config.JWT_SECRET) {
    // JWT_SECRET 미설정 시 개발 환경처럼 허용 (운영에선 반드시 설정)
    console.warn('⚠️ JWT_SECRET not configured, skipping token verification')
    return next()
  }

  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] })
    socket.data.userId = payload.sub
    socket.data.eventId = payload.event_id
  } catch {
    // 토큰 검증 실패 — 실시간 브로드캐스트만 허용, hold 해제 대상에서 제외
    console.warn(`⚠️ Invalid token for socket ${socket.id}, userId not set`)
  }

  next()
}
