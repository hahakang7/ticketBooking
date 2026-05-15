# Core API 명세서

## 개요

FastAPI 기반 예매 시스템의 REST API 명세입니다.

---

## 1. 대기열 API (Queue Management)

### 1.1 대기열 진입
**POST** `/api/queue/join`

대기열에 진입하여 대기 토큰을 획득합니다.

**요청:**
```json
{
  "event_id": "string (UUID)",
  "user_id": "string (UUID)"
}
```

**응답 (200):**
```json
{
  "queue_token": "string",
  "position": "integer",
  "estimated_wait_time": "integer (초)",
  "expires_at": "string (ISO 8601)"
}
```

**에러:**
- `429` - 대기열 가득참
- `400` - 잘못된 이벤트 ID

---

### 1.2 대기 상태 조회
**GET** `/api/queue/status?token=<queue_token>`

현재 대기 순번과 예상 대기 시간을 조회합니다.

**응답 (200):**
```json
{
  "position": "integer",
  "estimated_wait_time": "integer (초)",
  "token_valid": "boolean",
  "expires_at": "string (ISO 8601)"
}
```

---

### 1.3 SSE - 대기 상태 실시간 업데이트
**GET** `/api/queue/sse?token=<queue_token>`

Server-Sent Events를 통한 실시간 대기 상태 업데이트.

**이벤트:**
```
event: queue_update
data: {
  "position": 150,
  "estimated_wait_time": 300,
  "status": "waiting"
}

event: queue_token_ready
data: {
  "access_token": "string",
  "expires_at": "string"
}
```

---

## 2. 좌석 API (Seat Management)

### 2.1 좌석 목록 조회
**GET** `/api/events/{event_id}/seats`

특정 이벤트의 모든 좌석 정보를 조회합니다.

**응답 (200):**
```json
{
  "event_id": "string",
  "sections": [
    {
      "section_id": "string",
      "rows": [
        {
          "row": "string (A, B, C...)",
          "seats": [
            {
              "seat_id": "string",
              "seat_number": "integer",
              "status": "available|hold|sold",
              "price": "number",
              "held_by": "string (UUID, hold 상태일 때만)",
              "held_until": "string (ISO 8601, hold 상태일 때만)"
            }
          ]
        }
      ]
    }
  ]
}
```

---

### 2.2 좌석 예약 (분산 락 적용)
**POST** `/api/events/{event_id}/seats/reserve`

좌석을 예약합니다. Redis Distributed Lock을 사용하여 동시성 제어.

**요청:**
```json
{
  "access_token": "string",
  "seat_ids": ["string"],
  "hold_duration_seconds": "integer (기본: 300)"
}
```

**응답 (200):**
```json
{
  "reservation_id": "string (UUID)",
  "seats": [
    {
      "seat_id": "string",
      "seat_number": "integer",
      "section": "string"
    }
  ],
  "total_price": "number",
  "hold_until": "string (ISO 8601)",
  "status": "held"
}
```

**에러:**
- `409` - 좌석 이미 점유됨 (중복 예매 방지)
- `401` - 유효하지 않은 access_token
- `404` - 좌석 없음

---

### 2.3 좌석 예약 취소
**DELETE** `/api/reservations/{reservation_id}`

임시 점유된 좌석을 취소하여 다시 사용 가능하게 합니다.

**요청:**
```json
{
  "access_token": "string"
}
```

**응답 (200):**
```json
{
  "reservation_id": "string",
  "status": "cancelled",
  "released_seats": ["string"]
}
```

---

## 3. 결제 API (Payment)

### 3.1 결제 요청
**POST** `/api/reservations/{reservation_id}/payment`

임시 점유된 좌석에 대해 최종 결제를 진행합니다.

**요청:**
```json
{
  "access_token": "string",
  "payment_method": "card|bank_transfer",
  "card_token": "string (card 방식 시)"
}
```

**응답 (200):**
```json
{
  "order_id": "string (UUID)",
  "status": "completed",
  "seats": ["string"],
  "total_amount": "number",
  "paid_at": "string (ISO 8601)",
  "ticket_download_url": "string"
}
```

**에러:**
- `402` - 결제 실패
- `410` - hold_until 시간 초과

---

### 3.2 주문 조회
**GET** `/api/orders/{order_id}`

구매 완료된 주문 정보를 조회합니다.

**응답 (200):**
```json
{
  "order_id": "string",
  "event_id": "string",
  "user_id": "string",
  "seats": ["string"],
  "total_amount": "number",
  "status": "completed",
  "created_at": "string (ISO 8601)",
  "ticket_url": "string"
}
```

---

## 4. 이벤트 API (Event Management)

### 4.1 이벤트 목록
**GET** `/api/events?page=1&limit=20`

예정된 이벤트 목록을 조회합니다.

**응답 (200):**
```json
{
  "total": "integer",
  "page": "integer",
  "items": [
    {
      "event_id": "string",
      "name": "string",
      "description": "string",
      "start_at": "string (ISO 8601)",
      "location": "string",
      "available_seats": "integer",
      "total_seats": "integer"
    }
  ]
}
```

---

### 4.2 이벤트 상세 조회
**GET** `/api/events/{event_id}`

특정 이벤트의 상세 정보를 조회합니다.

**응답 (200):**
```json
{
  "event_id": "string",
  "name": "string",
  "description": "string",
  "start_at": "string (ISO 8601)",
  "end_at": "string (ISO 8601)",
  "location": "string",
  "venue": "string",
  "total_seats": "integer",
  "available_seats": "integer",
  "sold_seats": "integer",
  "sections": ["string"],
  "price_range": {
    "min": "number",
    "max": "number"
  }
}
```

---

## 5. 건강 상태 체크

### 5.1 헬스 체크
**GET** `/health`

API 서버의 동작 상태를 확인합니다.

**응답 (200):**
```json
{
  "status": "ok",
  "timestamp": "string (ISO 8601)",
  "version": "string"
}
```

---

## 에러 처리

모든 에러 응답은 다음 형식을 따릅니다:

```json
{
  "error_code": "string",
  "message": "string",
  "details": "object (선택사항)",
  "timestamp": "string (ISO 8601)"
}
```

### 공통 에러 코드
- `INVALID_REQUEST` (400): 잘못된 요청
- `UNAUTHORIZED` (401): 인증 실패
- `FORBIDDEN` (403): 권한 없음
- `NOT_FOUND` (404): 리소스 없음
- `CONFLICT` (409): 중복 선점
- `RATE_LIMIT_EXCEEDED` (429): 요청 제한 초과
- `INTERNAL_SERVER_ERROR` (500): 서버 오류

---

## 인증

모든 API 엔드포인트는 다음 중 하나의 인증 방식을 사용합니다:

### 1. Queue Token (대기열 진입 후)
```
Authorization: Bearer <queue_token>
```

### 2. Access Token (대기 완료 후)
```
Authorization: Bearer <access_token>
```

---

## 요청 제한 (Rate Limiting)

| 엔드포인트 | 제한 |
|-----------|------|
| `/api/queue/join` | 1 req/sec per IP |
| `/api/events/{event_id}/seats/reserve` | 2 req/sec per user |
| 기타 | 10 req/sec per IP |

---

## 데이터 타입

- `UUID`: 36글자 UUID 형식
- `ISO 8601`: `2026-05-15T14:30:00Z` 형식
- `integer`: 정수
- `number`: 소수점 포함 숫자
- `boolean`: true/false
