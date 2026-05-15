# WebSocket API 명세서

## 개요

Socket.IO 기반의 실시간 좌석 동기화 및 이벤트 서비스입니다.

---

## 연결

**서버:** `ws://localhost:3000` (또는 `wss://` for HTTPS)

**프로토콜:** Socket.IO v4.x

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  transports: ['websocket'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5
});
```

---

## 클라이언트 → 서버 이벤트

### 1. 이벤트 실시간 채널 구독
**Event:** `subscribe_event`

특정 이벤트의 실시간 좌석 업데이트를 구독합니다.

**데이터:**
```json
{
  "event_id": "string (UUID)",
  "access_token": "string"
}
```

**응답:**
```json
{
  "success": true,
  "event_id": "string",
  "message": "구독 성공"
}
```

---

### 2. 이벤트 채널 구독 취소
**Event:** `unsubscribe_event`

구독 중인 이벤트 채널을 구독 취소합니다.

**데이터:**
```json
{
  "event_id": "string"
}
```

---

### 3. 좌석 임시 점유 알림
**Event:** `seat_hold`

좌석을 임시로 점유했음을 서버에 알립니다. (UI 상태 싱크)

**데이터:**
```json
{
  "event_id": "string",
  "seat_ids": ["string"],
  "reservation_id": "string",
  "hold_duration": 300
}
```

---

### 4. 좌석 선택 취소 알림
**Event:** `seat_unhold`

임시 점유를 취소했음을 서버에 알립니다.

**데이터:**
```json
{
  "event_id": "string",
  "seat_ids": ["string"],
  "reservation_id": "string"
}
```

---

## 서버 → 클라이언트 이벤트

### 1. 좌석 상태 업데이트
**Event:** `seat_status_updated`

한 명 이상의 좌석 상태가 변경되었을 때 전파됩니다. (발생 빈도: 0.1초 이내)

**데이터:**
```json
{
  "event_id": "string",
  "timestamp": "string (ISO 8601)",
  "updates": [
    {
      "seat_id": "string",
      "status": "available|hold|sold",
      "held_by": "string (UUID, hold 상태일 때)",
      "held_until": "string (ISO 8601, hold 상태일 때)"
    }
  ]
}
```

---

### 2. 좌석 예약 완료
**Event:** `seat_reserved`

좌석이 최종 결제 완료되었을 때 전파됩니다.

**데이터:**
```json
{
  "event_id": "string",
  "seat_ids": ["string"],
  "buyer_user_id": "string (사용자 식별용 암호화)",
  "reserved_at": "string (ISO 8601)"
}
```

---

### 3. 좌석 임시 점유 타임아웃
**Event:** `seat_hold_expired`

점유 시간(TTL)이 만료되어 좌석이 다시 사용 가능해졌을 때 전파됩니다.

**데이터:**
```json
{
  "event_id": "string",
  "seat_ids": ["string"],
  "expired_at": "string (ISO 8601)"
}
```

---

### 4. 실시간 가용 좌석 요약
**Event:** `seat_availability_summary`

주기적으로(매 30초) 전체 가용 좌석 수를 전파합니다.

**데이터:**
```json
{
  "event_id": "string",
  "total_seats": "integer",
  "available_seats": "integer",
  "held_seats": "integer",
  "sold_seats": "integer",
  "percentage_sold": "number (0-100)",
  "timestamp": "string (ISO 8601)"
}
```

---

### 5. 구독 확인
**Event:** `subscription_confirmed`

이벤트 채널 구독이 성공했을 때 서버가 전송합니다.

**데이터:**
```json
{
  "event_id": "string",
  "room": "string (내부 사용)",
  "clients_in_room": "integer"
}
```

---

### 6. 연결 정보
**Event:** `connection_info`

클라이언트 연결 직후 전송됩니다.

**데이터:**
```json
{
  "socket_id": "string",
  "server_time": "string (ISO 8601)",
  "version": "string"
}
```

---

### 7. 에러 이벤트
**Event:** `error`

오류 발생 시 전파됩니다.

**데이터:**
```json
{
  "error_code": "string",
  "message": "string",
  "details": "object (선택사항)"
}
```

---

## 에러 처리

### 공통 에러 코드
- `INVALID_TOKEN`: 유효하지 않은 토큰
- `EVENT_NOT_FOUND`: 존재하지 않는 이벤트
- `UNAUTHORIZED`: 인증 실패
- `RATE_LIMIT`: 요청 제한 초과
- `SERVER_ERROR`: 서버 오류

### 클라이언트 재연결 전략
```javascript
socket.on('disconnect', (reason) => {
  if (reason === 'io server disconnect') {
    // 서버가 클라이언트 연결 해제
    socket.connect();
  }
  // 'io client namespace disconnect'인 경우 자동 재연결
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
});
```

---

## 사용 예시

### 예시 1: 이벤트 구독 및 좌석 상태 모니터링

```javascript
const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('Connected to WebSocket server');

  // 이벤트 구독
  socket.emit('subscribe_event', {
    event_id: 'evt-123',
    access_token: 'token-abc'
  });
});

socket.on('seat_status_updated', (data) => {
  console.log('좌석 상태 변경:', data.updates);
  
  // UI 업데이트
  data.updates.forEach(update => {
    updateSeatUI(update.seat_id, update.status);
  });
});

socket.on('seat_reserved', (data) => {
  console.log('좌석 예약 완료:', data.seat_ids);
});

socket.on('error', (error) => {
  console.error('WebSocket error:', error);
});
```

### 예시 2: 좌석 임시 점유 알림

```javascript
// 사용자가 좌석을 선택했을 때
socket.emit('seat_hold', {
  event_id: 'evt-123',
  seat_ids: ['A1', 'A2'],
  reservation_id: 'res-456',
  hold_duration: 300
});

// 좌석 선택을 취소했을 때
socket.emit('seat_unhold', {
  event_id: 'evt-123',
  seat_ids: ['A1', 'A2'],
  reservation_id: 'res-456'
});
```

---

## 성능 특성

| 지표 | 목표 |
|------|------|
| 메시지 전파 지연 (Latency) | < 100ms (P95) |
| 동시 연결 수 | 10,000+ |
| 메시지 처리량 | 50,000+ msg/sec |
| 메모리 사용량 (per connection) | < 1MB |

---

## 주요 설정값

```javascript
// 서버 설정 (src/socket.js)
io.engine.maxHttpBufferSize = 1e6; // 1MB
io.engine.pingInterval = 25000;    // 25초
io.engine.pingTimeout = 60000;     // 60초
```

---

## Redis Pub/Sub 통합

여러 WebSocket 서버 인스턴스 간 메시지 동기화:

```
Redis Channel: event:{event_id}:seat_updates
Redis Channel: event:{event_id}:reservations
```

각 서버 인스턴스가 Redis Pub/Sub을 구독하여 모든 클라이언트에 동일한 메시지를 전파합니다.
