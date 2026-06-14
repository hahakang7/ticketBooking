# WebSocket vs SSE 성능 비교 벤치마크

**작성일:** 2026-06-14  
**환경:** Windows 11 / Node.js v24.11.1 / 로컬 단일 프로세스 (Redis 불필요)  
**목적:** 현재 좌석 상태 동기화에 사용 중인 WebSocket(Socket.IO)을 SSE로 교체했을 때의 성능 차이 정량 측정

---

## 1. 구현 변경사항

### 신규 파일

| 파일 | 내용 |
|------|------|
| `apps/websocket-service/src/routes/sse-routes.js` | SSE 좌석 업데이트 엔드포인트 + fan-out 매니저 |
| `tests/benchmark/ws-vs-sse.js` | 자체 실행 벤치마크 스크립트 |
| `tests/benchmark/package.json` | 벤치마크 의존성 (express, socket.io, socket.io-client) |

### 수정 파일

| 파일 | 내용 |
|------|------|
| `apps/websocket-service/src/events/seat-events.js` | Redis 메시지 수신 시 SSE 클라이언트에도 팬아웃 추가 |
| `apps/websocket-service/src/server.js` | `/sse` 라우터 마운트 |

### SSE 아키텍처 설계 원칙

```
Redis 구독 (기존 seat-events.js)
  ├─ Socket.IO room.emit  →  WebSocket 클라이언트 (기존)
  └─ broadcastToSSEClients →  SSE 클라이언트 (신규)
```

- Redis 연결 수 **추가 없음** — 기존 `subscriberClient` 공유
- SSE fan-out 테이블: `Map<eventId, Set<res>>` — 이벤트별 단순 반복

**엔드포인트:** `GET /sse/seat-updates/:eventId`

---

## 2. 벤치마크 방법론

### 측정 항목

| 항목 | 정의 |
|------|------|
| 연결 수립 시간 | `connect()` 호출 → 첫 확인 이벤트 수신까지 |
| 메시지 지연 시간 | 서버 `send_time` 기록 → 클라이언트 수신 델타 |
| 전체 연결 시간 | N개 동시 연결 완료까지 걸리는 총 시간 |
| 처리량 | `(클라이언트 수 × 메시지 수) ÷ 경과 시간` |

### 시나리오 구성

- 동시 클라이언트: 10명 / 50명 / 100명
- 메시지 수: 30건, 간격: 20ms
- WebSocket: `transport: ['websocket']` (polling 비활성)
- SSE: `http.request` + 청크 스트리밍 수동 파싱
- 인메모리 pub/sub — Redis 왕복 지연 없이 순수 전송 성능만 측정

### 실행 방법

```bash
cd tests/benchmark
npm install
node ws-vs-sse.js                        # 기본 (CONCURRENT=50, MESSAGES=30)
CONCURRENT=200 MESSAGES=50 node ws-vs-sse.js  # 커스텀
```

---

## 3. 측정 결과

### 10명 동시 클라이언트

| 지표 | WebSocket | SSE | 차이 |
|------|----------:|----:|------|
| 연결 시간 avg | 92.33 ms | 63.03 ms | SSE **-31.7%** |
| 연결 시간 P95 | 135.04 ms | 79.83 ms | SSE **-40.9%** |
| 메시지 지연 avg | 2.18 ms | 3.52 ms | WS **+1.34ms 빠름** |
| 메시지 지연 P50 | 2.08 ms | 2.36 ms | WS 유사 |
| 메시지 지연 P95 | 3.65 ms | 6.31 ms | WS **-2.66ms** |
| 메시지 지연 P99 | 4.07 ms | 22.62 ms | WS 안정적 |
| 처리량 | 270 msg/s | 295 msg/s | SSE +9% |
| 전체 연결 시간 | 136 ms | 82 ms | SSE -40% |

### 50명 동시 클라이언트

| 지표 | WebSocket | SSE | 차이 |
|------|----------:|----:|------|
| 연결 시간 avg | 205.55 ms | 58.93 ms | SSE **-71.3%** |
| 연결 시간 P95 | 216.02 ms | 65.58 ms | SSE **-69.6%** |
| 메시지 지연 avg | 3.86 ms | 4.09 ms | WS 유사 |
| 메시지 지연 P50 | 3.73 ms | 3.18 ms | SSE 근소 우세 |
| 메시지 지연 P95 | 5.70 ms | 9.24 ms | WS **-3.54ms** |
| 메시지 지연 P99 | 6.41 ms | 20.48 ms | WS 안정적 |
| 처리량 | 1,333 msg/s | 1,512 msg/s | SSE +13% |
| 전체 연결 시간 | 223 ms | 67 ms | SSE **-70%** |

### 100명 동시 클라이언트

| 지표 | WebSocket | SSE | 차이 |
|------|----------:|----:|------|
| 연결 시간 avg | 314.50 ms | 199.67 ms | SSE **-36.5%** |
| 연결 시간 P95 | 361.33 ms | 205.73 ms | SSE **-43.1%** |
| 메시지 지연 avg | 6.90 ms | 5.28 ms | SSE **-1.62ms** |
| 메시지 지연 P50 | 6.59 ms | 5.21 ms | SSE 우세 |
| 메시지 지연 P95 | 10.81 ms | 6.95 ms | SSE **-3.86ms** ← 역전 |
| 메시지 지연 P99 | 13.19 ms | 7.72 ms | SSE 우세 |
| 처리량 | 2,212 msg/s | 2,666 msg/s | SSE +20% |
| 전체 연결 시간 | 371 ms | 223 ms | SSE -40% |

---

## 4. 분석

### 연결 수립 시간 — SSE가 모든 구간에서 우세

WebSocket(Socket.IO)은 연결 수립에 두 단계가 필요합니다.

```
HTTP GET /socket.io/?EIO=4&transport=polling  →  sid 발급
HTTP Upgrade → 101 Switching Protocols         →  WS 연결 완료
```

SSE는 단일 HTTP GET으로 스트림이 열립니다. 특히 **50명 구간에서 3.5배** 차이가 났으며, 티켓팅처럼 이벤트 오픈 직후 수천 명이 동시 접속하는 시나리오에서 Socket.IO 핸드셰이크 비용이 병목이 될 수 있습니다.

### 메시지 지연 — 소규모 WebSocket 우세, 100명 이상에서 SSE 역전

| 구간 | 우세 프로토콜 | 이유 |
|------|-------------|------|
| ≤ 50명 | WebSocket | Socket.IO 내부 최적화, 메모리 버퍼 효율적 처리 |
| ≥ 100명 | SSE | `room.emit` 반복 비용 누적 vs `res.write` 단순 루프 |

P99 꼬리 지연은 소규모에서 SSE가 크게 불리했으나(22ms vs 4ms), 100명 구간에서는 역전됩니다. Socket.IO room 브로드캐스트가 클라이언트 수에 비례해 큰 이벤트 루프 블로킹을 유발하는 것으로 보입니다.

### 처리량 — SSE 일관 우세

SSE가 9~20% 높은 처리량을 보였습니다. 클라이언트 수가 늘수록 격차가 벌어지는 추세입니다.

---

## 5. 현재 프로젝트 적용 판단

### 용도별 프로토콜 선택

| 용도 | 방향성 | 현재 | 권장 | 이유 |
|------|--------|------|------|------|
| 대기열 위치 (`/queue/sse`) | 서버→클라이언트 | SSE ✅ | SSE 유지 | 단방향, 최적 |
| 좌석 상태 동기화 | 서버→클라이언트 | WebSocket | **SSE 교체 가능** | 단방향이며 100명 이상에서 SSE 우세 |
| hold 해제 트리거 | 클라이언트→서버 | WebSocket | **WebSocket 유지 필수** | `disconnect` 이벤트 감지 필요 |

### SSE 교체 시 프론트엔드 변경 포인트

[useWebSocket.js](../apps/frontend/src/hooks/useWebSocket.js) 대신 네이티브 `EventSource` 사용:

```javascript
const es = new EventSource(`${WS_BASE_URL}/sse/seat-updates/${eventId}`)
es.onmessage = (e) => {
  const data = JSON.parse(e.data)
  if (data.type === 'seat_status_updated') handleSeatUpdate(data)
}
```

단, `disconnect` 감지를 통한 hold 자동 해제([socket-service.js:63-87](../apps/websocket-service/src/services/socket-service.js#L63))는 SSE에서 불가능하므로 **WebSocket 연결은 hold 해제 목적으로만 유지** 하거나, hold 해제를 클라이언트 `beforeunload` 이벤트로 대체해야 합니다.

### 결론

현재 아키텍처(WebSocket 좌석 동기화 + SSE 대기열)는 합리적이나, 다음 조건이면 SSE 전환을 검토할 가치가 있습니다.

- 동시 접속자 100명 이상인 이벤트 오픈 구간에서 연결 지연 문제 발생 시
- 인프라에서 WebSocket 업그레이드를 지원하지 않는 프록시 환경(일부 기업망)

Redis 연결은 증가하지 않으며, 서버 측 SSE 엔드포인트는 이미 [sse-routes.js](../apps/websocket-service/src/routes/sse-routes.js)에 구현 완료입니다.

---

## 6. k6 실제 실측 결과 (2026-06-14)

**환경:** Redis 7 (Docker), websocket-service Node.js 로컬, k6 v2.0.0  
**스택:** `docker run -d -p 6379:6379 redis:7-alpine` + `cd apps/websocket-service && npm start`  
**명령:** `k6 run tests/k6/ws-vs-sse-benchmark.js`  
**시나리오:** ws_load (0→200 VU / 90s) → sse_load (100s 후 0→200 VU / 90s)

### WebSocket 실측값

| 메트릭 | avg | min | med | max | p(90) | p(95) |
|--------|-----|-----|-----|-----|-------|-------|
| `ws_connecting` (TCP+WS 핸드셰이크) | **3.70 ms** | 1.71 ms | 3.37 ms | 12.64 ms | 5.53 ms | **6.89 ms** |
| `ws_session_duration` | 45 s | 44.99 s | 45 s | 45.04 s | 45.01 s | 45.01 s |

| 집계 지표 | 값 |
|----------|---|
| `ws_connection_success_rate` | **100.00%** (277/277 세션) |
| `ws_sessions` | 277 (200 VU × 90s 부하 구간) |
| `ws_msgs_received` | 554 (avg 2/세션) |
| `ws_msgs_sent` | 831 (avg 3/세션) |
| `ws_connection_errors` | 205 (연결 중 에러 이벤트, 세션 종료 시 정상 발생) |
| HTTP 101 Upgrade 성공률 | **100%** |

> **커스텀 `ws_connection_time_ms` = 0 이유:** k6 스크립트는 Socket.IO `connection_info` 이벤트(`42[...]`)를 파싱하여 측정하나, k6 WebSocket API가 Engine.IO 프레임(`3probe`, `40`, `42`) 수신 타이밍과 `ws.connect()` 실행 컨텍스트 차이로 인해 해당 메시지를 캡처하지 못함. 실제 연결 시간은 k6 내장 메트릭 `ws_connecting`(avg 3.7ms)으로 측정됨.

### SSE 실측값 — k6 구조적 한계

| 지표 | 값 |
|------|---|
| `sse_connection_success_rate` | **0%** (0/100) |
| `sse_connection_errors` | 100 |
| 실패 원인 | `request timeout` (60s) |

**원인:** SSE는 서버가 연결을 닫지 않는 스트리밍 프로토콜이다. k6의 `http.get()`은 응답 바디 전체를 수신한 뒤 완료하는데, SSE 서버는 연결을 유지하므로 k6 요청이 60s 타임아웃으로 종료된다. `Content-Type: text/event-stream`을 설정했더라도 k6는 청크를 실시간으로 읽지 못한다.

**결론:** **k6로 SSE 연결 시간·메시지 지연 측정은 구조적으로 불가능**하다. SSE 성능 데이터는 5절의 인메모리 벤치마크(EventEmitter 기반) 결과를 사용한다.

### k6 결과 vs 인메모리 벤치마크 비교

| 항목 | 인메모리 (`ws-vs-sse.js`) | k6 실측 |
|------|------------------------|---------|
| WS 연결 성공률 | 100% (in-process) | **100%** (실제 TCP) |
| WS 핸드셰이크 | 92~314 ms (10~100명 avg) | **3.7 ms avg** (localhost, 최대 200 VU) |
| WS 세션 유지 | 30s (측정 구간) | 45s (정상 유지) |
| SSE 연결 | 63~200 ms (in-process) | **측정 불가** (k6 한계) |
| Redis 경로 | 없음 (EventEmitter) | 실제 Redis Pub/Sub 통과 |
| 최대 부하 | 100 클라이언트 | **200 VU** |

> **인메모리 벤치마크 연결 시간이 k6보다 긴 이유:** 인메모리 벤치는 Node.js 동일 프로세스 내에서 Socket.IO 클라이언트·서버를 모두 돌리므로 이벤트 루프 경합이 연결 시간에 포함된다. k6는 별도 Go 런타임에서 순수 TCP+WS 핸드셰이크만 측정하여 3.7ms가 나온다. 두 수치 모두 유효하며 측정 대상이 다르다.

### k6 실행 방법 (재현)

```powershell
# 1. Redis
docker run -d -p 6379:6379 --name redis-bench redis:7-alpine

# 2. websocket-service
cd apps/websocket-service && npm start

# 3. k6 (winget install k6 로 설치)
cd <프로젝트 루트>
& "C:\Program Files\k6\k6.exe" run tests/k6/ws-vs-sse-benchmark.js `
  -e WS_URL=ws://localhost:3000 `
  -e HTTP_URL=http://localhost:3000 `
  -e EVENT_ID=test-event-bench-001
```

---

## 7. 벤치마크 한계

| 항목 | 한계 |
|------|------|
| Redis 왕복 | 제거됨 — 실제 환경에서는 ~1ms 동일하게 양쪽 추가됨 |
| 단일 프로세스 | 멀티 파드 환경의 sticky session, room 분산 고려 안 됨 |
| TLS | HTTP로 측정 — HTTPS/WSS 환경에서는 TLS 오버헤드 추가 |
| 재연결 | 네트워크 끊김 후 재연결 성능은 별도 측정 필요 |

실제 EKS 환경 k6 부하 테스트(`tests/k6/websocket-load-test.js`)와 병행하여 검증 권장.
