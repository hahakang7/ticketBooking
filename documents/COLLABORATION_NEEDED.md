# 팀원 협의 필요 항목 (Week 3~4)

> **작성일:** 2026-06-01  
> **최종 업데이트:** 2026-06-08
> **대상:** 팀원 1 (인프라/부하 테스트), 팀원 3 (WebSocket/실시간 UI)

---

## ✅ Week 2 협의 항목 (완료됨)

**상태:** 모두 구현 완료 (2026-05-19 ~ 2026-05-25)

- ✅ Queue API (join, status, sse, leave) 엔드포인트 구현
- ✅ Rate Limiting (3req/sec for queue, 5req/sec for others)
- ✅ k6 부하 테스트 정보 제공

---

## ✅ Week 3 협의 항목 (부분 완료됨)

**상태:** Reservation/Payment/Pub-Sub API 구현 완료 (2026-05-25), 나머지 진행 중

### ✅ 구현 완료된 항목
- ✅ Reservation API (POST, GET, DELETE) - 스펙대로 구현됨
- ✅ Payment API (POST, GET) - 금액 검증 + PG 시뮬레이션 완료
- ✅ Rate Limiting (2req/sec for reservation, 5req/sec for others)
- ✅ Redis Pub/Sub (seat_updates:{event_id} 채널, 5가지 발행 시점)
  - 예약 hold 시: status "hold"
  - 예약 취소 시: status "available"
  - 결제 완료 시: status "sold"
  - hold 자동 만료 시: status "available"
  - 사용자 연결 해제 시: status "available"
- ✅ 내부 엔드포인트 (POST /api/v1/reservations/internal/release-user) 구현

---

## 📌 진행 중인 Week 3 항목

### 1. 팀원 1에게: Reservation 부하 테스트 정보 제공

**목적:** `k6 reservation-stress-test.js` 작성을 위한 API 스펙 제공

#### k6 테스트 시나리오

**목표:** 0건 중복 예매 검증

**사전 준비:**
- 테스트용 이벤트 생성 (event-456)
- 테스트용 좌석 100개 준비 (A1 ~ E20)

**VU 설정:** 50 VU  
**지속시간:** 120초

**시나리오:**
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

**성능 목표:**
- P95 응답 시간: < 300ms
- **중복 예매:** 0건 (A1 좌석 성공 건수 = 1) ⭐ 핵심
- 에러율: < 5%
- 결제 성공률: > 90%

**중복 예매 검증 쿼리:**
```sql
SELECT 
  seat_id,
  COUNT(*) as completed_count,
  GROUP_CONCAT(reservation_id) as reservations
FROM reservations
WHERE status = 'completed' AND event_id = 'event-456'
GROUP BY seat_id
HAVING COUNT(*) > 1;

# 결과: 0행 (중복 예매 없음 ✓)
```

**📋 상태:** 팀원 1이 k6 스크립트 작성 대기 중

---

### 2. 팀원 1과: 예측 모델 API 연동 협의

> ⚠️ **현재 미구현** — `apps/core-api/src/prediction/` 디렉토리만 존재하고 모듈은 비어 있습니다. 팀원 1의 모듈(`traffic_forecaster.py` / `resource_calculator.py`) 제공 대기 중이며, 제공 후 아래 엔드포인트로 API 래핑 예정입니다.

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

### 3. ✅ 팀원 3과: Redis Pub/Sub 채널 및 메시지 형식 (구현 완료)

**상태:** 완료 (2026-05-25)

**구현된 내용:**
- ✅ 채널명: `seat_updates:{event_id}`
- ✅ 메시지 형식: `{event_id, seats[], timestamp}`
- ✅ 5가지 발행 시점 모두 구현 (hold, available, sold)
- ✅ 내부 엔드포인트: `POST /api/v1/reservations/internal/release-user`

**🤝 팀원 3을 위한 구현 참고:**
- 채널명으로 이벤트별 필터링 가능
- 메시지는 좌석 배열 형식 (seat_id + status)
- held_by/held_until 필드 없음 (status만으로 UI 갱신)
- INTERNAL_SECRET 환경변수로 내부 API 보안 (팀원 2/3 공유 필요)

---

## 📋 협의 체크리스트

### ✅ Week 2 (완료)

- ✅ 팀원 1: Queue 부하 테스트 정보 검토 및 k6 스크립트 작성 대기
- ✅ 팀원 3: SSE 이벤트 형식 확인 및 구현 완료

### Week 3 (진행 중)

#### 완료됨
- ✅ 팀원 2: Reservation API + Rate Limiting 구현
- ✅ 팀원 2: Payment API + Rate Limiting 구현
- ✅ 팀원 2: Redis Pub/Sub 메시지 형식 구현 및 5가지 발행 시점 적용
- ✅ 팀원 3: Redis Pub/Sub 메시지 형식 확정

#### 진행 중
- [ ] 팀원 1: Reservation 부하 테스트 정보 검토 및 k6 스크립트 작성
- [ ] 팀원 1: 예측 모델 API 스펙 공유 (`traffic_forecaster.py`, `resource_calculator.py`)
- [ ] 팀원 2: 예측 모델 임포트 및 API 래핑

### Week 4 (예정)

- [ ] 팀원 1: k6 부하 테스트 실행 및 결과 보고
  - **검증 목표:** 중복 예매 0건
  - **성능 목표:** P95 < 300ms
- [ ] 팀원 2: k6 결과 분석 및 성능 최적화
- [ ] 팀원 1, 2, 3: 최종 성능 검증 미팅

---

## 📝 주요 협의 내용

### 예측 모델 API (팀원 1)

**필요한 정보:**
1. 예측 모델의 입력 파라미터 형식
2. 출력 응답 형식
3. 모델 파일 위치 (`apps/core-api/models/traffic_model.pkl` 등)
4. 예측 수행 시간 (동기 vs 비동기)

**팀원 2 구현 예정:**
- `POST /api/prediction/forecast` - 트래픽 예측
- `GET /api/prediction/resource-plan` - 리소스 계획

### INTERNAL_SECRET 공유 (팀원 2/3)

**내부 API 보안:**
- 환경변수 `INTERNAL_SECRET` 값을 팀원 2/3가 동일하게 설정
- `POST /api/v1/reservations/internal/release-user` 헤더로 검증
- WebSocket 서비스가 사용자 연결 해제 시 호출

---

## 연락처

- **팀원 1 (인프라):** [이메일/슬랙]
- **팀원 3 (UI/WebSocket):** [이메일/슬랙]

**마지막 업데이트:** 2026-06-08
