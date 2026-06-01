# 팀원 협의 필요 항목 (Week 2~3)

> **작성일:** 2026-06-01  
> **대상:** 팀원 1 (인프라/부하 테스트), 팀원 3 (WebSocket/실시간 UI)

---

## 📌 Week 2 협의 항목

### 1. 팀원 1에게: Queue 부하 테스트 정보 제공

**목적:** `k6 queue-load-test.js` 작성을 위한 API 스펙 제공

#### Queue API 엔드포인트

**POST /api/queue/join**
```json
Request:
{
  "user_id": "user-123",
  "event_id": "event-456"
}

Response (200 OK):
{
  "code": 200,
  "message": "success",
  "data": {
    "position": 1,
    "total": 500,
    "queue_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}

Response (429 Too Many Requests):
{
  "code": 429,
  "message": "Too Many Requests",
  "data": {
    "retry_after": 1
  }
}
```

**GET /api/queue/status?user_id=user-123&event_id=event-456**
```
Request Header:
Authorization: Bearer <queue_token>

Response (200 OK):
{
  "code": 200,
  "message": "success",
  "data": {
    "position": 5,
    "total": 500
  }
}

Response (401 Unauthorized):
{
  "code": 401,
  "message": "Invalid or expired token"
}
```

#### Rate Limiting 규칙
- **경로:** `/api/queue/join`
- **제한:** 1회/1초 (IP 기반)
- **429 응답 포함:** `retry_after` 필드 (초 단위)

#### k6 테스트 시나리오 추천
1. **VU 설정:** 100 VU (Virtual User)
2. **지속시간:** 60초
3. **시나리오:**
   - 모든 VU가 `POST /api/queue/join` 호출
   - 성공한 VU만 `GET /api/queue/status` 반복 폴링 (2초 간격)
   - position=1에 도달한 VU의 응답 시간 측정
4. **성능 목표:**
   - P95 응답 시간: < 300ms
   - 에러율: < 1%

---

## 📌 Week 3 협의 항목

### 1. 팀원 1에게: Reservation 부하 테스트 정보 제공

**목적:** `k6 reservation-stress-test.js` 작성을 위한 API 스펙 제공

#### Reservation API 엔드포인트

**POST /api/v1/reservations**
```json
Request Header:
Authorization: Bearer <access_token>

Request:
{
  "event_id": "event-456",
  "seat_ids": ["A1", "A2", "A3"]
}

Response (201 Created):
{
  "code": 201,
  "message": "success",
  "data": {
    "reservation_id": "res-789",
    "user_id": "user-123",
    "event_id": "event-456",
    "seat_ids": ["A1", "A2", "A3"],
    "status": "held",
    "expires_at": "2026-06-01T10:35:00Z"
  }
}

Response (409 Conflict - 중복 예매 차단):
{
  "code": 409,
  "message": "Conflict",
  "error": "seat_already_held_or_sold"
}

Response (429 Too Many Requests - Rate Limit):
{
  "code": 429,
  "message": "Too Many Requests",
  "data": {
    "retry_after": 1
  }
}
```

**GET /api/v1/reservations/{reservation_id}**
```
Request Header:
Authorization: Bearer <access_token>

Response (200 OK):
{
  "code": 200,
  "message": "success",
  "data": {
    "reservation_id": "res-789",
    "user_id": "user-123",
    "event_id": "event-456",
    "seat_ids": ["A1", "A2", "A3"],
    "status": "held",
    "created_at": "2026-06-01T10:30:00Z",
    "expires_at": "2026-06-01T10:35:00Z"
  }
}
```

**POST /api/v1/payments**
```json
Request Header:
Authorization: Bearer <access_token>

Request:
{
  "reservation_id": "res-789",
  "amount": 150000.00,
  "payment_method": "credit_card"
}

Response (201 Created):
{
  "code": 201,
  "message": "success",
  "data": {
    "payment_id": "pay-101",
    "reservation_id": "res-789",
    "user_id": "user-123",
    "amount": 150000.00,
    "status": "completed",
    "created_at": "2026-06-01T10:31:00Z"
  }
}
```

#### Rate Limiting 규칙
- **경로:** `/api/v1/reservations`
- **제한:** 2회/1초 (사용자 기반)
- **인증 방식:** Authorization 헤더에서 user_id 추출 (JWT access_token)

#### k6 테스트 시나리오 추천

**목표:** 0건 중복 예매 검증

1. **사전 준비:**
   - 테스트용 이벤트 생성 (event-456)
   - 테스트용 좌석 100개 준비 (A1 ~ E20)

2. **VU 설정:** 50 VU
3. **지속시간:** 120초
4. **시나리오:**
   ```
   VU마다:
   1. POST /api/queue/join → queue_token 획득
   2. GET /api/queue/sse → position=1 대기 (최대 60초)
   3. access_token 획득 (SSE에서 발급)
   4. 5회 반복:
      - POST /api/v1/reservations (seat_ids: ["A1"]) 시도
      - 성공 시 예약 ID 기록
      - 409 Conflict 시 다른 좌석 시도
   5. POST /api/v1/payments (첫 번째 성공한 예약만 결제)
   ```

5. **성능 목표:**
   - P95 응답 시간: < 300ms
   - **중복 예매:** 0건 (A1 좌석 성공 건수 = 1)
   - 에러율: < 5%
   - 결제 성공률: > 90%

#### 중복 예매 검증 방법
```bash
# 테스트 후 DB 쿼리
SELECT 
  seat_id,
  COUNT(*) as hold_count,
  GROUP_CONCAT(reservation_id) as reservations
FROM reservations
WHERE status = 'completed' AND event_id = 'event-456'
GROUP BY seat_id
HAVING COUNT(*) > 1;

# 결과: 0행 (중복 예매 없음 ✓)
```

---

### 2. 팀원 1과: 예측 모델 API 연동 협의

**팀원 1의 작업 항목:**
- `apps/core-api/src/prediction/traffic_forecaster.py` 구현 (트래픽 예측 모델)
- `apps/core-api/src/prediction/resource_calculator.py` 구현 (리소스 계획)

**팀원 2 (우리)의 작업:**
- 위 모듈을 임포트하여 API 엔드포인트 래핑
- 엔드포인트:
  - `POST /api/prediction/forecast`
  - `GET /api/prediction/resource-plan`

**협의 내용:**
1. 예측 모델의 입력 파라미터 형식
2. 출력 응답 형식
3. 모델 학습된 파일 위치 (`apps/core-api/models/traffic_model.pkl` 등)
4. 예측 수행 시간 (동기 vs 비동기)

---

### 3. 팀원 3과: Redis Pub/Sub 채널 및 메시지 형식 확정

**팀원 3의 작업 항목:**
- WebSocket 서비스에서 Redis Pub/Sub 구독
- 실시간 좌석 상태 업데이트 (클라이언트에게 브로드캐스트)

**우리(팀원 2)가 발행하는 메시지:**

**채널 이름:**
```
seat_updates:{event_id}
예시: seat_updates:event-456
```

**메시지 형식 (JSON):**
```json
{
  "seat_id": "A1",
  "status": "sold",
  "held_by": "user-123",
  "held_until": "2026-06-01T10:35:00Z",
  "event_id": "event-456",
  "timestamp": "2026-06-01T10:31:00.123456Z"
}
```

**발행 시점:**
1. `POST /api/v1/reservations` 성공 후
   - status: "held"
   - held_until: 예약 만료 시간

2. `DELETE /api/v1/reservations/{id}` 취소 후
   - status: "available"
   - held_by: null
   - held_until: null

3. `POST /api/v1/payments` 결제 완료 후
   - status: "sold"
   - held_by: user_id (최종 소유자)
   - held_until: null

**협의 내용:**
1. 메시지 형식 확인 (추가 필드 필요 여부)
2. WebSocket 이벤트 명 정의 (예: `seat_status_update`)
3. 구독 필터링 방식 (이벤트별로 필터링할지, 글로벌 구독할지)

---

## 📋 협의 체크리스트

### Week 2 (현재 주)

- [ ] 팀원 1: Queue 부하 테스트 정보 검토 및 k6 스크립트 작성 시작
- [ ] 팀원 3: SSE 이벤트 형식 확인 (기존 구현과 호환 가능한지)

### Week 3

- [ ] 팀원 1: Reservation 부하 테스트 정보 검토 및 k6 스크립트 작성
- [ ] 팀원 1: 예측 모델 API 스펙 공유
- [ ] 팀원 2: 예측 모델 임포트 및 API 래핑
- [ ] 팀원 3: Redis Pub/Sub 메시지 형식 확정 및 WebSocket 구독 구현

### Week 4

- [ ] 팀원 1: k6 부하 테스트 결과 보고 (중복 예매 0건 검증)
- [ ] 팀원 2, 3: 성능 개선 협의

---

## 연락처

- **팀원 1 (인프라):** [이메일/슬랙]
- **팀원 3 (UI/WebSocket):** [이메일/슬랙]

**마지막 업데이트:** 2026-06-01
