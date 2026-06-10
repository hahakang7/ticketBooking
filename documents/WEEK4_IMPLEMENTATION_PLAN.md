# Week 4 팀 단계별 구현 계획

## 전제 조건
- 현재 위치: Week 3 완료, Week 4 진입
- PG 결제 연동 없음 — `payment_service.py`의 `_simulate_pg()` (95% 성공) 그대로 유지
- 각 Phase는 완료 후 다음 Phase 진행 (Phase 2는 팀원별 병렬 진행 가능)

---

## 진행 상태 범례

| 표시 | 의미 |
|------|------|
| ✅ 완료 | 구현 확인됨 |
| ⚠️ 부분 완료 | 핵심 기능은 구현됐으나 일부 미흡 |
| ❌ 미완료 | 아직 구현 안 됨 |

---

## Phase 1: 협업 블로커 해소 (Day 1~2) — 전원 참여

다른 작업 모두 여기서 막혀있음. 가장 먼저 처리.

### ✅ Step 1-1. Ingress WebSocket Sticky Session 설정
**담당:** 팀원 1 + 팀원 3 페어  
**파일:** `infra/k8s/base/shared/ingress.yaml`  
**상태:** 완료 (2026-06-10)

~~현재 상태: ws.example.com 라우팅은 있지만 sticky session 어노테이션 없음.~~

**완료 내용:**  
Ingress 어노테이션은 리소스 전체에 적용되므로 ws.example.com에만 격리하기 위해  
단일 Ingress를 두 개로 분리:
- `ticket-system-ingress` — api.example.com + example.com (sticky session 없음)
- `ticket-ws-ingress` — ws.example.com 전용, 아래 어노테이션 적용

```yaml
nginx.ingress.kubernetes.io/affinity: "cookie"
nginx.ingress.kubernetes.io/affinity-mode: "persistent"
nginx.ingress.kubernetes.io/session-cookie-name: "ws-route"
nginx.ingress.kubernetes.io/session-cookie-expires: "172800"
nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
nginx.ingress.kubernetes.io/upstream-hash-by: "$remote_addr"
```

TLS도 분리: ws 전용 `ticket-ws-tls` secret 사용.

**검증:** YAML 문법 검증 완료 (Python yaml.safe_load_all). 클러스터 연결 후 `kubectl apply --dry-run=client -f infra/k8s/base/shared/ingress.yaml` 재실행 필요.

---

### ❌ Step 1-2. Prometheus ServiceMonitor 생성
**담당:** 팀원 1  
**파일:** `infra/prometheus/service-monitor.yaml` (신규 생성)

현재 `prometheus.yml`은 static config로 IP를 직접 지정하는 방식.  
K8s 환경에서는 ServiceMonitor로 Pod 자동 discovery가 필요.

생성할 내용 (3개 ServiceMonitor):
- `core-api` — port: metrics(8001), path: /metrics, interval: 15s
- `websocket-service` — port: metrics(9090), path: /metrics, interval: 15s  
- `redis-exporter` — port: metrics(9121), path: /metrics, interval: 30s

**검증:** `kubectl apply --dry-run=client -f infra/prometheus/service-monitor.yaml`

---

## Phase 2: 팀원별 병렬 개발 (Day 3~5)

각 팀원이 독립적으로 진행 가능. 상호 블로킹 없음.

---

### 팀원 1 작업

#### ❌ Step 2-1. 예측 모델 Mock API 엔드포인트 구현
**파일:** `infra/` 또는 별도 prediction-service (가이드 기준)  
**목적:** 팀원 2가 `POST /api/prediction/forecast`, `GET /api/prediction/resource-plan`에 연동해야 함.

실제 ML 모델 없이도 k6 부하 테스트 결과 기반 mock 응답을 반환하는 간단한 엔드포인트 구현.  
구현 위치: core-api에 `/v1/prediction/` 라우터 추가 또는 별도 stub 서버.

응답 형식 (팀원 2와 협의):
```json
{
  "forecast": { "expected_users": 5000, "peak_time": "14:00" },
  "resource_plan": { "recommended_replicas": 10, "scale_trigger": "cpu_70" }
}
```

**검증:** `curl http://localhost:8000/v1/prediction/forecast`

---

#### ❌ Step 2-2. Grafana 대시보드 템플릿 생성
**파일:** `infra/monitoring/` (현재 빈 폴더)  
**목적:** 발표 시 실시간 메트릭 시각화 필요.

생성할 파일:
- `infra/monitoring/grafana-dashboard.json` — queue 대기자 수, P95 응답 시간, 에러율, WebSocket 연결 수, Pod CPU/Memory 6개 패널

기존 `infra/prometheus/local/alert-rules.yaml`의 메트릭명 재활용.

---

#### ❌ Step 2-3. Flash Crowd 시뮬레이션 실행 준비
**파일:** `tests/k6/queue-load-test.js` (기존 수정)

현재 ramping-vus로 점진적 증가만 있음.  
Flash Crowd 시나리오 추가: 0 → 5000 VU를 30초 안에 급증시키는 시나리오.

```javascript
scenarios: {
  flash_crowd: {
    executor: 'ramping-arrival-rate',
    startRate: 0,
    timeUnit: '1s',
    preAllocatedVUs: 5000,
    stages: [
      { duration: '30s', target: 5000 },  // 급증
      { duration: '2m',  target: 5000 },  // 유지
      { duration: '30s', target: 0 },     // 감소
    ]
  }
}
```

**검증:** `k6 run --vus 100 --duration 30s tests/k6/queue-load-test.js` (로컬 스모크 테스트)

---

### 팀원 2 작업

#### ❌ Step 2-4. DB 인덱스 최적화
**파일:** `apps/core-api/src/models/` 각 모델 파일

현재 CLAUDE.md에 인덱스 명세가 있지만 실제 모델 파일에 Index 객체로 정의되어 있는지 확인 필요.  
추가가 필요한 인덱스:
- `reservations.status` — 만료 held 조회 쿼리 (`reservation_repository.py`의 `get_expired_holds`) 성능
- `seats.event_id + status` — 복합 인덱스, 좌석 가용성 조회 빈번
- `payments.reservation_id` — 이미 명세에 있으나 모델에 반영 확인

**검증:** `EXPLAIN ANALYZE SELECT * FROM seats WHERE event_id = '...' AND status = 'available'`

---

#### ❌ Step 2-5. Redis 파이프라인 적용
**파일:** `apps/core-api/src/redis/queue.py`, `apps/core-api/src/services/reservation_service.py`

현재 Redis 명령어가 개별 round-trip으로 실행됨.  
여러 명령어를 묶을 수 있는 부분에 pipeline 적용:
- `queue.py`의 `get_queue_info()` — ZCARD + ZRANK를 pipeline으로
- `reservation_service.py`의 hold 시 Redis 키 여러 개 SET → pipeline으로

**검증:** 파이프라인 적용 전후 `pytest tests/test_queue.py -v` 통과 확인

---

#### ❌ Step 2-6. 성능 검증 및 병목 제거 (P95 < 300ms 목표)
**파일:** `apps/core-api/src/api/v1/queue.py`, `apps/core-api/src/middleware/logger.py`

logger.py에 slow request 경고가 500ms 기준으로 있음 → 300ms로 낮춰 실제 병목 파악.  
`/queue/join`, `/queue/status`, `/reservations/hold` 3개 엔드포인트가 핵심 경로.

추가로 판단되는 작업:
- **응답 압축(gzip):** `main.py`에 `GZipMiddleware` 추가 (FastAPI 기본 제공)
- **이벤트 조회 캐싱 TTL 확인:** `seats.py`에 Redis 캐싱 있으나 TTL이 적절한지 확인

**검증:** `pytest tests/ -v` 전체 통과 + logger slow request 로그로 병목 파악

---

#### ❌ Step 2-7. 예측 모델 API 연동 (팀원 1 Step 2-1 완료 후)
**파일:** `apps/core-api/src/services/` 신규 or 기존 서비스  
**의존:** Step 2-1 완료 필요

팀원 1이 만든 엔드포인트를 호출해 사전 스케일링 신호를 받는 로직.  
실제 K8s HPA에 영향을 주는 것이 아니라, 발표용 데모 흐름 구성이 목적.

---

### 팀원 3 작업

#### ✅ Step 2-8. SeatMap 실시간 좌석 상태 색상 반영
**파일:** `apps/frontend/src/components/pages/SeatDetailModal.jsx`, `apps/frontend/src/hooks/useWebSocket.js`  
**상태:** 완료 (기확인)

~~현재 상태: 구역(섹션) 클릭만 지원, 개별 좌석의 available/hold/sold 색상 없음.~~

**완료 내용:**  
계획서의 `SeatMap.jsx SVG 요소` 대신 `SeatDetailModal.jsx` 버튼 그리드에서 처리 (더 적절한 구조).

- `useWebSocket.js` — `seat_status_updated` / `seat_reserved` 이벤트 수신 후 `seatUpdates` 상태 업데이트
- `SeatDetailModal.jsx` — `useEffect`로 `seatUpdates` 감지 → `seats` 상태 실시간 반영
- 선택된 좌석이 hold/sold로 변경되면 자동 선택 해제 처리 포함

**계획과 다른 색상값** (→ [계획과 다르게 구현된 항목](#계획과-다르게-구현된-항목) 참고):

| 상태 | 계획 | 실제 구현 |
|------|------|----------|
| available | 초록(기본) | 회색(기본), hover 시 초록 |
| hold | 노랑 | 주황 `#f0ad4e` |
| sold | 빨강 | 회색 `#9e9e9e` |
| mine(선택) | 파랑 | 파랑 `#1e88e5` ✅ |

---

#### ✅ Step 2-9. 대기열 → 좌석 선택 → 결제 전체 플로우 연결 검증
**파일:** `apps/frontend/src/App.jsx`, `apps/frontend/src/pages/`  
**상태:** 완료 (기확인)

~~현재 `SeatSelectionPage.jsx`가 없고 `pages/SeatMap.jsx`가 독립적으로 존재.~~

**완료 내용:**  
URL 기반 라우터 대신 App.jsx의 `phase` 상태머신으로 전체 흐름 구현됨.

```
QueuePage (status=ready → onReady())
  → phase='seat_selection' → HomePage (SeatMap + SeatDetailModal)
  → onProceedToPayment(seats) → phase='payment' → PaymentPage
  → 진입 즉시 POST /v1/reservations (hold API 호출)
  → PaymentForm 완료 → phase='confirmation' → ConfirmationPage
  → onDone() → phase='queue' (초기화)
```

추가 구현 포함:
- access_token 존재 시 대기열 건너뛰기 (App.jsx useEffect)
- 뒤로가기 시 hold DELETE 자동 해제 (PaymentPage cleanup)
- SeatSelectionPage 별도 파일 없이 HomePage + SeatDetailModal 조합으로 동일 기능

---

#### ⚠️ Step 2-10. 프론트엔드 번들 최적화
**파일:** `apps/frontend/vite.config.js`  
**상태:** 부분 완료

**완료된 항목:**
- `manualChunks`로 react-vendor(react + react-dom), socket-io(socket.io-client) 청크 분리 완료
- Tailwind `content` 경로 설정 → **불필요**: `@tailwind` directive를 사용하지 않아 Tailwind CSS가 번들에 포함되지 않음 (package.json에만 존재)

**미완료 항목:**
- `rollup-plugin-visualizer` 미설치 — 번들 시각화 아직 안 됨
- 실제 번들 크기 미확인 — 목표 150KB 미만 달성 여부 불명
- 페이지 단위 코드 분할 미적용 (현재 앱 규모상 효과 미미하나 확인 필요)

**잔여 작업:**
```bash
cd apps/frontend && npm run build
# dist/assets/ 파일 크기 확인 → 150KB 초과 시 페이지별 manualChunks 추가
```

---

## Phase 3: 통합 검증 (Day 6~7) — 전원 참여

### ❌ Step 3-1. Docker Compose 통합 실행 검증
**담당:** 팀원 1 (주도), 전원 확인  
**파일:** `docker-compose.yml`

모든 서비스를 `docker-compose up -d`로 올린 뒤 헬스체크 통과 확인.
```bash
docker-compose up -d
docker-compose ps   # 모든 State가 healthy
curl http://localhost:8000/health
curl http://localhost:3000/health
```

---

### ❌ Step 3-2. 전체 예매 여정 E2E 검증
**담당:** 팀원 3 (프론트), 팀원 2 (백엔드 로그 모니터링)

1. 브라우저에서 QueuePage 접근 → 대기열 진입
2. SSE로 순번 수신 → queue_token 발급
3. SeatMap에서 좌석 선택 → hold API 호출
4. PaymentPage에서 결제 mock 완료 → sold 상태 확인
5. WebSocket으로 다른 브라우저에서 해당 좌석 색상이 sold(빨강)로 변경되는지 확인

**KPI 체크:**
- 중복 예매: 두 브라우저에서 동일 좌석 동시 예매 시도 → 한 명만 성공
- 좌석 동기화: hold 후 100ms 이내 다른 브라우저에서 색상 변경

---

### ❌ Step 3-3. k6 부하 테스트 실행 및 결과 분석
**담당:** 팀원 1 (실행), 팀원 2 (결과 분석), 팀원 3 (WebSocket 메트릭 확인)

순서:
1. `k6 run tests/k6/queue-load-test.js` — 대기열 부하 (100 concurrent → Flash Crowd)
2. `k6 run tests/k6/reservation-stress-test.js` — 예약 동시성 (중복 예매 0건 확인)
3. `k6 run tests/k6/websocket-load-test.js` — WebSocket 동시 연결 1000 VU

체크 기준:
- P95 응답 시간 < 300ms
- 에러율 < 1%
- 중복 예매 0건

---

## Phase 4: 최종 마무리 (Day 8) — 전원 참여

### Step 4-1. KPI 최종 확인
| KPI | 목표 | 확인 방법 |
|-----|------|----------|
| 가용성 | 99.9% | k6 실행 중 다운타임 0 확인 |
| P95 응답 시간 | < 300ms | k6 결과 리포트 |
| 중복 예매 | 0건 | reservation stress test 결과 |
| 좌석 동기화 | < 100ms | websocket-load-test latency 메트릭 |
| 동시 연결 | 10,000+ | websocket-load-test VU 확장 |

---

### Step 4-2. 발표 자료 준비 (팀원별 담당)
- **팀원 1:** K8s 아키텍처 다이어그램, HPA 스케일링 결과, k6 Flash Crowd 그래프
- **팀원 2:** Redis Sorted Set 대기열 흐름도, Redlock 동시성 방지 설명, P95 개선 수치
- **팀원 3:** WebSocket Pub/Sub 실시간 흐름도, SeatMap 데모, 번들 최적화 before/after

---

## 가이드에 없지만 추가 판단한 작업

| 항목 | 담당 | 상태 | 이유 |
|------|------|------|------|
| Ingress sticky session 어노테이션 | 팀원 1+3 | ✅ 완료 | K8s Service만으론 부족, Ingress 레벨 필수 |
| GZipMiddleware 추가 (`main.py`) | 팀원 2 | ❌ 미완료 | API 응답 크기 최소화, P95 달성 필수 도구 |
| slow request 임계값 500ms→300ms | 팀원 2 | ❌ 미완료 | KPI와 logger 기준 일치 필요 |
| 전체 여정 라우팅 연결 검증 | 팀원 3 | ✅ 완료 | SeatSelectionPage 미존재로 흐름 끊길 수 있음 |
| 대기열→좌석 자동 이동 처리 | 팀원 3 | ✅ 완료 | queue_token 발급 후 페이지 전환 미구현 가능성 |
| Grafana 대시보드 JSON 생성 | 팀원 1 | ❌ 미완료 | 발표 시 실시간 메트릭 시각화 필요 |
| Docker Compose E2E 통합 실행 | 팀원 1 주도 | ❌ 미완료 | 개별 서비스는 됐지만 통합 기동 미검증 |
| `infra/k8s/base/core-api/` namespace 불일치 수정 | 팀원 1+2 | ❌ 미완료 | websocket/frontend는 `namespace: ticket-system` 있지만 core-api는 없음 |

---

## 계획과 다르게 구현된 항목

계획 시점과 실제 코드 사이에 구조나 방식이 다른 항목. 기능은 동일하나 발표/문서화 시 정확한 경로/방식 기준으로 설명 필요.

### Step 2-8 — 좌석 색상 처리 위치
- **계획:** `SeatMap.jsx`의 SVG 요소에 색상 적용
- **실제:** `SeatDetailModal.jsx`의 버튼 그리드에서 처리
- **이유:** `SeatMap.jsx`는 경기장 구역(섹션) 단위 SVG이고, 개별 좌석은 모달에서 관리하는 구조가 더 적절
- **색상 차이:**
  - available: 계획(초록 기본) → 실제(회색 기본, hover 시 초록)
  - hold: 계획(노랑) → 실제(주황 `#f0ad4e`)
  - sold: 계획(빨강) → 실제(회색 `#9e9e9e`)
  - 수정 원한다면 `apps/frontend/src/styles/components/seat-detail-modal.css` L90-117

### Step 2-9 — 라우팅 방식
- **계획:** URL 기반 React Router (`/queue` → `/seats` → `/payment`)
- **실제:** App.jsx의 `phase` 상태머신 (`'queue' | 'seat_selection' | 'payment' | 'confirmation'`)
- **이유:** URL 라우터 없이도 동일한 UX 구현 가능, 더 단순한 구조
- **영향:** 브라우저 뒤로가기 버튼으로 페이지 이동 불가 (앱 내 뒤로가기 버튼은 구현됨)

### Step 2-10 — Tailwind 처리
- **계획:** `content` 경로 설정으로 미사용 클래스 제거
- **실제:** `@tailwind` directive 미사용 → Tailwind가 번들에 포함되지 않으므로 처리 불필요
- **이유:** CSS를 직접 작성하는 방식 채택, Tailwind는 package.json에만 존재

---

## 의존 관계 요약

```
Step 1-1 (Ingress) ✅ ────────────────────────────→ Step 3-2 (E2E 검증)
Step 1-2 (ServiceMonitor) ──────────────────────→ Step 3-3 (부하 테스트 메트릭)
Step 2-1 (예측 모델 API) ────→ Step 2-7 (팀원 2 연동)
Step 2-8 (SeatMap 색상) ✅ ──────────────────────→ Step 3-2 (E2E 검증)
Step 2-9 (라우팅 연결) ✅ ───────────────────────→ Step 3-2 (E2E 검증)
Step 3-1, 3-2, 3-3 완료 ────────────────────────→ Step 4-1 (KPI 확인)
```

---

## 일정 요약

| 기간 | 내용 | 참여자 |
|------|------|--------|
| **Day 1~2** | Phase 1: 협업 블로커 해소 (Ingress ✅, ServiceMonitor ❌) | 팀원 1+3 |
| **Day 3~5** | Phase 2: 팀원별 병렬 개발 (Step 2-8 ✅, 2-9 ✅, 2-10 ⚠️, 나머지 ❌) | 각자 독립 |
| **Day 6~7** | Phase 3: 통합 검증 (Docker, E2E, k6) | 전원 협력 |
| **Day 8** | Phase 4: KPI 확인, 발표 자료 준비 | 전원 함께 |
