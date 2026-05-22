# WebSocket Service

Express.js와 Socket.IO 기반의 **실시간 좌석 동기화 서비스**입니다.

## 기능

### Phase 2: 실시간 동기화
- **WebSocket (Socket.IO)**: 0.1초 이내 좌석 상태 전파
- **Redis Pub/Sub**: 여러 서버 인스턴스 간 메시지 브로드캐스트
- **좌석 가용성 시각화**: 실시간 좌석 맵 업데이트
- **연결 관리**: 자동 재연결, heartbeat 체크

## 구조

```
src/
├── index.js                    # 서버 진입점
├── server.js                   # Express 및 Socket.IO 설정
├── config.js                   # 환경 설정
├── middleware/
│   ├── auth.js                # 토큰 검증
│   ├── error-handler.js       # 에러 처리
│   └── logger.js              # 로깅
├── services/
│   ├── socket-service.js      # Socket.IO 핸들러
│   ├── redis-service.js       # Redis Pub/Sub 관리
│   ├── event-service.js       # 이벤트 관리
│   └── seat-service.js        # 좌석 상태 관리
├── utils/
│   ├── redis-client.js        # Redis 클라이언트
│   ├── logger.js              # 로깅
│   ├── constants.js           # 상수
│   └── validators.js          # 입력 검증
├── events/
│   ├── subscription.js        # 구독 이벤트
│   ├── seat-events.js         # 좌석 이벤트
│   └── connection.js          # 연결 이벤트
└── test/
    └── socket.test.js         # Socket.IO 테스트
```

## 핵심 기능

### 1. 이벤트 구독
```javascript
socket.emit('subscribe_event', {
  event_id: 'evt-123',
  access_token: 'token-abc'
});
```
→ 해당 이벤트의 모든 좌석 업데이트를 수신합니다.

### 2. 좌석 상태 실시간 업데이트
```javascript
socket.on('seat_status_updated', (data) => {
  // 좌석 상태가 변경됨
  // 0.1초 이내에 전파됨
});
```

### 3. Redis Pub/Sub 브로드캐스트
여러 WebSocket 서버 인스턴스가 있을 때, Core API가 Redis Pub/Sub으로 메시지를 발행하면 모든 클라이언트가 동시에 업데이트를 받습니다.

```
Redis Channel: seat_updates:{event_id}
→ 모든 서버 인스턴스가 구독
→ 모든 클라이언트가 수신
```

## 환경 설정

`.env` 파일:
```
PORT=3000
NODE_ENV=development
REDIS_URL=redis://localhost:6379
CORE_API_URL=http://localhost:8000
LOG_LEVEL=info
SOCKET_IO_HEARTBEAT=25000
SOCKET_IO_TIMEOUT=60000
```

## 개발

```bash
# 의존성 설치
npm install

# 개발 서버 (nodemon으로 자동 재시작)
npm run dev

# 프로덕션
npm start

# 테스트
npm test

# 린트
npm run lint
```

## Socket.IO 이벤트

### 클라이언트 → 서버 (인바운드)

| 이벤트 | 설명 | 데이터 |
|--------|------|--------|
| `subscribe_event` | 이벤트 채널 구독 | `{ event_id, access_token }` |
| `unsubscribe_event` | 이벤트 채널 구독 취소 | `{ event_id }` |
| `seat_hold` | 좌석 선택 (UI 동기화) | `{ event_id, seat_ids, reservation_id }` |
| `seat_unhold` | 좌석 선택 취소 | `{ event_id, seat_ids, reservation_id }` |

### 서버 → 클라이언트 (아웃바운드)

| 이벤트 | 발생 빈도 | 설명 |
|--------|---------|------|
| `seat_status_updated` | 0.1초 이내 | 좌석 상태 변경 (available/hold/sold) |
| `seat_reserved` | 예약 완료 시 | 좌석 최종 판매 완료 |
| `seat_hold_expired` | 5분 만료 시 | 임시 점유 시간 종료 |
| `seat_availability_summary` | 30초마다 | 전체 가용 좌석 요약 |
| `subscription_confirmed` | 구독 완료 시 | 채널 구독 확인 |
| `connection_info` | 연결 시 | 연결 정보 및 서버 시간 |
| `error` | 오류 발생 시 | 에러 정보 |

자세한 이벤트 명세는 `docs/api-specs/websocket-api.md` 참고.

## 성능 최적화

### 1. Redis Adapter
```javascript
const { createAdapter } = require('@socket.io/redis-adapter');

io.adapter(createAdapter(pubClient, subClient));
```
→ 여러 서버 인스턴스 간 메시지 동기화

### 2. 메시지 배치 처리
변경된 좌석 여러 개를 배치로 묶어서 한 번에 전송:
```javascript
{
  updates: [
    { seat_id: 'A1', status: 'sold' },
    { seat_id: 'A2', status: 'available' },
    // ...
  ]
}
```

### 3. 메모리 효율성
- 각 연결당 메모리: < 1MB
- 동시 연결 목표: 10,000+
- 메시지 처리량: 50,000+ msg/sec

### 4. 연결 관리
- **Heartbeat**: 25초 간격 ping
- **Timeout**: 60초 응답 없으면 연결 해제
- **자동 재연결**: 클라이언트 설정으로 자동 처리

## 모니터링

### Prometheus 메트릭

```
socket_io_connections_active    # 활성 연결 수
socket_io_events_total          # 이벤트 총 개수 (라벨: event_name)
socket_io_message_bytes_sent    # 전송 바이트
socket_io_message_bytes_received # 수신 바이트
socket_io_errors_total          # 에러 총 개수
redis_pubsub_published          # Redis 발행 메시지
```

### 로깅

```javascript
logger.info('User subscribed', { 
  user_id: 'usr-123', 
  event_id: 'evt-123' 
});
```

## 확장성

### 수평 확장 전략
1. **로드 밸런서**: 여러 WebSocket 서버 인스턴스 뒤에 배치
2. **Redis Adapter**: 인스턴스 간 메시지 동기화
3. **Sticky Session**: 동일 클라이언트는 같은 서버로 라우팅

### K8s 배포
```yaml
replicas: 5  # 최소 5개 Pod
maxReplicas: 50  # HPA로 최대 50개까지 자동 확장
```

## 트러블슈팅

### 메시지가 도착하지 않음
1. Redis 연결 확인: `redis-cli ping`
2. Pub/Sub 채널 확인: `redis-cli PSUBSCRIBE 'event:*'`
3. Socket.IO 어댑터 상태 확인

### 연결이 자주 끊김
1. 네트워크 지연 확인: `ping <server>`
2. Heartbeat 간격 조정 (기본 25초)
3. 방화벽/프록시 설정 확인

### 메모리 사용량 증가
1. 좀비 연결 정리: 자동 60초 timeout
2. Redis 메모리 모니터링
3. 불필요한 이벤트 수신 취소

## API 명세

자세한 WebSocket API 명세는 `docs/api-specs/websocket-api.md` 참고.
