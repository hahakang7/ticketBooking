# AWS EKS k6 부하 테스트 결과 기록

**테스트 날짜:** YYYY-MM-DD  
**테스트 기간:** HH:MM ~ HH:MM UTC  
**총 소요 시간:** XX분 XX초  
**담당자:** 팀원 2 (백엔드)  
**환경:** AWS EKS (ticket-system namespace)

---

## I. 실행 환경 최종 상태

### 클러스터 구성 (테스트 시작 시점)

```
노드 수:             X개
노드 타입:          t3.medium (또는 ____)
EKS 버전:           1.28.X
PostgreSQL 설정:    max_connections = 200
Redis 설정:         maxmemory = XXGi, max-clients = 10000
```

**스크린샷 1:** `kubectl get nodes -o wide`

```
NAME                          STATUS  ROLES    CPU      MEMORY
ip-10-0-X-XXX.ec2.internal  Ready   <none>   1726/2000m  1234/1500Mi
```

### 초기 Pod 상태

**스크린샷 2:** `kubectl get pods -n ticket-system -o wide` (테스트 전)

```
NAMESPACE       NAME                            READY   STATUS
ticket-system   core-api-xxxxxxxx-xxxxx         1/1     Running
ticket-system   websocket-service-xxxxxx-xxxxx  1/1     Running
ticket-system   postgres-xxxxx-xxxxx            1/1     Running
ticket-system   redis-xxxxx-xxxxx               1/1     Running
ticket-system   prometheus-xxxxx-xxxxx          1/1     Running
ticket-system   grafana-xxxxx-xxxxx             1/1     Running
```

**초기 pod 수: 2개 (core-api), HPA min/max: 2/30**

### 시드 데이터 확인

**스크린샷 3:** DB 시드 데이터 행 수

```
이벤트:      X개
좌석:        X개
사용자:      X개
```

### LSTM 모델 파일 확인

**스크린샷 4:** `/app/models/traffic_model.pt` 파일 정보

```
파일명:      traffic_model.pt
크기:        X.XMB
생성 시간:   YYYY-MM-DD HH:MM:SS
```

---

## II. Phase 1: Baseline 성능 측정 (완료: O / X)

**실행 시간:** HH:MM ~ HH:MM (예상 15분)  
**목표:** 초기 2 pods에서의 안정 처리량 및 P95 기준선 확립

### 1-1. 테스트 설정

```
k6 스크립트:       queue-load-test-phase1.js
VU 단계:          10 → 50 → 100 → 0
총 지속 시간:      9분
BASE_URL:         http://core-api.ticket-system.svc.cluster.local:8000
EVENT_ID:         [시드 데이터 event_id]
```

### 1-2. 실행 결과

**k6 최종 output:**

```
✓ http_req_duration p(50)=XXXms p(95)=XXXms p(99)=XXXms
✓ http_req_failed rate=X.XX%
✓ http_reqs total=XXXX
✓ checks passed=XXXX failed=X

진행 상황:
  10 VU  2m  ██░░░░░░░░░░░░░░░░ (자동으로 진행 중)
  50 VU  3m  █████░░░░░░░░░░░░░░
  100 VU 3m  ████████░░░░░░░░░░░░
```

**스크린샷 5:** k6 Phase 1 최종 요약

```
execution: local
script: queue-load-test-phase1.js
output: -

scenario: default
 duration: 9m59s, iterations: 2345, VUs: 100→0
 http_req_duration: avg=123ms, p(50)=100ms, p(95)=245ms, p(99)=450ms
 http_req_failed: 0
 http_reqs: 2345
```

### 1-3. 성능 지표

| 메트릭 | 값 | 기준값 | 상태 |
|--------|-----|--------|------|
| P95 레이턴시 | XX ms | < 200ms | ✓ / ✗ |
| 에러율 | X.X% | < 2% | ✓ / ✗ |
| 처리 RPS | XXX req/s | ~500 | ✓ / ✗ |

### 1-4. Grafana 스냅샷

**스크린샷 6:** Grafana P95 레이턴시 곡선 (Phase 1)

```
[그래프]
P95 (ms)
200 ├────────────────────┐
150 ├──────────┐          │
100 ├──┐       │          │
50  │  │       │          │
0   └──┴───────┴──────────┘
    0min     5min    10min
```

**스크린샷 7:** Grafana HTTP 에러율 (Phase 1)

```
[그래프]
Error Rate (%)
5 ├─────────────────────┐
4 │ 0.0%                │
3 │                     │
2 │                     │
1 │                     │
0 └─────────────────────┘
  0min     5min    10min
```

**스크린샷 8:** kubectl get pods (Pod 수 변화)

```
TIMESTAMP  POD_COUNT  HPA_STATUS
09:00:00   2          2/2
09:02:00   2          2/2
09:04:00   3          3/30 (CPU 70% 도달)
09:06:00   4          4/30
09:08:00   3          3/30 (감소 시작)
09:10:00   2          2/30 (복구)
```

### 1-5. 성공 기준 검증

- [✓/✗] P95 < 200ms
- [✓/✗] 에러율 < 2%
- [✓/✗] Pod 자동 확장 동작

---

## III. Phase 2: 가용성 검증 (완료: O / X)

**실행 시간:** HH:MM ~ HH:MM (예상 10분)  
**목표:** 티켓 오픈 시나리오(급등)에서 에러율, 5xx 비율, pod 확장 확인  
**검증사항:** ✓ 부하 급증 시에도 가용성 유지

### 2-1. 테스트 설정

```
k6 스크립트:       ticket-open-scenario-phase2.js
시나리오:          Pre-traffic (1m) → Flash (15s) → Sustained (2m) → Cool-down (1m)
피크 VU:           200
총 지속 시간:      4분 15초
```

### 2-2. 실행 결과

**k6 최종 output:**

```
execution: local
script: ticket-open-scenario-phase2.js

scenario: open_spike
 duration: 4m15s, iterations: 1205, VUs: 200→0
 http_req_duration: avg=250ms, p(50)=200ms, p(95)=450ms, p(99)=800ms
 http_req_failed: X.X%
 http_reqs: 1205
```

**스크린샷 9:** k6 Phase 2 최종 요약

### 2-3. 에러율 추이

**스크린샷 10:** Grafana 5xx 에러율 (급증/회복 곡선)

```
[그래프]
5xx Error Rate (%)
5 ├──────┐
4 │ 4.5% ├───┐
3 │      │   ├─┐
2 │      │   │ ├─┐
1 │      │   │ │ ├─────
0 └──────┴───┴─┴─┴─────
  0s    15s  30s 45s 60s (Flash Crowd 구간)
  
회복 패턴: 급증 → 서서히 감소 (pod 추가에 따라)
```

### 2-4. Pod 확장 타임라인

**스크린샷 11:** Grafana Pod 수 변화 타임라인

```
[그래프]
Pod Count
14 ├────────────────┐
12 │             ┌──┘
10 │          ┌──┘
8  │       ┌──┘
6  │    ┌──┘
4  │ ┌──┘
2  └─┘
  0s   15s  30s  45s  60s

확장 단계:
  T+0s: 2 pods (초기)
  T+15s: 4 pods (CPU 70% 도달, scaleUp 시작)
  T+30s: 6 pods
  T+45s: 8 pods
  T+60s: 10 pods (또는 최종값)
```

### 2-5. CPU 사용률 (스케일업 트리거)

**스크린샷 12:** Grafana CPU 사용률

```
[그래프]
CPU Usage (%)
100 ├──────────────────┐
80  │              ┌───┘
70  │─────────┐    │    ← HPA 임계값 (70%)
60  │         └────┘
50  │
40  │
20  │
0   └──────────────────
   0s    15s  30s  45s  60s
```

### 2-6. HPA 이벤트 타임라인

**스크린샷 13:** `kubectl describe hpa core-api-hpa` 이벤트

```
Events:
  Type    Reason             Age   From                     Message
  ----    ------             ----  ----                     -------
  Normal  SuccessfulRescale  XXs   horizontal-pod-autoscal  New size: 3; reason: cpu resource metric out of range: expected 1400m, current 2100m
  Normal  SuccessfulRescale  YYs   horizontal-pod-autoscal  New size: 4; reason: cpu resource metric out of range: expected 1600m, current 2400m
  Normal  SuccessfulRescale  ZZs   horizontal-pod-autoscal  New size: 6; reason: cpu resource metric out of range: expected 2100m, current 2800m
```

### 2-7. 성공 기준 검증

- [✓/✗] HTTP 5xx 비율 < 2%
- [✓/✗] 에러율 < 5%
- [✓/✗] Pod 1분 내 확장 시작
- [✓/✗] 에러율 서서히 감소 (pod 추가에 따라)

---

## IV. Phase 3: 중복 예매 검증 (완료: O / X)

**실행 시간:** HH:MM ~ HH:MM (예상 5분)  
**목표:** 동시 다중 사용자의 같은 좌석 예약 시도 시 중복 예매 0건  
**검증사항:** ✓ 중복 예매 0건 (Redlock 동시성 제어)

### 3-1. 테스트 설정

```
k6 스크립트:       reservation-stress-test-phase3.js
시나리오:          50 VU, 120초 constant
대상 좌석:         공통 좌석 (seat-001, seat-002, ...)
총 예약 시도:      ~500회
```

### 3-2. 실행 결과

**k6 최종 output:**

```
execution: local
script: reservation-stress-test-phase3.js

scenario: constant_50_vus
 duration: 2m, iterations: 215, VUs: 50
 http_req_duration: avg=280ms, p(50)=250ms, p(95)=450ms, p(99)=900ms
 http_req_failed: X.X%
```

**스크린샷 14:** k6 Phase 3 최종 요약

```
✓ duplicate_reservations_total: 0
✓ 409_conflict_count: XX (정상 - Redlock 작동)
✓ 201_success_count: XX (성공한 예약)
✓ reservation_duration_ms p(95): XXX ms
```

### 3-3. Prometheus 메트릭

**스크린샷 15:** Prometheus `duplicate_reservation_total` 쿼리 결과

```
Query: duplicate_reservation_total
Result: 0 (또는 현재값 = X → 이전값과 동일 = 증가 없음)
```

### 3-4. Grafana 409 응답 수

**스크린샷 16:** Grafana 409 Conflict 응답 수 시계열

```
[그래프]
409 Count
20 ├────┐
15 │    ├─┐
10 │    │ ├─┐
5  │    │ │ └─┐
0  └────┴─┴───┴
  0m    1m    2m

409 발생 = Redlock이 동시 예약을 차단하고 있다는 증거 ✓
```

### 3-5. Redlock 동작 로그

**스크린샷 17:** kubectl logs (Redlock acquire/release)

```
[INFO] Attempting to acquire lock for reservation:event-xyz...
[INFO] Lock acquired successfully (ttl=10s)
[INFO] Double-check: found existing reservation (user_id=..., status=held)
[INFO] Releasing lock
[INFO] -----
[INFO] 409 Conflict returned to client
[INFO] Attempting to acquire lock for reservation:event-xyz...
[INFO] Lock acquired successfully (ttl=10s)
[INFO] New reservation created (seat_id=..., user_id=...)
[INFO] Releasing lock
```

### 3-6. DB 중복 예매 검증 (테스트 종료 후)

**스크린샷 18:** DB 쿼리 결과

```sql
SELECT user_id, event_id, COUNT(*) as cnt
FROM reservations
WHERE status = 'confirmed'
GROUP BY user_id, event_id
HAVING COUNT(*) > 1
LIMIT 10;

Result: 0 rows ✓ (중복 예매 없음)
```

### 3-7. 성공 기준 검증

- [✓/✗] `duplicate_reservation_total == 0` (Prometheus)
- [✓/✗] DB 쿼리 결과: 0 rows
- [✓/✗] 409 Conflict > 0 (Redlock 정상 동작)

---

## V. Phase 4: P95 응답 시간 검증 (완료: O / X)

**실행 시간:** HH:MM ~ HH:MM (예상 25분)  
**목표:** 부하 단계별 P95 < 300ms 확인, 3500 RPS 달성 가능성 검증  
**검증사항:** ✓ P95 응답 시간 < 300ms

### 4-1. 테스트 설정

```
k6 스크립트:       step-load-test-phase4.js
단계 1 (50 VU):    3분, ~250 RPS
단계 2 (100 VU):   3분, ~500 RPS
단계 3 (200 VU):   3분, ~1000 RPS
단계 4 (400 VU):   3분, ~2000 RPS
단계 5 (700 VU):   5분, ~3500 RPS
쿨다운:            2분
총 지속 시간:      19분
```

### 4-2. 단계별 결과 요약

| 단계 | VU | 목표 RPS | 실제 RPS | P95 (ms) | 에러율 | 상태 |
|------|-----|---------|---------|---------|--------|------|
| 1 | 50 | 250 | XX | XX | X.X% | ✓/✗ |
| 2 | 100 | 500 | XX | XX | X.X% | ✓/✗ |
| 3 | 200 | 1000 | XX | XX | X.X% | ✓/✗ |
| 4 | 400 | 2000 | XX | XX | X.X% | ✓/✗ |
| 5 | 700 | 3500 | XX | XX | X.X% | ✓/✗ |

### 4-3. k6 최종 요약

**스크린샷 19:** k6 Phase 4 최종 JSON summary

```json
{
  "metrics": {
    "http_req_duration": {
      "p(50)": XX,
      "p(95)": XX,
      "p(99)": XX
    },
    "http_req_failed": {
      "rate": X.XX
    },
    "http_reqs": {
      "count": XXXX
    }
  },
  "scenarios": [
    { "name": "step1", "p95": XX },
    { "name": "step2", "p95": XX },
    { "name": "step3", "p95": XX },
    { "name": "step4", "p95": XX },
    { "name": "step5", "p95": XX }
  ]
}
```

### 4-4. Grafana - RPS vs P95 (Dual Y-axis)

**스크린샷 20:** Grafana 단계별 RPS (좌축) vs P95 레이턴시 (우축)

```
[그래프]
P95 (ms) | RPS
400      | 4000
300      | 3000
200      | 2000
100      | 1000
0        | 0
         |
    단계 1  단계 2  단계 3  단계 4  단계 5
    
RPS 증가: 250 → 500 → 1000 → 2000 → 3500
P95 추이: XX → XX → XX → XX → XX

목표: P95가 300ms 이하 유지 ✓/✗
```

### 4-5. Grafana - 단계별 에러율

**스크린샷 21:** Grafana 에러율 변화

```
[그래프]
Error Rate (%)
5 ├─────┐
4 │     ├─┐
3 │     │ ├─┐
2 │     │ │ └─┐
1 │     │ │   └─────
0 └─────┴─┴───────
  단계1 단계2 단계3 단계4 단계5
```

### 4-6. Grafana - Pod 수 + CPU 상관관계

**스크린샷 22:** Grafana Pod 수 (좌) vs CPU (우)

```
[그래프]
Pod | CPU%
20  | 100
15  | 80
10  | 60
5   | 40
0   | 0
   단계1 단계2 단계3 단계4 단계5
   
Pod 증가 타이밍 = CPU 70% 도달 시점 ✓
```

### 4-7. DB 연결 수 추이

**스크린샷 23:** db_connections.txt 내용

```
TIMESTAMP  CONNECTIONS  STAGE
10:00:00   10           초기
10:03:00   25           단계1 (50 VU)
10:06:00   45           단계2 (100 VU)
10:09:00   65           단계3 (200 VU)
10:12:00   85           단계4 (400 VU)
10:17:00   XX           단계5 (700 VU) ← 병목 확인
10:19:00   XX           쿨다운
```

**분석:**
- DB 연결 최대: XX개
- PostgreSQL max_connections: 200
- 여유도: XX% (안전: > 20%)
- **병목 여부:** ✓/✗

### 4-8. 성공 기준 검증

| 기준 | 목표 | 실제 | 상태 |
|------|------|------|------|
| 단계 1-3 P95 | < 200ms | XX ms | ✓/✗ |
| 단계 4 P95 | < 300ms | XX ms | ✓/✗ |
| 단계 5 P95 | < 300ms | XX ms | ✓/✗ |
| 에러율 | < 10% | X.X% | ✓/✗ |
| **3500 RPS 달성** | **가능** | **Yes/No** | **✓/✗** |

---

## VI. Phase 5: 예측형 스케일링 검증 (완료: O / X)

**실행 시간:** HH:MM ~ HH:MM (예상 20분)  
**목표:** LSTM 예측 모델 기반 minReplicas 선제 상향 확인

### 5-1. 테스트 설정

```
테스트 이벤트:     start_at = T+10분
prescale 윈도우:   15분 전 ~ 5분 후 (총 20분)
예상 minReplicas 상향: T-5분
minReplicas 복원: T+10분 후
```

### 5-2. HPA minReplicas 타임라인

**스크린샷 24:** prescale_timeline.txt

```
TIMESTAMP  MINREPLICAS  설명
09:45:00   2            초기 상태
09:50:00   2            15분 window 진입 (이벤트 감지)
09:55:00   6            T-5분, minReplicas 상향! (LSTM 예측)
10:00:00   6            이벤트 오픈, 트래픽 급증
10:10:00   2            T+10분, minReplicas 복원

검증:
- minReplicas 변화: 2 → 6 → 2 (예상대로) ✓/✗
- 변화 시점: T-5분 (정확) ✓/✗
```

### 5-3. Prometheus predicted_replicas_gauge

**스크린샷 25:** Grafana predicted_replicas_gauge 시계열

```
[그래프]
Predicted Replicas
10 ├──┐
8  │  ├─────┐
6  │  │     └─────┐
4  │  │           └─┐
2  └──┴─────────────┴
   오픈 전15분  오픈  오픈 후10분

LSTM 예측값: 8 replicas (cap=6으로 최종 minReplicas 설정)
```

### 5-4. Pod 수 선제 증가

**스크린샷 26:** Grafana Pod 수 (prescale vs reactive HPA)

```
[그래프]
Pod Count
10 ├─────┐  (reactive HPA)
8  │     ├──┐
6  │  ┌──┘  │
4  │  │     │
2  └──┘     └
   |T-5분  T=0  T+5분
   
prescale: T-5분에 선제 상향 (minReplicas=6)
reactive: T=0 이후 CPU 기반 계속 확장
```

### 5-5. core-api 로그 (prescale 동작)

**스크린샷 27:** kubectl logs (prescale 패치 동작)

```
[INFO] _prescale_loop iteration
[INFO] Checking upcoming events (window: -15 to +5 min)
[INFO] Found event: evt-xyz, opens in 5 minutes
[INFO] Getting resource plan from PredictionService
[INFO] Cache HIT - using cached prediction
[INFO] Predicted peak_rps=2500±500
[INFO] Recommended replicas=10 (capped at 6)
[INFO] Current HPA minReplicas=2
[INFO] Patching HPA: minReplicas 2→6
[INFO] PATCH /apis/autoscaling/v2/namespaces/ticket-system/horizontalpodautoscalers/core-api-hpa
[INFO] HTTP 200 OK - patch successful
[INFO] Marked event as prescaled
```

### 5-6. Prometheus prescale 메트릭

**스크린샷 28:** Prometheus 쿼리 결과

```
Query 1: prescale_events_total
Result: 1 (또는 증가값 = 1)

Query 2: predicted_replicas_gauge
Result: 6 (또는 8 - 상한값)
```

### 5-7. 성공 기준 검증

- [✓/✗] minReplicas가 T-5분에 2→4 이상 상향
- [✓/✗] Pod 수가 선제적으로 증가
- [✓/✗] 오픈 후 10분에 minReplicas 복원

---

## VII. Phase 6: 비용 절감 측정 (완료: O / X)

**목표:** 동적 스케일링 vs 정적 할당 Pod 수 비교  
**검증사항:** ✓ 20% 이상 비용 절감

### 6-1. 동적 스케일링 평균 Pod 수

**스크린샷 29:** Prometheus avg_over_time 쿼리 결과

```
Query: avg_over_time(count(kube_pod_status_ready{namespace="ticket-system",pod=~"core-api.*",condition="true"})[55m:1m])

Result: X.X pods (평균)

예시:
- Phase 1: 2.5 pods
- Phase 2: 6.8 pods
- Phase 3: 4.2 pods
- Phase 4: 8.9 pods
- Phase 5: 5.5 pods
- Phase 6: 2.0 pods
- 전체 평균: 6.5 pods
```

### 6-2. Pod 수 통계

**스크린샷 30:** Grafana Pod 수 시계열 (55분 전체, 평균선 포함)

```
[그래프]
Pod Count
15 ├─────┐
12 │     ├─────┐
9  │     │     ├─────┐
6  │  ┌──┴─────┴──┐  │
3  │  │  평균 6.5 │  │
0  └──┘───────────┘──┘
   P1  P2  P3  P4  P5  P6

최대: XX pods
평균: X.X pods
최소: 2 pods
```

### 6-3. 비용 절감 계산

**스크린샷 31:** 비용 절감 분석

```
정적 기준선 (Static Baseline):
  - 3500 RPS 대응: 14 pods × 2 workers × 2 cores = 56 CPU cores
  - Pod당 비용: $0.05/hour (t3.medium 기준)
  - 정적 비용: 14 pods × $0.05 = $0.70/hour

동적 스케일링 (Dynamic):
  - 테스트 기간 55분 평균: X.X pods
  - 시간당 환산: XX pods (평균 유지 가정)
  - 동적 비용: X.X pods × $0.05 = $XXX/hour

절감 계산:
  절감율 = (14 - X.X) / 14 × 100% = YY%
  
목표: YY% > 20% ✓/✗
```

### 6-4. AWS Cost Explorer (테스트 후 24시간 내)

**스크린샷 32:** AWS Cost Explorer 테스트 시간대 EC2 비용

```
[스크린샷 정보]
- 날짜 범위: YYYY-MM-DD (테스트 시간대)
- EC2 비용: $X.XX (테스트 55분 포함)
- Spot vs On-Demand: Spot YY%, On-Demand XX%
- 인스턴스 타입 분포:
  - t3.medium: XX%
  - t3.small: XX%
```

### 6-5. 성공 기준 검증

- [✓/✗] 평균 pod 수 ≤ 11.2 (정적 대비 20% 절감)
- [✓/✗] 비용 절감율 계산 완료

---

## VIII. Phase 7: WebSocket 연결 부하 테스트 (선택 사항)

**완료:** O / X (선택 사항)

### 7-1. 테스트 결과 (실행한 경우)

**스크린샷 33:** k6 WebSocket 테스트 summary

```
execution: local
script: websocket-load-test.js

scenario: ws_load
 vus: 1000, duration: 10m
 ws_connecting: avg=15ms, p(95)=50ms
 ws_session_duration: avg=600s
 seat_update_latency_ms: avg=45ms, p(95)=95ms ✓ (< 100ms)
 ws_connection_success_rate: 98.5% ✓ (> 95%)
```

---

## IX. Phase 8: 최종 데이터 정리 및 검증

### 8-1. 최종 DB 상태

**스크린샷 34:** DB 최종 쿼리 결과

```
예약 현황:
  confirmed: XX건 (성공한 예약)
  held: X건 (진행 중)
  cancelled: X건

결제 현황:
  completed: XX건
  failed: X건

데이터 무결성: ✓ (중복 예매 0건)
```

### 8-2. 최종 요약 (test-summary.txt)

**스크린샷 35:** test-summary.txt 파일 내용

```
=== AWS EKS k6 부하 테스트 최종 결과 ===

테스트 날짜:    YYYY-MM-DD
테스트 기간:    HH:MM ~ HH:MM UTC (XX분 YY초)
담당자:         팀원 2 (백엔드)
환경:           AWS EKS (ticket-system)

─────────────────────────────────────────────
[Phase 1] Baseline 성능 측정
상태:           ✓ 완료
P95 레이턴시:   XXX ms (목표: < 200ms)
에러율:         X.X% (목표: < 2%)
처리 RPS:       XXX req/s
결론:           ✓ 기준선 확립

─────────────────────────────────────────────
[Phase 2] 가용성 검증 ★ 검증사항 1
상태:           ✓ 완료
에러율 피크:    X.X% (회복 완료)
Pod 확장:       2 → XX pods
회복 시간:      X초
결론:           ✓ 부하 급증 시 가용성 유지

─────────────────────────────────────────────
[Phase 3] 중복 예매 검증 ★ 검증사항 2
상태:           ✓ 완료
중복 예매:      0건
409 Conflict:   XX건 (Redlock 정상 동작)
DB 검증:        0 rows (중복 없음)
결론:           ✓ 동시 예약 충돌 방지 완벽

─────────────────────────────────────────────
[Phase 4] P95 응답 시간 검증 ★ 검증사항 3
상태:           ✓ 완료
Step 1 (250 RPS):   XXX ms ✓
Step 2 (500 RPS):   XXX ms ✓
Step 3 (1000 RPS):  XXX ms ✓
Step 4 (2000 RPS):  XXX ms ✓
Step 5 (3500 RPS):  XXX ms ✓ (모두 < 300ms)
결론:           ✓ 3500 RPS 달성 가능

─────────────────────────────────────────────
[Phase 5] 예측형 스케일링 검증
상태:           ✓ 완료
minReplicas 상향:  2 → X pods (T-5분)
선제 확장:      ✓ 확인됨
복원:           ✓ 정상 (T+10분)
결론:           ✓ LSTM 예측 정상 동작

─────────────────────────────────────────────
[Phase 6] 비용 절감 측정 ★ 검증사항 4
상태:           ✓ 완료
정적 기준:      14 pods
동적 평균:      X.X pods
절감율:         YY% (목표: > 20%)
결론:           ✓ 비용 절감 목표 달성

─────────────────────────────────────────────
[Phase 7] WebSocket 연결 테스트
상태:           ✓ 완료 / ✗ 스킵
결론:           (실행했으면) ✓ 레이턴시 < 100ms

─────────────────────────────────────────────

★★★ 최종 결론: 모든 검증사항 통과 ★★★

1. ✓ 부하 급증 시에도 가용성 유지 (에러율 < 5%)
2. ✓ 중복 예매 0건 보장 (Redlock 동시성 제어)
3. ✓ P95 응답 시간 < 300ms @ 3500 RPS
4. ✓ 비용 절감 20% 이상 (평균 X.X pods, 절감율 YY%)
5. ✓ LSTM 예측 스케일링 정상 동작

시스템 평가:    ★★★★★ (5/5)
발표 준비도:    100% ✓
```

### 8-3. 클러스터 최종 상태

```
HPA minReplicas 복원:    2 (확인됨) ✓
Pod 스케일 다운:         완료 ✓
테스트 결과 파일:        저장됨 ✓
```

---

## X. 전체 성공 기준 최종 검증

### 검증사항 1: 부하 급증 시 가용성 유지

- [✓/✗] 에러율 < 5%
- [✓/✗] 5xx 비율 < 2%
- [✓/✗] Pod 자동 확장 동작
- [✓/✗] 에러 회복 (pod 추가에 따라)

**최종 상태: 통과 / 불통과**

### 검증사항 2: 중복 예매 0건

- [✓/✗] `duplicate_reservation_total == 0` (Prometheus)
- [✓/✗] DB 쿼리 결과 0 rows
- [✓/✗] Redlock 정상 동작 (409 > 0)

**최종 상태: 통과 / 불통과**

### 검증사항 3: P95 < 300ms @ 3500 RPS

- [✓/✗] Step 1-3 P95 < 200ms
- [✓/✗] Step 4-5 P95 < 300ms
- [✓/✗] 3500 RPS 도달 가능성 확인

**최종 상태: 통과 / 불통과**

### 검증사항 4: 비용 절감 20%

- [✓/✗] 평균 pod 수 ≤ 11.2
- [✓/✗] 절감율 계산: (14 - X.X) / 14 = YY%
- [✓/✗] YY% ≥ 20%

**최종 상태: 통과 / 불통과**

---

## XI. 이슈 및 해결 내역 (발생 시 기록)

### 이슈 1: [제목]
```
발생 시점:  Phase X, HH:MM
증상:       [증상 설명]
원인:       [원인 분석]
해결:       [해결 방법]
결과:       [결과]
```

### 이슈 2: [제목]
```
[동일 형식]
```

---

## XII. 참고 자료 및 파일 목록

### k6 결과 파일
```
phase1-result.json         (Baseline 성능)
phase2-result.json         (가용성 검증)
phase3-result.json         (중복 예매 검증)
phase4-result.json         (P95 응답 시간)
```

### 모니터링 로그
```
db_connections.txt         (DB 연결 수 추이)
prescale_timeline.txt      (minReplicas 변화)
predicted_replicas.txt     (예측 replica 수)
all_hpa_events.txt         (HPA 이벤트)
final_error_logs.txt       (에러/경고 로그)
```

### 최종 결과
```
test-summary.txt           (최종 요약)
final_db_state.txt         (DB 최종 상태)
final_prometheus_snapshot.json  (메트릭 스냅샷)
```

---

## XIII. 다음 단계 및 개선 사항

### 즉시 조치 필요 사항
- [ ] [항목]

### 향후 개선 사항
- [ ] [항목]

### 추가 테스트 필요 사항
- [ ] [항목]

---

**문서 작성 완료:** YYYY-MM-DD HH:MM UTC  
**담당자:** 팀원 2 (백엔드)  
**상태:** ✓ 발표 준비 완료
