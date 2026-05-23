export const SOCKET_EVENTS = {
  // 연결
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  CONNECTION_ERROR: 'connect_error',
  
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

export const REDIS_KEYS = {
  SEAT_CHANNEL: 'seat_updates',
  EVENT_ROOMS: 'event_rooms',
  ACTIVE_CONNECTIONS: 'active_connections',
}

export const HEARTBEAT_INTERVAL = 25000 // 25초
export const CONNECTION_TIMEOUT = 30000 // 30초
