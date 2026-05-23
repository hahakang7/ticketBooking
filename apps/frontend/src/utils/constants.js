// API 엔드포인트
export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/auth/login',
    LOGOUT: '/auth/logout',
    REFRESH: '/auth/refresh',
  },
  QUEUE: {
    JOIN: '/queue/join',
    STATUS: '/queue/status',
    TOKEN: '/queue/token',
  },
  EVENTS: {
    LIST: '/events',
    DETAIL: '/events/:id',
  },
  SEATS: {
    LIST: '/events/:eventId/seats',
    SELECT: '/events/:eventId/seats/select',
    HOLD: '/events/:eventId/seats/hold',
  },
  PAYMENTS: {
    CREATE: '/payments',
    CONFIRM: '/payments/:id/confirm',
  },
}

// 좌석 상태
export const SEAT_STATUS = {
  AVAILABLE: 'available',
  HOLD: 'hold',
  SOLD: 'sold',
  SELECTED: 'selected',
  UNAVAILABLE: 'unavailable',
}

// 결제 상태
export const PAYMENT_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
}

// 대기열 상태
export const QUEUE_STATUS = {
  WAITING: 'waiting',
  READY: 'ready',
  EXPIRED: 'expired',
}

// WebSocket 이벤트
export const SOCKET_EVENTS = {
  // 연결
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
  
  // 구독
  SUBSCRIBE_EVENT: 'subscribe_event',
  SUBSCRIPTION_CONFIRMED: 'subscription_confirmed',
  
  // 좌석
  SEAT_STATUS_UPDATED: 'seat_status_updated',
  SEAT_HOLD_EXPIRED: 'seat_hold_expired',
  SEAT_AVAILABILITY_SUMMARY: 'seat_availability_summary',
  
  // 연결 정보
  CONNECTION_INFO: 'connection_info',
  HEARTBEAT: 'heartbeat',
}

// 토스트 타입
export const TOAST_TYPES = {
  SUCCESS: 'success',
  DANGER: 'danger',
  WARNING: 'warning',
  INFO: 'info',
}

// 환경
export const ENVIRONMENT = {
  DEV: 'development',
  PROD: 'production',
}
