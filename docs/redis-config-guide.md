# Redis 설정 및 네이밍 규칙 가이드

전체 팀이 Redis를 일관성 있게 사용하기 위한 가이드입니다.

## 연결 설정

### Redis URL 포맷

```
redis://[:password@]host[:port][/db]
```

**예시:**
```
redis://localhost:6379        # 로컬 개발
redis://redis:6379           # Docker Compose
redis://redis-cluster:6379   # Kubernetes
```

### 환경변수

모든 서비스는 동일한 환경변수 이름으로 Redis URL을 읽어야 합니다:

```bash
REDIS_URL=redis://redis:6379
```

### 연결 옵션

각 언어별 권장 설정:

**Python (redis-py v5.0+)**
```python
import redis

client = redis.from_url(
    os.getenv('REDIS_URL'),
    decode_responses=True,
    socket_keepalive=True,
    socket_keepalive_options={
        1: 3,   # TCP_KEEPIDLE
        2: 3,   # TCP_KEEPINTVL
    }
)
```

**Node.js (redis v4.x)**
```javascript
const redis = require('redis');

const client = redis.createClient({
  url: process.env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 50, 500)
  }
});
```

## Key Naming Convention

Redis 키는 다음 패턴을 따릅니다:

```
{domain}:{event_id}:{identifier}:{optional_suffix}
```

### 도메인별 키 정의

| 도메인 | 용도 | 타입 | 예시 |
|--------|------|------|------|
| `queue` | 대기열 | Sorted Set | `queue:evt-20260515:users` |
| `seat` | 좌석 상태 | Hash | `seat:evt-20260515:status` |
| `lock` | 분산 락 | String | `lock:seat:evt-20260515:A1` |
| `cache` | 캐시 | String/Hash | `cache:event:evt-20260515` |
| `session` | 사용자 세션 | String | `session:usr-123:token` |

### 구체적인 예시

```
# 대기열
queue:evt-20260515:waiting_users

# 좌석 상태
seat:evt-20260515:status  # Hash 형식
seat:evt-20260515:occupied # Sorted Set (점유 시간)

# 분산 락
lock:seat:evt-20260515:A1           # 좌석 A1 락
lock:reservation:res-456:payment    # 결제 트랜잭션 락

# 캐시
cache:event:evt-20260515            # 이벤트 정보
cache:seat:evt-20260515:A1          # 특정 좌석 정보

# 세션
session:usr-123:queue_token         # 대기 토큰
session:usr-123:access_token        # 접근 토큰
```

## TTL (Time To Live) 정책

각 키 타입별 기본 TTL:

| 키 타입 | 기본 TTL | 설명 |
|---------|---------|------|
| `queue:*` | 1시간 | 대기열 정보 |
| `lock:*` | 5분 | 좌석 임시 점유 |
| `cache:*` | 10분 | 캐시 데이터 |
| `session:*:queue_token` | 1시간 | 대기 토큰 |
| `session:*:access_token` | 24시간 | 접근 토큰 |

**설정 예시 (Python):**
```python
# 5분 TTL로 설정
client.setex('lock:seat:evt-123:A1', 300, 'reservation-456')

# 만료 시간 확인
ttl = client.ttl('lock:seat:evt-123:A1')  # 남은 초 반환
```

## 재연결 전략

네트워크 문제 시 자동 재연결:

**Python:**
```python
import redis
from redis.backoff import ExponentialBackoff
from redis.retry import Retry
from redis.exceptions import BusyLoadingError, ConnectionError, TimeoutError

retry = Retry(ExponentialBackoff(), 5)
client = redis.from_url(
    os.getenv('REDIS_URL'),
    retry=retry,
    retry_on_timeout=True
)
```

**Node.js:**
```javascript
const client = redis.createClient({
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 5) return new Error('Redis max retries exceeded');
      return Math.min(retries * 50, 500); // 최대 500ms 대기
    }
  }
});
```

## 에러 처리

Redis 연결 실패 시:

```python
try:
    result = client.get('key')
except redis.ConnectionError:
    logger.error('Redis connection failed')
    # Fallback 또는 에러 반환
except redis.TimeoutError:
    logger.error('Redis timeout')
    # 재시도 또는 에러 반환
```

## 개발 vs 프로덕션

### 로컬 개발 (docker-compose)
```
REDIS_URL=redis://redis:6379
```

### Kubernetes 프로덕션
```
REDIS_URL=redis://redis-cluster:6379
```

## 모니터링

Redis 상태 확인:

```bash
# Docker Compose
docker exec distribute-sys-redis redis-cli ping

# Kubernetes
kubectl exec -it redis-0 -- redis-cli ping

# 메모리 사용량
redis-cli INFO memory

# 연결 수
redis-cli INFO clients
```
