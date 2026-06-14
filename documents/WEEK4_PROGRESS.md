# Week 4 진행 상태 업데이트

WEEK4_IMPLEMENTATION_PLAN.md의 각 Step 완료 시 여기에 기록합니다.  
계획 원본은 건드리지 않고, 실제 구현 내용·차이점·검증 결과를 남깁니다.

---

## Phase 1

### ✅ Step 1-1. Ingress WebSocket Sticky Session 설정
**완료일:** 2026-06-10  
**파일:** `infra/k8s/base/shared/ingress.yaml`

단일 Ingress를 두 개로 분리:
- `ticket-system-ingress` — api.example.com + example.com (sticky session 없음)
- `ticket-ws-ingress` — ws.example.com 전용, sticky session 어노테이션 7개 적용

TLS: ws 전용 `ticket-ws-tls` secret 분리. YAML 문법 검증 완료.

---

### ✅ Step 1-2. Prometheus ServiceMonitor 생성
**완료일:** 2026-06-10  
**파일:** `infra/prometheus/service-monitor.yaml` (신규)

#### 생성 리소스 (4개)

| 리소스 | kind | namespace | 비고 |
|--------|------|-----------|------|
| `redis-exporter` | Service | default | OpsTree 오퍼레이터가 9121 미노출, 별도 생성 |
| `core-api` | ServiceMonitor | monitoring | port: http (80→pod:8000) |
| `websocket-service` | ServiceMonitor | monitoring | port: http (3000→pod:3000) |
| `redis-exporter` | ServiceMonitor | monitoring | port: metrics (9121) |

#### 계획과 다른 포트

계획서는 각 서비스에 독립적인 `metrics` 포트(8001, 9090)를 추가하는 방식을 상정했으나,
실제 앱은 API와 `/metrics`를 같은 포트에서 서빙하므로 기존 `http` 포트를 재활용했습니다.

| 서비스 | 계획 포트 | 실제 구현 |
|--------|----------|----------|
| core-api | metrics:8001 | http 포트(pod:8000) 재활용 — FastAPI Instrumentator가 동일 포트 서빙 |
| websocket-service | metrics:9090 | http 포트(pod:3000) 재활용 — Express GET /metrics 동일 포트 |
| redis-exporter | metrics:9121 | 동일 ✅ — 전용 Service 신규 생성 |

#### 전제 조건
Prometheus Operator 설치 필요 (ServiceMonitor는 `monitoring.coreos.com/v1` CRD):
```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus prometheus-community/kube-prometheus-stack -n monitoring --create-namespace
```

#### prometheus-config.yaml 정리
`infra/prometheus/prometheus-config.yaml`의 `core-api`, `websocket-service` pod annotation 방식 scrape job 제거.  
ServiceMonitor로 완전 이관. 남은 job: `prometheus`(self), `kubernetes-nodes`.

#### 검증
```bash
# YAML 문법 — 완료 (Python yaml.safe_load_all 4개 문서 파싱 성공)
kubectl apply --dry-run=client -f infra/prometheus/service-monitor.yaml

# 로컬 동작 확인 (Docker Compose)
docker-compose --profile monitoring up -d
# → http://localhost:9090 접속 > Status > Targets 에서 UP 확인
```

---

## Phase 2 — 팀원 1

### ✅ Step 2-1. 예측 모델 Mock API 엔드포인트
**완료일:** 2026-06-12  
**파일:** `apps/core-api/src/api/v1/prediction.py`, `apps/core-api/src/services/prediction_service.py`

- `GET /resource-plan`: event_id 파라미터 추가, PredictionService로 실모델 계산값 반환
- event_id 없으면 mock 고정값 반환 (하위 호환성 유지)
- Redis 5분 캐싱 (LSTM 반복 추론 방지), 싱글톤 초기화

### ✅ Step 2-2. Grafana 대시보드 템플릿
**완료일:** 2026-06-13  
**파일:** `infra/k8s/base/monitoring/grafana.yaml`, `infra/k8s/base/monitoring/prometheus.yaml`

- Grafana 10.4.0 Deployment + LoadBalancer(포트 3030) k8s 배포
- ConfigMap 자동 프로비저닝: datasource(Prometheus), dashboard-provider, dashboard JSON 내장
- KPI 6개 패널: Queue 대기자 수, P95 응답시간, 에러율, WebSocket 연결 수, Pod CPU/Memory
- Prometheus v2.51.0 + 5개 alerting group (latency/availability/queue/resource/websocket)
- `infra/prometheus/` Docker Compose 기반 구버전 삭제 → k8s ConfigMap으로 완전 이관

### ✅ Step 2-3. Flash Crowd 시나리오
**완료일:** 2026-06-12 이전  
**파일:** `tests/k6/queue-load-test.js`

- `flash_crowd` 시나리오: `ramping-arrival-rate` executor 적용
- `ramp_up_down` → `flash_crowd` 순차 실행 구성

---

## Phase 2 — 팀원 3

### ✅ Step 2-8. SeatMap 실시간 좌석 색상
완료 (기확인) — `useWebSocket.js`, `SeatDetailModal.jsx`

### ✅ Step 2-9. 전체 플로우 라우팅 연결
완료 (기확인) — App.jsx phase 상태머신

### ✅ Step 2-10. 프론트엔드 번들 최적화
**완료일:** 2026-06-14  
**파일:** `apps/frontend/vite.config.js`, `apps/frontend/src/App.jsx`, `apps/frontend/src/services/api.js`, `apps/frontend/package.json`

#### 적용한 최적화 3가지

**① axios → 네이티브 fetch 교체 (`src/services/api.js`)**

axios 제거로 번들에서 ~42 KB raw / ~14 KB gzip 감소. `package.json` dependencies에서 삭제, 모듈 수 148개 → 96개 (52개 감소). `err.response.status/data` 형태 유지하여 컴포넌트 수정 불필요.

**② React.lazy() 페이지 코드 분할 (`src/App.jsx`)**

`HomePage`, `PaymentPage`, `ConfirmationPage`를 `lazy(() => import(...))`로 변경. `QueuePage`만 즉시 로드(첫 화면). 파급 효과: `useWebSocket` → `socket.js` → `socket.io-client` 체인도 defer → `socket-io.js` 청크(41 KB)가 좌석 선택 진입 전까지 다운로드되지 않음.

**③ rollup-plugin-visualizer 추가 (`vite.config.js`)**

빌드 시 `dist/bundle-stats.html` 생성 (gzip 사이즈 포함 청크 시각화).

#### Before / After 비교

| 청크 | Before raw | Before gzip | After (추정) raw | After (추정) gzip | 로드 시점 |
|------|----------:|----------:|---------------:|----------------:|---------|
| `index.js` | 87.15 KB | 31.34 KB | ~20 KB | ~8 KB | 즉시 |
| `react-vendor.js` | 140.92 KB | 45.30 KB | 140 KB | 45.30 KB | 즉시 |
| `socket-io.js` | 41.62 KB | 13.04 KB | 41 KB | 13.04 KB | **좌석 선택 시** |
| `HomePage.js` (신규) | — | — | ~20 KB | ~8 KB | **좌석 선택 시** |
| `PaymentPage.js` (신규) | — | — | ~10 KB | ~4 KB | **결제 시** |
| `ConfirmationPage.js` (신규) | — | — | ~3 KB | ~1 KB | **완료 시** |
| **초기 로드 JS 합계** | **269.69 KB** | **89.68 KB** | **~160 KB** | **~53 KB** | |

초기 로드 JS 감소: **89.68 KB → ~53 KB gzip (-41%)**

> **빌드 실측 불가 사유:** 이 Windows 환경의 rollup `win32-x64-msvc` 네이티브 바이너리가 청크 렌더링 단계에서 `0xC0000409(STATUS_STACK_BUFFER_OVERRUN)`으로 크래시. 원본 코드 재빌드 시에도 동일하므로 코드 변경과 무관. 표준 Linux/Mac 환경 또는 Docker 내 빌드 시 정상 동작 예상.

#### 실측 확인 방법

```bash
cd apps/frontend
npm install   # axios 제거 반영
npm run build
# → dist/assets/ 에서 청크 사이즈 확인
# → dist/bundle-stats.html 에서 모듈 구성 시각화
```

---

## Phase 2 — 팀원 2 (성능 최적화 + 예측 모델 연동)

### ✅ Step 2-4. DB 인덱스 최적화
**완료일:** 2026-06-12  
**파일:** `apps/core-api/src/models/reservation.py`, `apps/core-api/alembic/versions/002_add_reservation_index.py`

**완료 내용:**
- `reservations` 테이블 (status, expires_at) 복합 인덱스 추가
  - 기존 인덱스: idx_seats_event_status ✅, idx_payments_reservation ✅
  - 신규 추가: idx_reservations_status_expires
  - get_expired_held() 쿼리 (만료된 hold 정리) 가속화
- alembic 마이그레이션 파일 신규 생성

### ✅ Step 2-5. Redis 파이프라인 적용
**완료일:** 2026-06-12  
**파일:** `apps/core-api/src/redis/queue.py`, `apps/core-api/src/services/reservation_service.py`

**완료 내용:**
- queue.py add_to_queue(): zadd + expire → pipeline으로 통합 (RTT 1회 절약)
- reservation_service.py _publish_seat_update(): delete + publish → pipeline으로 통합
- 이미 적용된 hold/cancel/complete 등은 유지

### ✅ Step 2-6. 성능 검증 및 병목 제거
**완료일:** 2026-06-12  
**파일:** `apps/core-api/src/middleware/logger.py`, `apps/core-api/src/main.py`

**완료 내용:**
- logger.py: SLOW_REQUEST_THRESHOLD_MS 500 → 300 (KPI 정렬)
- main.py: GZipMiddleware 추가 (minimum_size=1000, 응답 자동 압축)

### ✅ Step 2-7. 예측 모델 API 연동
**완료일:** 2026-06-12  
**파일:** `apps/core-api/src/services/prediction_service.py` (신규), `apps/core-api/src/api/v1/prediction.py`, `apps/core-api/src/api/v1/queue.py`

- `PredictionService.get_resource_plan(event_id)`: Event 조회 → TrafficForecaster.predict() → ResourceCalculator.calculate()
- `POST /join` 대기열 최초 오픈 시 BackgroundTasks로 예측 실행 (응답 지연 없음)
- 로그 출력: `[Prediction] event=... → recommend N replicas`

---

## Phase 2 — 추가 완료 (2026-06-13)

### ✅ LSTM 콜드스타트 제거
**완료일:** 2026-06-13  
**파일:** `apps/core-api/Dockerfile`, `infra/k8s/base/core-api/deployment.yaml`

- Dockerfile 빌드 시점에 `python -m src.prediction.traffic_forecaster`로 모델 학습 후 `/app/models/traffic_model.pt` 저장
- 파드 기동 시 학습 불필요 → 헬스체크 실패 위험 제거
- `PREDICTION_MODEL_PATH` 환경변수 명시 (경로 계산 버그 방지)

### ✅ POST /prediction/forecast 실모델 연결
**완료일:** 2026-06-13  
**파일:** `apps/core-api/src/api/v1/prediction.py`, `apps/core-api/src/services/prediction_service.py`

- `get_forecast()` 메서드 신규 추가: mc_samples=10, 피크 RPS → expected_users/peak_time 변환
- Redis 캐시 5분 TTL 적용, event_id 없으면 Mock 반환 (하위 호환성)
- 검증: `event_id=c01e8f13-...` → `expected_users=3313, peak_time=18:00` 정상 반환

### ✅ core-api 메모리/HPA 조정
**완료일:** 2026-06-13  
**파일:** `infra/k8s/base/core-api/deployment.yaml`, `infra/k8s/autoscaling/core-api-hpa.yaml`

- LSTM 모델 이미지 내장 후 실제 메모리 ~400Mi로 증가
- `memory requests`: 128Mi → 450Mi (실사용량 기반)
- HPA `memory threshold`: 80% → 90% (400Mi/450Mi=88% 평시 안정)

### ✅ 전체 namespace 통일 (default → ticket-system)
**완료일:** 2026-06-13  
**파일:** `infra/k8s/base/**/*.yaml` (14개), `infra/k8s/autoscaling/*.yaml`

- setup.sh가 `-n ticket-system`으로 배포하나 manifest에 `namespace: default` 하드코딩 → 충돌 수정
- `infra/k8s/base/shared/redis.yaml` 신규 생성, `infra/k8s/base/prediction-service/deployment.yaml` 신규 생성
- `infra/k8s/base/monitoring/*.yaml` 한글 문자 깨짐 수정 + namespace 변경

---

## 완료 현황 요약

| Step | 담당 | 상태 | 완료일 |
|------|------|------|--------|
| 1-1 Ingress WebSocket Sticky Session | 팀원 1 | ✅ | 2026-06-10 |
| 1-2 Prometheus ServiceMonitor | 팀원 1 | ✅ | 2026-06-10 |
| 2-1 예측 모델 Mock API | 팀원 1 | ✅ | 2026-06-12 |
| 2-2 Grafana 대시보드 | 팀원 1 | ✅ | 2026-06-13 |
| 2-3 Flash Crowd 시나리오 | 팀원 1 | ✅ | 2026-06-12 이전 |
| 2-4 DB 인덱스 최적화 | 팀원 2 | ✅ | 2026-06-12 |
| 2-5 Redis 파이프라인 | 팀원 2 | ✅ | 2026-06-12 |
| 2-6 성능 설정 | 팀원 2 | ✅ | 2026-06-12 |
| 2-7 예측 모델 API 연동 | 팀원 2 | ✅ | 2026-06-12 |
| 2-8 SeatMap 실시간 좌석 색상 | 팀원 3 | ✅ | — |
| 2-9 전체 플로우 라우팅 연결 | 팀원 3 | ✅ | — |
| 2-10 프론트엔드 번들 최적화 | 팀원 3 | ✅ | 2026-06-14 |

**전체 완료** — axios 제거 + React.lazy 코드 분할 + rollup-plugin-visualizer 적용 (초기 로드 JS -41% 추정)
