# Flash Crowd 시뮬레이션 결과

**실행 일시**: 2026-06-15 14:29 KST  
**총 소요 시간**: 2m 39s  
**대상 이벤트**: Rock Festival 2026 (`3f0b9a87-f1ba-4987-bc1c-d89cd6609e2d`, 500석)  
**테스트 도구**: k6 v2.0.0 (`tests/k6/flash-crowd-local.js`)

---

## 1. 테스트 구성

| 항목 | 값 |
|------|-----|
| 목표 RPS (Flash Crowd) | 200 RPS |
| 사전 할당 VU | 150 VU (max 300) |
| WS 유지율 VU | 50 VU |
| 워밍업 | 0→50 RPS, 30s |
| Flash Crowd | 50→200→200→0 RPS, 20s + 60s + 20s |
| WS 유지 시나리오 | constant 50 VU, 120s |
| 대기열 엔드포인트 | `POST /api/queue/join` (5s timeout) |
| WS 엔드포인트 | Engine.IO @ `ws://localhost:3000` |

### 환경

- 로컬 Windows 11 (Docker Desktop)
- core-api: uvicorn 단일 프로세스 (Python, Docker 컨테이너)
- websocket-service: Node.js Socket.IO (Docker 컨테이너)
- Redis: Docker 컨테이너

---

## 2. 임계값 결과 (Thresholds)

| 지표 | 목표 | 실제 | 결과 |
|------|------|------|------|
| P95 응답시간 | `< 300ms` | `5.01s` | FAIL |
| HTTP 에러율 | `< 5%` | `56.36%` | FAIL |
| WS 유지율 | `> 90%` | `50.00%` | FAIL |

**전체 결과: FAIL (exit code 99)**

---

## 3. 상세 메트릭

### HTTP / 대기열 진입

| 메트릭 | 값 |
|--------|-----|
| 전체 요청 수 | 7,164 (44.99/s) |
| 200 OK (큐 진입 성공) | **121건 (1.7%)** |
| 429 Rate Limited | **2,939건 (41%)** |
| Timeout/Error | **3,952건 (55.2%)** |
| 유효 처리율 (200+429) | **43.63%** |
| HTTP 에러율 | 56.36% |
| 드롭된 이터레이션 | 10,237 (64.29/s) |

#### 응답시간 분포

| 구분 | avg | min | med | p(90) | p(95) | max |
|------|-----|-----|-----|-------|-------|-----|
| 전체 요청 | 3.78s | 2ms | 5s | 5s | **5.01s** | 5.73s |
| 성공 요청만 | 319ms | 9.6ms | 144ms | 350ms | 2.24s | 4.95s |

### WebSocket 유지율

| 메트릭 | 값 |
|--------|-----|
| WS 세션 수립 | 150건 |
| WS 세션 에러/드롭 | 150건 |
| WS 유지율 | **50.00%** |
| WS 연결 시간 (avg) | 213ms |
| WS 연결 시간 (p(95)) | 301ms |
| WS 세션 지속시간 (avg) | 44.98s |
| WS 수신 메시지 수 | 300건 |
| WS 송신 메시지 수 | 450건 |

### 실행 통계

| 메트릭 | 값 |
|--------|-----|
| 완료된 이터레이션 | 7,162 |
| 드롭된 이터레이션 | 10,237 |
| 최대 활성 VU | 350 |
| 데이터 수신 | 767 kB (4.8 kB/s) |
| 데이터 송신 | 1.6 MB (9.9 kB/s) |

---

## 4. 서버 포화 분석

### 포화 시점

Flash Crowd 시나리오 시작 후 **약 13초** 만에 k6가 `Insufficient VUs, reached 300 active VUs` 경고를 발생시켰다. 이는 서버가 요청을 빠르게 처리하지 못해 VU가 쌓였음을 의미한다.

```
running (1m01.9s), 350/400 VUs, 2817 complete and 0 interrupted iterations
flash_crowd  [  32% ] 300/300 VUs  0m31.5s/1m40s  200.00 iters/s   ← maxVUs 도달
```

### 실제 처리량

| 구분 | 목표 | 실제 |
|------|------|------|
| Flash Crowd RPS | 200 RPS | ~45 RPS (전체 평균) |
| 드롭 비율 | 0% | 64.29 dropped iter/s |
| 서버 실효 처리 한계 | - | **약 50-100 RPS** |

워밍업 단계(50 RPS)는 정상적으로 49.98 iters/s를 달성했지만, 200 RPS 급증 이후 uvicorn 단일 프로세스가 포화 상태에 진입하여 대부분의 요청이 5s 타임아웃으로 실패했다.

### 429 Rate Limit vs Timeout 구분

- **429 (2,939건)**: 서버가 처리하되 큐 진입을 거부 → 큐 보호 로직 정상 동작
- **Timeout (3,952건)**: 서버 자체가 응답 불가 → uvicorn 포화로 연결 큐 대기 후 timeout

성공 요청의 P95 응답시간이 2.24s인 것은, 서버가 살아있을 때도 많은 요청이 대기열에 쌓여 늦게 처리되었음을 보여준다.

---

## 5. WebSocket 유지율 해석

WS 유지율 50%의 원인:

```
flash_ws_connected: 150  →  연결 성공 시 wsRetentionRate.add(1) 기록
flash_ws_dropped:   150  →  에러 이벤트 발생 시 wsRetentionRate.add(0) 기록
결과: 150 / (150+150) = 50%
```

WS 연결 자체는 성공했지만(ws_connecting avg=213ms, ws_sessions=150), HTTP 홍수 상황에서 Socket.IO 서버가 응답 지연 또는 연결 끊김을 겪으면서 `socket.on('error')` 이벤트가 발생했다. WS 세션 지속시간이 평균 44.98s인 것은 90s timeout 전에 에러로 종료되었음을 나타낸다.

---

## 6. 로컬 vs 프로덕션 비교

| 항목 | 로컬 결과 | 프로덕션 목표 |
|------|-----------|--------------|
| 목표 RPS | 200 | 5,000~10,000 |
| 실제 처리 RPS | ~50 | - |
| P95 응답시간 | 5.01s (포화) | < 300ms |
| WS 유지율 | 50% (포화 시) | > 99% |
| 포화 원인 | uvicorn 단일 프로세스 | 수평 스케일링으로 해소 |

로컬 환경의 한계:
- uvicorn 단일 워커 → `workers=4` 또는 Gunicorn 앞단 구성 시 처리량 4배 기대
- Docker Desktop Windows 네트워크 오버헤드 (~5ms 추가)
- 5,000 RPS 달성을 위해서는 로드밸런서 + 다중 API 인스턴스 필요

---

## 7. Prometheus 검증 쿼리

Flash Crowd 재현 시 아래 쿼리로 실시간 확인 가능:

```promql
# 초당 요청 수
rate(http_requests_total[10s])

# P95 응답시간
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[10s]))

# 5xx 에러율
rate(http_requests_total{status=~"5.."}[1m]) / rate(http_requests_total[1m])

# WebSocket 활성 연결
socket_io_connections_active

# 대기열 깊이 (Redis)
redis_key_size{key="queue:*"}
```

---

## 8. 결론 및 권고사항

### 확인된 동작

- 큐 보호 로직(429): Flash Crowd 상황에서 정상 발동 (2,939건)
- WS 서비스: HTTP 포화 상황에서도 연결은 수립되나 안정적 유지가 어려움
- 포화점: 로컬 단일 프로세스 기준 **약 50~100 RPS**

### 프로덕션 적용 시 권고

| 조치 | 기대 효과 |
|------|-----------|
| uvicorn workers=4 (또는 Gunicorn) | 처리량 ~4배 |
| 수평 스케일 (API × 3 인스턴스) | 처리량 ~12배 |
| 큐 Rate Limit 튜닝 | 포화 전 429 조기 발동 |
| WS sticky session (Redis adapter) | WS 유지율 안정화 |
| K8s HPA (CPU 60% 트리거) | Flash Crowd 자동 스케일 아웃 |

실제 5,000~10,000 RPS 검증은 AWS/GCP 클라우드 환경에서 k6 Cloud 또는 분산 k6 실행기(k6-operator)를 활용해야 한다.
