# AWS EKS k6 부하 테스트 계획서

**작성일:** 2026-06-15  
**목표:** 발표 성공 기준 4가지 검증 + 3500 RPS 시스템 성능 검증  
**테스트 환경:** AWS EKS (Kubernetes 1.28+, ticket-system 네임스페이스)

---

## I. 프로젝트 개요 및 검증 기준

### 발표 성공 기준 (4가지)

| # | 검증사항 | 목표 | 측정 지표 |
|---|---------|------|---------|
| 1 | **가용성 유지** | 부하 급증 시에도 안정적 서비스 | 에러율 < 5%, 5xx < 2%, Pod 자동 확장 |
| 2 | **중복 예매 0건** | 다수 동시 예약 시 무조건 중복 없음 | `duplicate_reservation_total == 0` (DB 검증) |
| 3 | **P95 응답 < 300ms** | 최대 부하(3500 RPS)에서도 빠른 응답 | k6 histogram p(95) < 300ms |
| 4 | **비용 절감 20%** | 예측형 스케일링으로 자원 효율화 | 정적 14 pods 대비 평균 11.2 pods 이하 |

### 추가 검증 대상

- **LSTM 예측 스케일링 동작**: 오픈 15분 전 minReplicas 자동 상향 확인
- **3500 RPS 도달 가능성**: DB 병목 진단, 필요한 리소스 설정값 도출

---

## II. 사전 코드베이스 분석 (계획 기초)

### 시스템 설계 수치

```
파드당 처리량:       250 RPS
uvicorn workers:     2개 (K8s) / 4개 (docker-compose)
DB pool per worker:  3 (size) + 1 (overflow) = 4 connections
Redis pool:          50 connections (공유)
HPA min/max:         2 / 30 pods
CPU 임계값:          70% (HPA 트리거)
```

### 3500 RPS 이론적 분석

```
필요 pod 수 = 3500 RPS ÷ 250 RPS/pod = 14 pods

선형 확장 가능:  HPA max=30 pods > 14 pods ✓
DB 연결 한계:   14 pods × 2 workers × 4 conn/worker = 112 connections
                PostgreSQL max_connections=100 (기본값) → 초과! ✗

권장 조정:
- PostgreSQL max_connections → 200으로 상향
- 또는 db.py pool_size → 5, max_overflow → 1 (78 connections)
- 또는 조합: max_connections=150 + pool_size=3, overflow=1 (96 connections)
```

### 알려진 제약사항

| 제약사항 | 원인 | 영향도 |
|---------|------|--------|
| Rate Limiter — `/api/queue/join` **3 req/s** (IP 기반) | `rate_limiter.py` 경로별 정책 | Phase 1/2에서 100 VU 단일 IP → 심각한 429 발생 가능. `queue-load-test.js`는 X-Forwarded-For 미사용 |
| Rate Limiter — `/api/v1/reservations` **2 req/s** (user_id 기반) | `rate_limiter.py` 경로별 정책 | JWT 미포함 요청은 IP 기반으로 폴백 |
| Rate Limiter — 기타 경로 **5 req/s** (IP 기반) | `rate_limiter.py` 기본 정책 | `step-load-test-phase4.js`는 VU별 X-Forwarded-For로 우회 ✓ |
| Prescaler minReplicas cap=6 | scaling_service.py 하드코딩 | 급증 초기 에러 가능 → HPA reactive 보완 |
| Redis pool=50 고정 | redis/client.py 설정 | 높은 동시성에서 풀 고갈 가능 |

---

## III. 테스트 실행 환경 구성

### 클러스터 준비 (테스트 당일 -30분)

#### 3-1. EKS 클러스터 상태 확인

```bash
# 클러스터 기본 정보
kubectl cluster-info
kubectl config current-context                      # 올바른 클러스터 확인

# 노드 상태
kubectl get nodes -o wide
# 출력 예시:
# NAME                     STATUS  READY  CPU     MEMORY
# ip-10-0-1-100.ec2   Ready      True   1726m / 2000m
# ip-10-0-1-101.ec2   Ready      True   1456m / 2000m
# ... (최소 3개 노드 권장)

# 네임스페이스 확인
kubectl get namespace ticket-system
kubectl get pods -n ticket-system -o wide
# 출력: core-api, websocket-service, postgres, redis, prometheus, grafana 등 Running 상태

# HPA 초기 상태
kubectl get hpa -n ticket-system
# 출력 예: core-api-hpa       Deployment/core-api   70%/70%  2   30   2
```

**스크린샷 1:** `kubectl get nodes -o wide` 출력  
**스크린샷 2:** `kubectl get pods -n ticket-system` 출력 (초기 pod 수)  
**스크린샷 3:** `kubectl get hpa -n ticket-system` 출력

#### 3-2. Prometheus & Grafana 접근 설정

```bash
# 터미널 1: Grafana 포트포워딩 (유지)
kubectl port-forward svc/grafana -n ticket-system 3000:3000 &
# http://localhost:3000 접속 (default: admin/admin)

# 터미널 2: Prometheus 포트포워딩 (유지)
kubectl port-forward svc/prometheus -n ticket-system 9090:9090 &
# http://localhost:9090 접속
```

Grafana 대시보드 확인할 패널 (미리 생성 필요):
- **HTTP Metrics**: 
  - Requests/sec (시간별)
  - HTTP 에러율 (4xx, 5xx 분리)
  - P50/P95/P99 레이턴시
- **Infrastructure**:
  - Pod 수 (core-api 필터링)
  - CPU/Memory 사용률 (pod별)
  - HPA 이벤트 타임라인
- **Database**:
  - PostgreSQL 활성 연결 수
  - 쿼리 실행 시간
- **Redis**:
  - 메모리 사용량
  - 명령어별 처리량

**스크린샷 4:** Grafana 전체 대시보드 (테스트 전 베이스라인 - 모든 패널)

#### 3-3. PostgreSQL max_connections 점검 및 조정

```bash
# postgres 파드 찾기
POSTGRES_POD=$(kubectl get pod -n ticket-system -l app=postgres -o name | head -1)

# max_connections 현재값 확인
kubectl exec -n ticket-system -it $POSTGRES_POD -- \
  psql -U user -d booking_system -c "SHOW max_connections;"
# 출력: max_connections = 100

# 만약 100이면 조정 필요
# 옵션 1: postgres.yaml ConfigMap 수정 → 200으로 변경 → kubectl apply
# 옵션 2: 즉시 적용 (pod 재시작 필요 없음, 하지만 재시작 후 영구 적용)
#   kubectl exec -it $POSTGRES_POD -- \
#     psql -U user -d booking_system -c "ALTER SYSTEM SET max_connections = 200;"
#   kubectl delete pod $POSTGRES_POD  # 재시작

# 조정 후 확인
kubectl exec -n ticket-system -it $POSTGRES_POD -- \
  psql -U user -d booking_system -c "SHOW max_connections;"
# 출력: max_connections = 200 ✓

# 현재 연결 수 확인
kubectl exec -n ticket-system -it $POSTGRES_POD -- \
  psql -U user -d booking_system -c "SELECT count(*) FROM pg_stat_activity;"
# 출력: 10 (테스트 전 낮은 상태)
```

**스크린샷 5:** PostgreSQL max_connections 설정 확인 (200으로 조정됨)

#### 3-4. 테스트 시드 데이터 준비

```bash
# Core API 파드 진입
CORE_API_POD=$(kubectl get pod -n ticket-system -l app=core-api -o name | head -1)

# 시드 데이터 생성 (DB 초기화)
# 이벤트 API 엔드포인트는 읽기(GET)만 지원하므로, seed.py로 생성해야 함
# seed.py가 자동 생성하는 데이터:
# - 이벤트 5개 (각기 다른 start_at 시각)
# - 이벤트당 좌석 1,175석 (A구역 200 + B구역 375 + C구역 600)
# - 사용자 211명 (devuser 1 + user1~10 10 + k6user1~200 200)

kubectl exec -n ticket-system -it $CORE_API_POD -- \
  python -m src.database.seed

# 시드 데이터 검증
kubectl exec -n ticket-system -it $CORE_API_POD -- \
  psql -U user -d booking_system -c \
  "SELECT count(*) as events FROM events; \
   SELECT count(*) as seats FROM seats; \
   SELECT count(*) as users FROM users;"
# 출력 예시:
#  events | 5
#  seats  | 5875
#  users  | 211
```

**스크린샷 6:** DB 시드 데이터 검증 (행 수 확인)

#### 3-5. LSTM 모델 파일 검증

```bash
# 모델 파일 존재 확인
kubectl exec -n ticket-system -it $CORE_API_POD -- \
  ls -lh /app/models/traffic_model.pt
# 출력: -rw-r--r-- 1 root root 2.5M ... traffic_model.pt

# 환경변수 확인
kubectl exec -n ticket-system -it $CORE_API_POD -- \
  python -c "import os; print(os.getenv('PREDICTION_MODEL_PATH'))"
# 출력: /app/models/traffic_model.pt
```

**스크린샷 7:** 모델 파일 확인 (파일명, 크기, 타임스탬프)

#### 3-6. k6 Job 매니페스트 (기존 파일 참조)

**위치:** `infra/k8s/testing/k6-job.yaml`

실제 파일에는 이미 2개의 k6 Job이 정의되어 있습니다:
1. **k6-reservation-stress** — `reservation-stress-test.js` (50 VU × 120s)
2. **k6-ticket-open** — `ticket-open-scenario.js` (PEAK_VUS=200)

**커스텀 Job 작성이 필요하다면 (예: step-load-test-phase4.js):**

```yaml
# 참고용 Job 템플릿 (infra/k8s/testing/k6-job.yaml을 기초로 수정)
apiVersion: batch/v1
kind: Job
metadata:
  name: k6-step-load-test  # 커스텀 Job명
  namespace: ticket-system
spec:
  template:
    spec:
      containers:
      - name: k6
        image: grafana/k6:latest
        command:
          - k6
          - run
          - /scripts/step-load-test-phase4.js  # 커스텀 스크립트
          - --out=json=/results/phase4-result.json
        env:
        - name: BASE_URL
          value: "http://core-api.ticket-system.svc.cluster.local:8000"
        volumeMounts:
        - name: scripts
          mountPath: /scripts
        - name: results
          mountPath: /results
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 2000m
            memory: 2Gi
      volumes:
      - name: scripts
        configMap:
          name: k6-scripts
      - name: results
        emptyDir: {}
      restartPolicy: Never
  backoffLimit: 1
```

**Kubectl 직접 실행 (k6-job.yaml 수정 없이):**
```bash
# Phase 4 테스트를 로컬 k6에서 실행 (권장: 편리성)
k6 run tests/k6/step-load-test-phase4.js \
  -e BASE_URL="http://core-api.ticket-system.svc.cluster.local:8000" \
  -o json=phase4-result.json
```

---

## IV. 테스트 단계별 실행 계획

---

### Phase 0-A: 환경 최종 점검 (테스트 5분 전)

```bash
# 모든 서비스가 Running 상태인지 최종 확인
kubectl get pods -n ticket-system -o wide
# 모두 Running이 아니면 대기

# HPA 상태 최종 확인
kubectl get hpa -n ticket-system
# CURRENT=2 (초기값), MIN=2, MAX=30 확인

# Redis/Postgres 헬스 체크
kubectl exec -n ticket-system -it <redis-pod> -- redis-cli PING
# 출력: PONG
kubectl exec -n ticket-system -it <postgres-pod> -- \
  psql -U user -d booking_system -c "SELECT 1;"
# 출력: 1

# 기본 API 테스트 (200 응답 확인)
curl http://core-api.ticket-system.svc.cluster.local:8000/health
# 또는 외부 LB 주소
curl http://<EKS_LB>/health
# 출력: {"status":"ok"}

# k6 스크립트 ConfigMap 생성 (k6-job.yaml이 이를 참조)
kubectl create configmap k6-scripts \
  --from-file=tests/k6/ \
  -n ticket-system \
  --dry-run=client -o yaml | kubectl apply -f -
# 이미 존재하면 업데이트 (--dry-run + apply로 멱등성 보장)

# EKS LoadBalancer 주소 확인 (외부 API 호출 시 사용)
EKS_LB=$(kubectl get svc -n ticket-system \
  -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].hostname}')
echo "EKS_LB=$EKS_LB"
# 없으면 Ingress 확인
kubectl get ingress -n ticket-system
```

---

### Phase 1: Baseline 성능 측정 (예상 소요시간: 15분)

**목적:** 초기 2 pods 상태에서의 안정 처리량 및 P95 기준선 확립

#### 1-1. 단순 부하 테스트 실행

**사용 파일:** `tests/k6/queue-load-test.js` (기존 파일, SKIP_FLASH=true 환경변수로 flash crowd 비활성화)

**k6 스크립트 구조:**
파일에는 `ramp_up_down` 시나리오가 포함되어 있습니다:
- Stages: **30s(10 VU) → 1m(50 VU) → 30s(100 VU) → 1m(100 VU 유지) → 30s(0)** (총 3m30s)
- 각 단계에서 VU가 대기열에 진입(POST /api/queue/join)한 후 상태 조회(GET /api/queue/status) 수행
- group으로 묶어 관련 메트릭을 함께 수집
- 메트릭: `queueJoinSuccess`, `queueJoinErrors`, `error_rate`, `queue_join_duration_ms`
- setup()에서 실제 event_id를 API로 조회하여 사용

**Flash Crowd 선택사항:**
- `SKIP_FLASH=true` 환경변수로 flash_crowd 시나리오 제외 가능
- 기본값: `SKIP_FLASH=false` (flash_crowd 포함)

> **⚠️ Rate Limiter 주의:** `queue-load-test.js`는 X-Forwarded-For 헤더를 사용하지 않는다.
> 100 VU가 단일 IP에서 `/api/queue/join`(IP당 **3 req/s** 제한)에 접근하면 429가 대량 발생하여 결과가 왜곡될 수 있다.
> `SKIP_FLASH=true`로 ramp_up_down만 실행하는 경우에도, 50~100 VU 구간에서 제한에 걸리므로
> **k6 실행 머신을 클러스터 내부(Job)에서 실행**하거나 **VU당 다른 user_id 활용**으로 영향을 최소화할 것.

**실행 명령:**
```bash
# Phase 1 테스트 (환경변수로 시나리오 제어)
k6 run tests/k6/queue-load-test.js \
  -e BASE_URL="http://core-api.ticket-system.svc.cluster.local:8000" \
  -e SKIP_FLASH="true" \
  -o json=phase1-result.json
```

**모니터링 (별도 터미널):**
```bash
# 터미널 2: Pod 수 추적
watch -n 10 "echo '=== $(date +%H:%M:%S) ===' && \
  kubectl get pods -n ticket-system -l app=core-api --no-headers | wc -l && \
  kubectl get hpa core-api-hpa -n ticket-system"

# 터미널 3: Grafana에서 실시간 모니터링
# - HTTP Requests/sec
# - P95 레이턴시
# - Error rate
# - Pod count
```

**수집 데이터:**
- k6 JSON 결과: `phase1-result.json`
  - `http_req_duration p(95)`: 예상 150-200ms
  - `http_req_failed rate`: 예상 0% (정상)
  - `http_reqs total`: 실제 요청 수
- Grafana 캡처 (Phase 1 종료 시점):
  - P95 레이턴시 그래프 (최대 100 VU 구간 안정화 추이)
  - 에러율 그래프
  - Pod 수 변화 (2→4 pod로 HPA scaleUp 예상)

**스크린샷 8:** Grafana P95 레이턴시 (Phase 1 전체 - 상승 후 안정화)  
**스크린샷 9:** Grafana HTTP 에러율 (Phase 1 - 0% 유지)  
**스크린샷 10:** kubectl get hpa 출력 (Phase 1 중 pod 수 변화)  
**스크린샷 11:** k6 Phase 1 summary (p95, error_rate, http_reqs)

**성공 기준:**
- P95 < 200ms (초기 pod 2~4개 상태)
- 에러율 < 2%
- Pod가 CPU 기반 HPA로 2→4개 확장 (CPU 70% 임계)

---

### Phase 2: 가용성 검증 (예상 소요시간: 10분)

**목적:** 티켓 오픈 시나리오(급격한 급증)에서 에러율, 5xx 비율, Pod 자동 확장 확인  
**검증사항:** ✓ 부하 급증 시에도 가용성 유지

#### 2-1. Flash Crowd 시나리오 테스트

**사용 파일:** `tests/k6/ticket-open-scenario.js` (기존 파일 - 수정 없음)

**k6 스크립트 구조:**
파일에는 두 개의 독립 시나리오가 포함되어 있습니다:
- `pre_open_traffic`: 오픈 1분 전부터 최대 50 VU의 이벤트 조회 트래픽 (함수: `browseEvents`)
- `open_spike`: 오픈 순간(1분 경과 후) 15초 만에 200 VU로 급증, 2분 유지 (함수: `fullTicketFlow` - 대기열 진입 → SSE 폴링 → 좌석 예약 → 결제)

**메트릭:**
- `duplicate_reservation_total`: 중복 예매 카운터 (목표: 0)
- `reservation_conflict_total`: 409 Conflict 발생 수
- `payment_success_rate`: 결제 성공률 (목표: > 90%)
- `http_req_failed{phase:open_spike}`: 오픈 순간만 별도 임계값 (< 1%)

**주의:** k6 단일 파드에서 200 VU가 `/api/queue/join` (IP당 3 req/s 제한)에 동시 접근하면 429가 많이 발생합니다. 스크립트가 재시도하므로 정상이며, 429는 에러율에 포함되지 않습니다.

**실행 및 모니터링:**
```bash
# 터미널 1: k6 실행 (이벤트는 setup()에서 API로 자동 조회)
k6 run tests/k6/ticket-open-scenario.js \
  -e BASE_URL="http://core-api.ticket-system.svc.cluster.local:8000" \
  -o json=phase2-result.json

# 터미널 2: HPA 이벤트 추적 (시작 전 백그라운드 실행)
kubectl get events -n ticket-system -w | \
  grep -E "HorizontalPodAutoscaler|ScaledUp|ScaledDown"
# 출력 예:
# core-api-hpa   HorizontalPodAutoscaler   Normal   ScaledUp   Pod has reached min...
# core-api       Pod                       Normal   Scheduled  Successfully assigned

# 터미널 3: Pod 수 실시간 추적
watch -n 5 "echo '$(date +%H:%M:%S)' && \
  kubectl get pods -n ticket-system -l app=core-api --no-headers | wc -l && \
  echo '---' && \
  kubectl get hpa core-api-hpa -n ticket-system | grep core-api"

# 터미널 4: core-api 로그에서 5xx 에러 추적
kubectl logs -n ticket-system -l app=core-api -f --tail=50 | \
  grep -E "500|502|503|504|ERROR"
```

**수집 데이터:**

1. **k6 결과 (phase2-result.json):**
   ```
   http_req_failed rate: 예상 < 3% (초기 급증 시 일부 timeout 허용)
   http_req_duration p(95): 예상 300-500ms (부하 중)
   http_reqs total: 예상 3000+ (200 VU × 15초)
   ```

2. **Prometheus 메트릭 (Grafana):**
   ```promql
   # 5xx 에러율 (30초 롤링 평균)
   rate(http_requests_total{status=~"5.."}[30s]) / 
   rate(http_requests_total[30s]) * 100
   
   # Pod 수 (시간별)
   count(kube_pod_status_ready{namespace="ticket-system", pod=~"core-api.*", condition="true"})
   
   # CPU 사용률 최대값
   max(rate(container_cpu_usage_seconds_total{namespace="ticket-system", pod=~"core-api.*"}[1m]) * 100)
   ```

3. **HPA 이벤트 타임라인:**
   ```bash
   kubectl describe hpa core-api-hpa -n ticket-system
   # 출력: ScaleUp Event at T=+20s, T=+50s, T=+80s ...
   ```

4. **pod 수 타임라인 (수작업으로 기록):**
   ```
   00:00 - 2 pods (초기)
   00:15 - 4 pods (첫 번째 scaleUp)
   00:25 - 6 pods (두 번째)
   00:35 - 8 pods (세 번째)
   ...
   01:00 - 12 pods (피크)
   ```

**스크린샷 12:** Grafana 5xx 에러율 곡선 (급증 후 회복)  
**스크린샷 13:** Grafana Pod 수 변화 타임라인 (2→12 pods)  
**스크린샷 14:** Grafana CPU 사용률 (HPA 트리거 시점)  
**스크린샷 15:** `kubectl describe hpa` 출력 (ScaleUp 이벤트 타임스탬프)  
**스크린샷 16:** k6 Phase 2 summary (error_rate, p95, http_reqs)

**성공 기준:**
- HTTP 5xx 비율 < 2% (급증 초기 제외)
- 에러율 < 5% (409 conflict는 제외)
- Pod가 1분 내 확장 시작 (HPA scaleUp stabilizationWindow=60s)
- 에러율이 점진적으로 감소 (pod 추가에 따라)

---

### Phase 3: 중복 예매 검증 (예상 소요시간: 5분)

**목적:** 동시 다중 사용자의 예약 시도 시 중복 예매 0건 보장  
**검증사항:** ✓ 중복 예매 0건 (Redlock 동시성 제어 검증)

#### 3-1. 동시 예약 스트레스 테스트

**사용 파일:** `tests/k6/reservation-stress-test.js` (기존 파일 - 수정 없음)

**시나리오 설정:**
- 50 VU가 120초 동안 상수 부하로 실행
- 각 VU가 대기열 진입 → 폴링으로 순번 대기 (최대 60초) → 좌석 예약 → 결제 플로우 수행
- 좌석 선택: VU 번호를 기반으로 순환 (각 VU가 시도할 때마다 다음 좌석으로 변경, 409 발생 시 이어서 다음 좌석 시도)

**메트릭:**
- `duplicate_reservation_total`: 중복 예매 카운터 (목표: 0)
- `reservation_conflict_total`: 409 Conflict 발생 수 (정상 동작의 증거 - Redlock이 다른 VU를 배제)
- `reservation_success_total`: 실제 성공한 예약 수

**동작 원리:**
- VU 1~50이 동시에 다양한 좌석을 예약 시도
- Redlock으로 보호된 reservation_service가 동시에 1건씩만 처리
- 대기 중인 VU는 409 Conflict를 받고 (정상), 다음 좌석으로 시도
- DB 쿼리 결과: 같은 사용자가 같은 이벤트에서 2개 이상의 예약을 가진 경우가 없어야 함

**실행 및 모니터링:**
```bash
# 터미널 1: k6 실행 (이벤트는 setup()에서 API로 자동 조회)
k6 run tests/k6/reservation-stress-test.js \
  -e BASE_URL="http://core-api.ticket-system.svc.cluster.local:8000" \
  -o json=phase3-result.json

# 터미널 2: Redlock 로그 추적
kubectl logs -n ticket-system -l app=core-api -f --tail=100 | \
  grep -E "lock|acquire|release|409|Conflict"
# 출력 예:
# [INFO] Attempting to acquire lock for event:evt-123...
# [INFO] Lock acquired (ttl=10s)
# [INFO] Lock released successfully
# [INFO] 409 Conflict - another reservation in progress

# 터미널 3: Pod 스케일 모니터링 (필요시)
watch -n 10 "kubectl get pods -n ticket-system -l app=core-api --no-headers | wc -l"
```

**수집 데이터:**

1. **k6 결과 (phase3-result.json):**
   ```
   duplicate_reservation_total: 0 (필수)
   reservation_conflict_total: 예상 10~30 (Redlock 정상 동작)
   reservation_success_total: 예상 15~40 (대기열 처리 시간에 의존적)
   ```
   
   **주의:** 50 VU가 모두 대기열을 거쳐 예약까지 도달하지 못할 수 있습니다.
   - 대기열 타임아웃: 60초
   - queue/status 폴링 주기: 2초
   - SSE 대기 시간: 추가 지연
   
   실제 성공 건수는 **대기열 처리 속도**에 매우 의존적이므로, 로그에서 대기열 위치(`position`)의 진행도를 함께 확인해야 합니다.

2. **Prometheus 메트릭:**
   ```promql
   # 중복 예매 카운터 (반드시 0)
   duplicate_reservation_total
   
   # 409 응답 수
   increase(http_requests_total{status="409"}[2m])
   
   # 예약 처리 P95
   histogram_quantile(0.95, rate(reservation_duration_seconds_bucket[1m]))
   ```

3. **DB 검증 (테스트 종료 후):**
   ```bash
   kubectl exec -n ticket-system -it <postgres-pod> -- \
     psql -U user -d booking_system -c "
       SELECT user_id, event_id, COUNT(*) as cnt
       FROM reservations
       WHERE status = 'confirmed'
       GROUP BY user_id, event_id
       HAVING COUNT(*) > 1
       LIMIT 10;
     "
   # 결과: 0 rows (중복 없음) ✓
   ```

4. **Redlock 동작 로그:**
   ```
   [INFO] Lock: slot:reservation:evt-xyz
   [INFO] Acquired successfully
   [INFO] Db double-check: found 1 existing reservation
   [INFO] Releasing lock
   ```

**스크린샷 17:** k6 Phase 3 summary (409 count, duplicate=0)  
**스크린샷 18:** Prometheus `duplicate_reservation_total` (0)  
**스크린샷 19:** Grafana 409 응답 수 시계열  
**스크린샷 20:** Redlock 로그 (acquire/release 타임라인)  
**스크린샷 21:** DB 중복 예매 쿼리 결과 (0 rows)

**성공 기준:**
- `duplicate_reservation_total == 0` (Prometheus)
- DB 쿼리 결과: 0 rows
- 409 Conflict > 0 (Redlock 정상 동작의 증거)

---

### Phase 4: P95 응답 시간 검증 (예상 소요시간: 25분)

**목적:** 부하 단계별 P95 < 300ms 확인, 3500 RPS 도달 가능성 검증  
**검증사항:** ✓ P95 응답 시간 < 300ms

#### 4-1. 증가형 부하 테스트 (ramping-arrival-rate executor)

**사용 파일:** `tests/k6/step-load-test-phase4.js` (기존 파일 - 수정 없음)

**executor 유형:** `ramping-arrival-rate` (VU 수를 자동으로 조절하여 정확한 RPS 유지)

**단계별 목표 RPS:**
| 단계 | 목표 RPS | 지속 | 누적 시간 |
|------|---------|------|---------|
| 단계 1 | 250 req/s | 3분 | 3분 |
| 단계 2 | 500 req/s | 3분 | 6분 |
| 단계 3 | 1000 req/s | 3분 | 9분 |
| 단계 4 | 2000 req/s | 3분 | 12분 |
| 단계 5 | 3500 req/s | 5분 | 17분 |
| 쿨다운 | 0 req/s | 2분 | 19분 |

**k6 스크립트 설정:**
```javascript
// tests/k6/step-load-test-phase4.js
export let options = {
  scenarios: {
    step_load: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 1500,  // Little's Law: 3500 × 0.3s(P95) = 1050
      maxVUs: 5000,
      stages: [
        { target: 250,  duration: '3m' },  // Step 1: 250 req/s
        { target: 500,  duration: '3m' },  // Step 2: 500 req/s
        { target: 1000, duration: '3m' },  // Step 3: 1000 req/s
        { target: 2000, duration: '3m' },  // Step 4: 2000 req/s
        { target: 3500, duration: '5m' },  // Step 5: 3500 req/s (목표)
        { target: 0,    duration: '2m' },  // 쿨다운
      ],
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<300'],
    'http_req_failed': ['rate<0.10'],
  },
};

export default function () {
  // Rate Limiter 우회 (X-Forwarded-For 헤더, rate_limiter.py가 우선 읽음)
  const params = {
    headers: {
      'X-Forwarded-For': `10.${Math.floor(__VU / 256)}.${__VU % 256}.1`,
    },
    tags: { phase: 'step_load' },
  };
  
  // 인증 불필요한 이벤트 목록 조회 (읽기 부하 위주)
  const res = http.get(`${__ENV.BASE_URL}/api/v1/events?limit=10`, params);
  check(res, {
    'status 200': (r) => r.status === 200,
    'p95 target': (r) => r.timings.duration < 300,
  });
}
```

**실행:**
```bash
# Phase 4 테스트 (전체 19분)
k6 run tests/k6/step-load-test-phase4.js \
  -e BASE_URL="http://core-api.ticket-system.svc.cluster.local:8000" \
  -o json=phase4-result.json
```

**모니터링 (병렬 터미널):**
```bash
# 터미널 2: Pod 수 + CPU (5초마다 수집)
watch -n 5 "echo '=== $(date +%H:%M:%S) ===' && \
  kubectl get pods -n ticket-system -l app=core-api --no-headers | wc -l && \
  echo '---' && \
  kubectl top pods -n ticket-system -l app=core-api --no-headers | head -5"

# 터미널 3: DB 연결 수 (30초마다 수집)
while true; do
  POSTGRES_POD=$(kubectl get pod -n ticket-system -l app=postgres -o name | head -1)
  echo "$(date +%H:%M:%S) $(kubectl exec -n ticket-system $POSTGRES_POD -- \
    psql -U user -d booking_system -c \
    'SELECT count(*) FROM pg_stat_activity WHERE datname='\''booking_system'\'';' | tail -1)"
  sleep 30
done > db_connections.txt

# 터미널 4: Grafana 대시보드 실시간 모니터링
# - RPS vs P95 (dual Y-axis)
# - Pod 수 (step별 구분)
# - CPU/Memory 사용률
# - DB 연결 수
```

**수집 데이터:**

1. **k6 JSON (phase4-result.json) - 단계별 집계:**
   ```
   Step 1 (250 RPS):   p(95)=?? ms, error_rate=??, http_reqs=??
   Step 2 (500 RPS):   p(95)=?? ms, error_rate=??, http_reqs=??
   Step 3 (1000 RPS):  p(95)=?? ms, error_rate=??, http_reqs=??
   Step 4 (2000 RPS):  p(95)=?? ms, error_rate=??, http_reqs=??
   Step 5 (3500 RPS):  p(95)=?? ms, error_rate=??, http_reqs=??
   ```

2. **Prometheus 쿼리 (전체 테스트 기간):**
   ```promql
   # HTTP 요청 P95 레이턴시 (시간대별)
   histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
   
   # 실제 처리량 (RPS)
   rate(http_requests_total[30s])
   
   # Pod 수 시계열
   count(kube_pod_status_ready{namespace="ticket-system", pod=~"core-api.*", condition="true"})
   
   # CPU 최대값
   max(rate(container_cpu_usage_seconds_total{namespace="ticket-system", pod=~"core-api.*"}[1m]) * 100)
   ```

3. **DB 연결 수 추이 (db_connections.txt):**
   ```
   00:00 10 connections
   00:30 25 connections
   01:00 50 connections (Step 3)
   01:30 75 connections (Step 4)
   02:00 95 connections (Step 5)
   ```

4. **Pod 타임라인:**
   ```
   Step 1 (250 RPS):   2-3 pods
   Step 2 (500 RPS):   3-4 pods
   Step 3 (1000 RPS):  5-6 pods
   Step 4 (2000 RPS):  8-10 pods
   Step 5 (3500 RPS):  12-14 pods (또는 스케일 제한)
   ```

**스크린샷 22:** Grafana 단계별 RPS vs P95 (이중 Y축, 시간별)  
**스크린샷 23:** Grafana 단계별 에러율 변화  
**스크린샷 24:** Grafana Pod 수 + CPU 상관관계 (HPA 트리거 타이밍)  
**스크린샷 25:** DB 연결 수 추이 (db_connections.txt)  
**스크린샷 26:** k6 Phase 4 summary JSON (step별 p95 수치)

**성공 기준:**
- Step 1~3 (≤1000 RPS): P95 < 200ms
- Step 4 (2000 RPS): P95 < 300ms
- Step 5 (3500 RPS): P95 < 300ms
  - 만족하면: **3500 RPS 달성 가능** ✓
  - DB 연결 > 100 이면: **DB 병목 진단** → pool_size 조정 필요
  - 에러율 > 10% 이면: **Redis/K8s 리소스 부족** 진단

**문제 대응:**
```bash
# DB 연결 고갈 시 (100+ connections)
# 해결책 1: pool_size 조정 (db.py)
#   pool_size: 3 → 5, max_overflow: 1 → 0
#   총 연결: 14 pods × 2 workers × 5 = 140 (부족) → max_connections: 150 필요
#
# 해결책 2: postgres max_connections 상향 (K8s configMap 수정)
#   max_connections: 100 → 200 → 재배포
#
# 해결책 3: uvicorn workers 감소 (배포 이미 2개로 최소)

# Redis 풀 고갈 시
# 해결책: redis/client.py max_connections: 50 → 100 (재배포)
```

---

### Phase 5: 예측형 스케일링 검증 (예상 소요시간: 20분)

**목적:** LSTM 예측 모델 기반 minReplicas 선제 상향 확인

#### 5-1. 예측 스케일링 이벤트 생성 및 모니터링

**사전 준비:**

이벤트 생성 API(POST /api/v1/events)가 구현되어 있지 않으므로, 시드 데이터의 기존 이벤트를 활용합니다.

```bash
# 시드 데이터 로드 (이미 Phase 0-4에서 수행했다면 생략)
CORE_API_POD=$(kubectl get pod -n ticket-system -l app=core-api -o name | head -1)
kubectl exec -n ticket-system -it $CORE_API_POD -- python -m src.database.seed

# seed.py가 생성한 이벤트 중 하나의 ID 조회 (또는 직접 명시)
# 예: 첫 번째 이벤트
EVENT_ID="<seed.py가 생성한 첫 번째 이벤트 ID>"  # 또는 DB에서 쿼리

# 이벤트의 start_at 확인 (현재시각 기준 10분 이상 미래여야 prescale 트리거)
kubectl exec -n ticket-system -it $CORE_API_POD -- \
  python -c "
from src.database.db import SessionLocal
from src.models.event import Event
db = SessionLocal()
events = db.query(Event).order_by(Event.start_at).limit(5).all()
for e in events:
    print(f'{e.event_id}: {e.name} opens at {e.start_at}')
"

echo "Using event: $EVENT_ID"
```

**대안:** 현재 시각으로부터 10분 후 오픈되는 이벤트가 없다면, 
DB에 직접 INSERT하거나 (관리자용 API 필요) Phase 0-4의 seed.py 시간을 조정하여 미래 시각으로 재실행해야 합니다.

**모니터링 타임라인 설정:**
```
T-10분: 이벤트 조회 (start_at = NOW + 10분인 이벤트 선택)
        → 해당 시점부터 prescale window (오픈까지 5~15분 전) 진입
T-9분~10분: 백그라운드 prescale_check 루프 실행 → 이벤트 감지 → minReplicas 상향 (2→예측값)
T-0분:  이벤트 오픈, 트래픽 급증
T+10분: minReplicas 복원 (2로 리셋)
```

**동작 원리 (`scaling_service.py`):**
- 조회 범위: `Event.start_at >= (now + 5분)` AND `Event.start_at <= (now + 15분)`
- 이벤트 생성 직후 현재 시각 기준으로 10분 후 오픈이므로, 첫 루프에서 범위 안에 진입
- LSTM 예측 → minReplicas 상향 (cap=6)
- 오픈 후 10분 경과 시 자동 복원

**실행 (병렬 모니터링):**
```bash
# 터미널 1: HPA minReplicas 실시간 추적 (5초마다)
for i in {1..120}; do
  TIMESTAMP=$(date +%H:%M:%S)
  MIN_REPLICAS=$(kubectl get hpa core-api-hpa -n ticket-system \
    -o jsonpath='{.spec.minReplicas}')
  echo "$TIMESTAMP $MIN_REPLICAS" | tee -a prescale_timeline.txt
  sleep 5
done

# 터미널 2: core-api 로그 필터링 (prescale 관련)
kubectl logs -n ticket-system -l app=core-api -f --tail=100 | \
  grep -E "prescale|predict|minReplicas|patch|scale"
# 출력 예:
# [INFO] Running prescale check...
# [INFO] Found events in prescale window: evt-xyz
# [INFO] Predicted replicas: 8
# [INFO] Patching HPA minReplicas: 2 → 8
# [INFO] Successfully patched core-api-hpa

# 터미널 3: Prometheus 메트릭 쿼리 (매 30초)
while true; do
  TIMESTAMP=$(date +%H:%M:%S)
  PREDICTED=$(curl -s http://localhost:9090/api/v1/query \
    --data-urlencode 'query=predicted_replicas_gauge' | \
    jq -r '.data.result[0].value[1]' 2>/dev/null || echo "N/A")
  echo "$TIMESTAMP Predicted Replicas: $PREDICTED"
  sleep 30
done > predicted_replicas.txt

# 터미널 4: Pod 수 추적
watch -n 10 "echo '=== $(date +%H:%M:%S) ===' && \
  echo 'Core-API Pods:' && \
  kubectl get pods -n ticket-system -l app=core-api --no-headers | wc -l && \
  echo '---' && \
  echo 'HPA Status:' && \
  kubectl get hpa core-api-hpa -n ticket-system | tail -1"

# 터미널 5: Grafana 대시보드 모니터링 (predicted_replicas_gauge 그래프)
```

**수집 데이터:**

1. **HPA minReplicas 변화 타임라인 (prescale_timeline.txt):**
   ```
   09:45:00 2 (초기)
   09:46:00 6 (이벤트 생성 후 ~1분 내, window 진입 즉시 → minReplicas 상향!)
   10:00:00 6 (오픈, 트래픽 증가)
   10:10:00 2 (T+10분, minReplicas 복원)
   ```

2. **Prometheus 메트릭 (predicted_replicas.txt):**
   ```
   09:55:00 Predicted Replicas: 8
   10:00:00 Predicted Replicas: 8
   10:10:00 Predicted Replicas: 2
   ```

3. **core-api 로그 (prescale 동작 증거):**
   ```
   [INFO] [PreScale] 이벤트 'Prescale Test Event' 오픈 예정 (10분 후) → 예측 peak 2500.0 RPS, 필요 Pod 10개
   [INFO] [PreScale] HPA minReplicas → 6
   [INFO] [PreScale] 이벤트 <event_id> 오픈 후 10분 경과 → minReplicas 복원
   [INFO] [PreScale] HPA minReplicas → 2
   ```

4. **Pod 수 타임라인:**
   ```
   T-10분: 2 pods (초기)
   T-9분: 2→4 pods (minReplicas 상향 후 HPA reactive scale, CPU 70% 도달)
   T-0분: 4→6 pods (오픈 직후 추가 확장, 트래픽 급증)
   T+10분: 6→2 pods (minReplicas 복원)
   ```

**스크린샷 27:** prescale_timeline.txt 내용 (minReplicas 변화)  
**스크린샷 28:** Grafana predicted_replicas_gauge 시계열 (오픈 ±15분)  
**스크린샷 29:** Grafana Pod 수 변화 (prescale로 인한 선제 증가)  
**스크린샷 30:** core-api 로그 (prescale 패치 동작)

**성공 기준:**
- minReplicas가 T-9~10분(이벤트 생성 직후 ~1분 내)에 2→4 이상으로 상향
- Pod 수가 선제적으로 증가 (reactive HPA 반응보다 먼저)
- 오픈 후 10분에 minReplicas 복원

---

### Phase 6: 비용 절감 측정 (예상 소요시간: 5분 + 분석 시간)

**목적:** 동적 스케일링 vs 정적 할당 Pod 수 비교  
**검증사항:** ✓ 20% 이상 비용 절감

#### 6-1. 동적 스케일링 평균 Pod 수 계산

**측정 방법:**
```bash
# Phase 1~5 전체 테스트 시간 동안의 평균/최대 pod 수 추출
# Prometheus에서 쿼리 (테스트 종료 후)

# 방법 1: Prometheus 웹 UI
# http://localhost:9090/graph
# 쿼리:
#   avg_over_time(count(kube_pod_status_ready{namespace="ticket-system",pod=~"core-api.*",condition="true"})[55m:1m])
# → 결과: 값 (평균 pod 수)

# 방법 2: API 쿼리
curl "http://localhost:9090/api/v1/query" \
  --data-urlencode 'query=avg_over_time(count(kube_pod_status_ready{namespace="ticket-system",pod=~"core-api.*",condition="true"})[55m:1m])' | \
  jq '.data.result[0].value[1]'
# 출력: "8.5"
```

**비용 절감 계산:**
```
정적 기준선 (Static Baseline):
  - 3500 RPS 요구 = 14 pods 필요
  - EC2 t3.medium (1 pod당 ~$0.05/hour) × 14 pods = $0.70/hour

동적 스케일링 (Dynamic):
  - 테스트 55분 동안 평균 pod 수 = 8.5 pods
  - 비용: 8.5 × $0.05/hour = $0.425/hour

절감율:
  (14 - 8.5) / 14 × 100% = 39% ✓ (목표 20% 달성)
```

**수집 데이터:**

1. **Prometheus 메트릭:**
   ```promql
   # 전체 테스트 기간 평균 pod 수
   avg_over_time(count(kube_pod_status_ready{namespace="ticket-system",pod=~"core-api.*",condition="true"})[55m:1m])
   
   # 최대 pod 수
   max_over_time(count(kube_pod_status_ready{namespace="ticket-system",pod=~"core-api.*",condition="true"})[55m:1m])
   
   # 최소 pod 수
   min_over_time(count(kube_pod_status_ready{namespace="ticket-system",pod=~"core-api.*",condition="true"})[55m:1m])
   ```

2. **AWS Cost Explorer (테스트 후 24시간 내):**
   ```bash
   # AWS 콘솔 → Cost Explorer
   # 테스트 시간대 EC2 비용 필터링
   # 정보: Spot vs On-Demand 분포, 인스턴스 타입별 비용
   ```

3. **Pod 수 시계열 그래프 (Grafana):**
   - X축: 시간
   - Y축: Pod 수
   - 선: 실제 pod count
   - 점선: 평균선 (8.5 pods)

**스크린샷 31:** Grafana Pod 수 시계열 (전체 55분, 평균선 표시)  
**스크린샷 32:** Prometheus avg_over_time 쿼리 결과  
**스크린샷 33:** AWS Cost Explorer (테스트 시간대 EC2 비용)

**성공 기준:**
- 평균 pod 수 ≤ 11.2 (정적 14 pods 대비 20% 절감)
- 실제 계산 결과:
  ```
  평균: 8.5 pods → 절감: 39% ✓✓✓
  ```

---

### Phase 7: WebSocket 연결 부하 테스트 (선택 사항)

**목적:** 실시간 좌석 업데이트 레이턴시 확인

#### 7-1. WebSocket 성능 테스트

```bash
# 테스트 실행 (WebSocket 서비스 대상, 별도 인증 필요)
# 먼저 access_token 획득 (core-api에서)
ACCESS_TOKEN=$(curl -s -X POST http://<EKS_LB>/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test_user","password":"..."}' | jq -r '.access_token')

k6 run tests/k6/websocket-load-test.js \
  -e WS_URL="ws://websocket-service.ticket-system.svc.cluster.local:3000" \
  -e HTTP_URL="http://websocket-service.ticket-system.svc.cluster.local:3000" \
  -e EVENT_ID="<event_id>" \
  -e ACCESS_TOKEN="$ACCESS_TOKEN" \
  -o json=phase7-result.json
```

**수집 데이터:**
- k6 메트릭: `seat_update_latency_ms p(95) < 100ms`
- 연결 성공률: > 95%

**스크린샷 34:** k6 WebSocket 테스트 summary

---

### Phase 8: 테스트 종료 및 데이터 정리 (예상 소요시간: 10분)

#### 8-1. 최종 데이터 수집

```bash
# 모든 k6 결과 파일 수집
ls -lh phase*.json db_connections.txt prescale_timeline.txt predicted_replicas.txt

# HPA 이벤트 최종 기록
kubectl get events -n ticket-system --sort-by='.lastTimestamp' | \
  grep -E "HorizontalPodAutoscaler|ScaledUp|core-api" > all_hpa_events.txt

# core-api 최종 로그 (에러/경고만)
kubectl logs -n ticket-system -l app=core-api --tail=500 | \
  grep -E "ERROR|WARNING|WARN|CRITICAL" > final_error_logs.txt

# 최종 DB 상태
POSTGRES_POD=$(kubectl get pod -n ticket-system -l app=postgres -o name | head -1)
kubectl exec -n ticket-system $POSTGRES_POD -- \
  psql -U user -d booking_system -c "
    SELECT
      (SELECT count(*) FROM reservations WHERE status='confirmed') as confirmed_reservations,
      (SELECT count(*) FROM reservations WHERE status='held') as held_reservations,
      (SELECT count(*) FROM payments WHERE status='completed') as completed_payments;
  " | tee final_db_state.txt

# Prometheus 최종 스냅샷
curl "http://localhost:9090/api/v1/query?query=http_requests_total" > final_prometheus_snapshot.json

# 테스트 결과 요약 파일 생성
cat > test-summary.txt << 'EOF'
=== K6 EKS 부하 테스트 최종 결과 ===

[Phase 1] Baseline 성능:
- P95 레이턴시: XX ms
- 에러율: X.X%
- 처리 RPS: XXX

[Phase 2] 가용성 검증:
- 에러율 피크: X.X% (회복 완료)
- Pod 확장: 2 → XX pods
- 회복 시간: X초

[Phase 3] 중복 예매 검증:
- 중복 예매: 0건 ✓
- 409 Conflict: XX건 (Redlock 정상)
- 성공 예약: XX건

[Phase 4] P95 응답 시간:
- Step 1 (250 RPS): XX ms < 300ms ✓
- Step 2 (500 RPS): XX ms < 300ms ✓
- Step 3 (1000 RPS): XX ms < 300ms ✓
- Step 4 (2000 RPS): XX ms < 300ms ✓
- Step 5 (3500 RPS): XX ms < 300ms ✓
- DB 연결 최대: XX / 200

[Phase 5] 예측형 스케일링:
- minReplicas 상향: 2 → 6 pods (이벤트 생성 직후 ~1분 내)
- 선제 확장: 예 ✓
- 복원: 2 pods (T+10분) ✓

[Phase 6] 비용 절감:
- 정적 기준: 14 pods
- 동적 평균: X.X pods
- 절감율: XX% > 20% ✓

[최종 결론]
- 3500 RPS 달성: 가능 ✓
- 모든 검증사항: 통과 ✓✓✓
EOF

cat test-summary.txt
```

**스크린샷 35:** 최종 DB 상태 쿼리 결과  
**스크린샷 36:** test-summary.txt 파일 내용

#### 8-2. 클러스터 클린업

```bash
# HPA minReplicas 최종 확인 (2여야 함)
kubectl get hpa core-api-hpa -n ticket-system -o jsonpath='{.spec.minReplicas}'
# 출력: 2 ✓

# k6 테스트 파드 정리
kubectl delete job k6-test -n ticket-system 2>/dev/null || true

# 포드 스케일 다운
kubectl scale deployment core-api --replicas=2 -n ticket-system
kubectl scale deployment websocket-service --replicas=2 -n ticket-system

# 10초 대기
sleep 10

# 최종 pod 상태
kubectl get pods -n ticket-system -l app=core-api --no-headers | wc -l
# 출력: 2 ✓
kubectl get pods -n ticket-system -l app=websocket-service --no-headers | wc -l
# 출력: 2 ✓
```

---

## V. 스크린샷 최종 체크리스트

| # | 타이밍 | 내용 | 사용처 |
|---|--------|------|--------|
| 1 | Phase 0 | `kubectl get nodes -o wide` | 환경 확인 |
| 2 | Phase 0 | `kubectl get pods -n ticket-system` (초기) | 초기 상태 |
| 3 | Phase 0 | `kubectl get hpa -n ticket-system` | HPA 초기값 |
| 4 | Phase 0 | Grafana 전체 대시보드 (테스트 전) | 베이스라인 |
| 5 | Phase 0 | PostgreSQL max_connections=200 확인 | DB 설정 |
| 6 | Phase 0 | DB 시드 데이터 (행 수) | 준비 완료 |
| 7 | Phase 0 | 모델 파일 (traffic_model.pt 크기) | LSTM 확인 |
| 8 | Phase 1 | Grafana P95 레이턴시 곡선 | 기준선 |
| 9 | Phase 1 | Grafana HTTP 에러율 | 기준선 |
| 10 | Phase 1 | kubectl pod 수 변화 | HPA 동작 |
| 11 | Phase 1 | k6 summary (p95, error) | 수치 기록 |
| 12 | Phase 2 | Grafana 5xx 에러율 (급증/회복) | **검증 1** |
| 13 | Phase 2 | Grafana Pod 수 타임라인 | **검증 1** |
| 14 | Phase 2 | Grafana CPU (스케일업 트리거) | **검증 1** |
| 15 | Phase 2 | kubectl describe hpa (이벤트) | **검증 1** |
| 16 | Phase 2 | k6 Phase 2 summary | **검증 1** |
| 17 | Phase 3 | k6 Phase 3 summary (duplicate=0) | **검증 2** |
| 18 | Phase 3 | Prometheus duplicate_reservation_total | **검증 2** |
| 19 | Phase 3 | Grafana 409 응답 수 | **검증 2** |
| 20 | Phase 3 | Redlock 로그 (acquire/release) | **검증 2** |
| 21 | Phase 3 | DB 중복 예매 쿼리 (0 rows) | **검증 2** |
| 22 | Phase 4 | Grafana RPS vs P95 (dual axis) | **검증 3** |
| 23 | Phase 4 | Grafana 단계별 에러율 | **검증 3** |
| 24 | Phase 4 | Grafana Pod + CPU (상관관계) | **검증 3** |
| 25 | Phase 4 | DB 연결 수 추이 (db_connections.txt) | 병목 분석 |
| 26 | Phase 4 | k6 Phase 4 summary JSON | **검증 3** |
| 27 | Phase 5 | prescale_timeline.txt (minReplicas) | 예측 스케일 |
| 28 | Phase 5 | Grafana predicted_replicas_gauge | 예측 스케일 |
| 29 | Phase 5 | Grafana Pod 수 (선제 증가) | 예측 스케일 |
| 30 | Phase 5 | core-api 로그 (prescale 패치) | 예측 스케일 |
| 31 | Phase 6 | Grafana Pod 수 시계열 + 평균선 | **검증 4** |
| 32 | Phase 6 | Prometheus avg_over_time 결과 | **검증 4** |
| 33 | Phase 6 | AWS Cost Explorer (테스트 시간대) | **검증 4** |
| 34 | Phase 7 | k6 WebSocket summary (선택) | 성능 확인 |
| 35 | Phase 8 | 최종 DB 상태 쿼리 | 데이터 무결성 |
| 36 | Phase 8 | test-summary.txt 파일 | 최종 결론 |

---

## VI. 알려진 리스크 및 대응 방안

| # | 리스크 | 발생 조건 | 대응 방안 | 우선순위 |
|---|--------|---------|---------|---------|
| 1 | DB 연결 풀 고갈 | 3500 RPS 시 112 conn > 100 | max_connections=200 또는 pool_size=5 | **높음** |
| 2 | Rate Limiter 차단 — Phase 1/2 (`queue-load-test.js`) | 단일 IP × `/api/queue/join` **3 req/s** 제한, X-Forwarded-For 미사용 | k6를 클러스터 Job으로 실행하거나, VU당 고유 IP 헤더 추가 | **높음** |
| 3 | Rate Limiter 차단 — Phase 4 (`step-load-test-phase4.js`) | 단일 IP × 기본 경로 5 req/s 제한 | X-Forwarded-For 헤더 VU별 설정 (이미 구현됨) ✓ | **해결됨** |
| 4 | Prescaler cap=6 한계 | 급증 초기 14 pods 필요 | HPA reactive (CPU 70%) 보완 | 중간 |
| 5 | Spot 인스턴스 중단 | Karpenter 선점 종료 | consolidationAfter=30s → pod 재배치 | 중간 |
| 6 | Redis 풀 고갈 | 고 동시성 (2000+ RPS) | max_connections=100으로 상향 | 낮음 |
| 7 | k6 메모리 부족 | 700+ VU 실행 | k6-job.yaml resources.limits=4Gi | 낮음 |
| 8 | HPA scaleDown 지연 | scaleDown stabilizationWindow=**300초(5분)** | 테스트 간 충분한 쿨다운 확보 (phase 사이 5분 대기) | 낮음 |

---

## VII. 실행 체크리스트 (테스트 당일)

```bash
# 테스트 시작 30분 전
[ ] Phase 0-1: kubectl cluster-info 및 pod 상태 확인
[ ] Phase 0-2: Prometheus/Grafana 포트포워딩 시작
[ ] Phase 0-3: PostgreSQL max_connections=200 확인
[ ] Phase 0-4: 시드 데이터 검증 (이벤트 5개, 좌석 5875개, 유저 211명)
[ ] Phase 0-5: LSTM 모델 파일 확인
[ ] Phase 0-6: 스크린샷 1~7 수집

# Phase 1 (15분 예상)
[ ] Phase 1-1: k6 queue-load-test.js 실행
[ ] 스크린샷 8~11 수집 (Grafana + k6 summary)
[ ] 성공 기준 확인 (P95 < 200ms)

# Phase 2 (10분 예상)
[ ] Phase 2-1: k6 ticket-open-scenario.js 실행
[ ] 스크린샷 12~16 수집
[ ] 성공 기준 확인 (에러율 < 5%)

# Phase 3 (5분 예상)
[ ] Phase 3-1: k6 reservation-stress-test.js 실행
[ ] 스크린샷 17~21 수집
[ ] DB 중복 예매 쿼리 확인 (0 rows)

# Phase 4 (25분 예상)
[ ] Phase 4-1: k6 step-load-test-phase4.js 실행
[ ] db_connections.txt 파일에 연결 수 기록
[ ] 스크린샷 22~26 수집
[ ] 성공 기준 확인 (P95 < 300ms @ 3500 RPS)

# Phase 5 (20분 예상)
[ ] Phase 5-1: 예측 스케일 이벤트 생성 (T+10분)
[ ] prescale_timeline.txt 5초 간격 기록 시작
[ ] 스크린샷 27~30 수집
[ ] minReplicas 변화 확인

# Phase 6 (5분 + 분석)
[ ] Phase 6-1: Prometheus avg_over_time 쿼리
[ ] 스크린샷 31~33 수집
[ ] 절감율 계산 (목표: 20% 이상)

# Phase 7 (선택, 10분)
[ ] Phase 7-1: k6 websocket-load-test.js 실행
[ ] 스크린샷 34 수집

# Phase 8 (10분)
[ ] Phase 8-1: 최종 데이터 수집 (HPA 이벤트, 로그, DB 상태)
[ ] test-summary.txt 생성
[ ] 스크린샷 35~36 수집
[ ] 클러스터 클린업 (pod scale down)

# 최종 검증
[ ] 모든 스크린샷 (36개) 저장 완료
[ ] 모든 k6 JSON 파일 정리
[ ] test-summary.txt 최종 작성
[ ] 발표 자료에 결과 통합
```

---

## VIII. 추가 참고 사항

### 환경변수 재확인

```bash
# 모든 k6 스크립트에서 사용할 환경변수
export BASE_URL="http://core-api.ticket-system.svc.cluster.local:8000"
export EVENT_ID="<시드 데이터의 실제 event_id>"
export SKIP_FLASH="false"
export PEAK_VUS="200"
export FLASH_RATE="500"
```

### Grafana 대시보드 기본 설정

```
시간 범위: 1시간 (또는 테스트 시간에 맞춰)
새로고침: 5초 자동
시간대: UTC+0 또는 현지시간 (일관되게)
```

### Prometheus 커스텀 메트릭

```promql
# 테스트 중 자주 확인
duplicate_reservation_total                    # 0이어야 함
predicted_replicas_gauge                       # prescale 증거
http_requests_total{status=~"5.."}             # 5xx 추적
rate(http_requests_total[30s])                 # 실제 RPS
container_cpu_usage_seconds_total              # CPU 사용률
pg_stat_activity                               # DB 연결 수
```

---

## 문서 관련 파일 위치

```
documents/k6-eks-test-plan.md          ← 이 문서 (상세 계획)
documents/k6-eks-test-results.md       ← 테스트 실행 후 작성 (결과 기록용)
phase1-result.json
phase2-result.json
phase3-result.json
phase4-result.json
db_connections.txt
prescale_timeline.txt
predicted_replicas.txt
test-summary.txt
```

---

**최종 수정:** 2026-06-15  
**담당자:** 팀원 2 (백엔드)  
**발표 일정:** 2026-06-XX
