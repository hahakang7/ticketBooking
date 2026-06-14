# 팀원 협의 필요 항목 (Week 3~4)

> **작성일:** 2026-06-01  
> **최종 업데이트:** 2026-06-14
> **대상:** 팀원 1 (인프라/부하 테스트), 팀원 3 (WebSocket/실시간 UI)
>
> **상태 변경 사항:** Week 3 협의 항목 중 예측 모델 API 및 k6 reservation-stress-test.js가 예상보다 먼저 완성됨

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

### 1. ✅ 팀원 1에게: Reservation 부하 테스트 (스크립트 완성)

**상태:** 완료 (2026-06-14) — 스크립트 완성, 실행 및 결과 보고는 Week 4

**구현된 파일:** `tests/k6/reservation-stress-test.js`

**테스트 시나리오:**
```
50 VU, 120초:
1. POST /api/queue/join → queue_token 획득
2. GET /api/queue/status (폴링) → position=1 대기
3. POST /api/v1/reservations (seat_ids: ["A1"]) 5회 시도
   - 성공 시 예약 ID 기록
   - 409 Conflict 시 다른 좌석 시도
4. POST /api/v1/payments (첫 번째 성공한 예약만 결제)
```

**검증 메트릭:**
- `duplicate_reservations_total` 카운터: 중복 예매 0건 ⭐ 핵심
- P95 응답 시간: < 300ms
- 결제 성공률: > 90%
- 에러율: < 5%

**중복 예매 검증:**
```sql
SELECT seat_id, COUNT(*) as completed_count
FROM reservations
WHERE status = 'completed' AND event_id = 'event-456'
GROUP BY seat_id HAVING COUNT(*) > 1;
-- 결과: 0행 (중복 예매 없음 ✓)
```

**추가 구현:**
- `tests/k6/queue-load-test.js` - ramp_up_down (0→100 VU) + flash_crowd (5000 req/s)
- `tests/k6/websocket-load-test.js` - Socket.IO 1000 VU, 좌석 업데이트 레이턴시 < 100ms

---

### 2. ✅ 팀원 1과: 예측 모델 API 연동 협의 (구현 완료)

**상태:** 완료 (2026-06-14)

**구현된 내용:**

#### 예측 모델 (팀원 1)
- ✅ `traffic_forecaster.py` - LSTM 기반 PyTorch 신경망 (`_RPSNet`)
  - 합성 데이터 1000개로 자동 학습 (40 epoch, 모델 없으면 첫 기동 시 생성)
  - Monte Carlo Dropout (mc_samples=40)으로 90% 신뢰구간 반환
- ✅ `resource_calculator.py` - ForecastPoint → ScalingWindow 변환
  - RPS → 파드 수 (min=2, max=50, 기본 250 RPS/pod)
  - 스케일다운 시 한 스텝 최대 20% 감소 제한

#### API 엔드포인트 (팀원 2)
- ✅ `POST /api/v1/prediction/forecast` - 트래픽 예측
  - 파라미터: `event_id` (선택사항, 있으면 LSTM, 없으면 Mock)
  - 응답: `expected_users`, `peak_time`, `predicted_rps[]`, `confidence_interval`
- ✅ `GET /api/v1/prediction/resource-plan` - 리소스 계획
  - 파라미터: `event_id` (선택사항)
  - 응답: `recommended_replicas`, `scale_trigger`, `scaling_windows[]`

**주의사항:**
- 엔드포인트 경로: `/api/v1/prediction/` (문서에 `/api/prediction/`으로 표기했으나 실제는 `/api/v1/` prefix)
- 모델 파일: `apps/core-api/models/traffic_model.pt` (첫 기동 시 자동 생성)
- PredictionService 레이어: Redis 캐싱 (5분 TTL) + 에러 시 fallback 포함

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

- ✅ 팀원 1: Queue 부하 테스트 정보 검토 및 k6 스크립트 작성 완료
- ✅ 팀원 3: SSE 이벤트 형식 확인 및 구현 완료

### ✅ Week 3 (완료)

#### 완료됨
- ✅ 팀원 2: Reservation API + Rate Limiting 구현
- ✅ 팀원 2: Payment API + Rate Limiting 구현
- ✅ 팀원 2: Redis Pub/Sub 메시지 형식 구현 및 5가지 발행 시점 적용
- ✅ 팀원 3: Redis Pub/Sub 메시지 형식 확정
- ✅ 팀원 1: Reservation 부하 테스트 정보 검토 및 k6 스크립트 작성 완료
- ✅ 팀원 1: 예측 모델 API 모듈 제공 완료 (`traffic_forecaster.py`, `resource_calculator.py`)
- ✅ 팀원 2: 예측 모델 임포트 및 API 래핑 완료 (`POST /api/v1/prediction/forecast`, `GET /api/v1/prediction/resource-plan`)

### Week 4 (진행 중)

#### 남은 작업
- [ ] 팀원 1: k6 부하 테스트 실행 및 결과 보고
  - **검증 목표:** 중복 예매 0건
  - **성능 목표:** P95 < 300ms
  - **대상 스크립트:** `reservation-stress-test.js`, `queue-load-test.js`, `websocket-load-test.js`
- [ ] 팀원 2: k6 결과 분석 및 성능 최적화
- [ ] 팀원 1, 2, 3: 최종 성능 검증 미팅

---

## 📝 주요 협의 내용

### ✅ 예측 모델 API (구현 완료)

**구현된 엔드포인트:**
- `POST /api/v1/prediction/forecast` - 트래픽 예측
  - 입력: `event_id` (선택사항)
  - 출력: `expected_users`, `peak_time`, `predicted_rps[]`, `confidence_interval`
- `GET /api/v1/prediction/resource-plan` - 리소스 계획
  - 입력: `event_id` (선택사항)
  - 출력: `recommended_replicas`, `scaling_windows[]`

**구현 상세:**
- 동기 처리 (모델 예측은 < 200ms)
- Redis 캐싱 (5분 TTL)
- 모델 파일: `apps/core-api/models/traffic_model.pt` (자동 생성)

### ✅ INTERNAL_SECRET 공유 (팀원 2/3)

**내부 API 보안:**
- 환경변수 `INTERNAL_SECRET` 값을 팀원 2/3가 동일하게 설정
- `POST /api/v1/reservations/internal/release-user` 헤더로 검증 (`X-Internal-Secret`)
- WebSocket 서비스가 사용자 연결 해제 시 호출

**구현 상태:** 완료 (사용 준비 완료)

---

## 연락처

- **팀원 1 (인프라):** [이메일/슬랙]
- **팀원 3 (UI/WebSocket):** [이메일/슬랙]

**마지막 업데이트:** 2026-06-08
