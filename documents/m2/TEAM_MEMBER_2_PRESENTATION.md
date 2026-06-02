# Week 1 & 2 발표 요약
## 팀원 2 — FastAPI 백엔드 Core API

---

## 시스템 아키텍처

```
┌─────────────────── 티켓팅 시스템 전체 ──────────────────┐
│                                                         │
│  [사용자 브라우저]                                       │
│       │  HTTP / WebSocket                               │
│       ▼                                                 │
│  ┌──────────────┐    ┌──────────────────────────────┐  │
│  │  WebSocket   │    │        Core API               │  │
│  │  Service     │◄──►│  (팀원2 담당 — Week 1~2)      │  │
│  │  (Node.js)   │    │  FastAPI · 포트 8000           │  │
│  │  포트 3000   │    └──────────┬───────────────────┘  │
│  └──────────────┘               │                      │
│                           ┌─────┴──────┐               │
│                    ┌──────▼──┐   ┌─────▼────┐          │
│                    │ Redis   │   │PostgreSQL│          │
│                    │ 대기열  │   │  5개 테이블│         │
│                    │ 락 · 캐시│   │  5,875좌석│         │
│                    └─────────┘   └──────────┘          │
└─────────────────────────────────────────────────────────┘
```

---

## 전체 흐름

```
Week 1                           Week 2
─────────────────────────────    ──────────────────────────────
DB 설계 & 마이그레이션            Redis 대기열 구현
  └─ 5개 테이블 + 인덱스            └─ Sorted Set FIFO
시드 데이터 5,875좌석 로드          └─ 1시간 TTL 자동 만료
API 기반 (events, health)         JWT 토큰 흐름 (queue → access)
Redis 연결 풀링 준비               Rate Limiting (봇 방어)
CI/CD (lint → test → build)      SSE 실시간 순번 push

검증: API 응답 0.5~29ms ✅        검증: 11개 단위 테스트 PASS ✅
```

---

## Week 1 — FastAPI 기초 + DB 설계

**목표:** 빈 프로젝트에서 실제 동작하는 API 서버 + DB까지

### 핵심 작업

**1. 레이어드 아키텍처 구축**
- API → Service → Repository → ORM 전 계층 완성
- PostgreSQL 5개 테이블 설계: User, Event, **Seat**, Reservation, Payment
- 성능 인덱스 전략: `seats(event_id, status)`, `seats(held_until)` — 이후 대량 조회/만료 처리의 기반

```
요청 (HTTP)
    │
    ▼
┌───────────────────────────────────────┐
│  Middleware                           │  ← rate_limiter.py · logger.py
│  Rate Limit ✓  Logging ✓             │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│  API Layer  (api/v1/)                 │  ← queue.py · events.py
│  Pydantic DTO 검증 ✓                 │    (schemas/ 사용)
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│  Service Layer  (services/)           │  ← queue_service.py
│  비즈니스 로직 · 예외 처리 ✓         │    token_service.py
└───────────┬─────────────┬─────────────┘
            │             │
            ▼             ▼
┌───────────────┐  ┌───────────────────┐
│  Repository   │  │  Redis Layer      │
│  (DB 접근)    │  │  queue.py ✓       │
│  SQLAlchemy   │  │  Sorted Set FIFO  │
└───────┬───────┘  └───────────────────┘
        │
        ▼
┌───────────────┐
│  PostgreSQL   │
│  5개 테이블   │
└───────────────┘
```

**2. Redis 연결 준비**
- Connection Pooling 기반 Redis 클라이언트
- 키 네이밍 규칙 확정 (`queue:evt-123`, `lock:reservation:evt-123`)

**3. CI/CD 파이프라인**
- GitHub Actions 3단계: lint(flake8) → test(pytest) → build(Docker)

### 검증 결과 (2026-05-19)

| 항목 | 결과 |
|------|------|
| DB 마이그레이션 | ✅ 5개 테이블 생성 |
| 시드 데이터 | ✅ 5,875개 좌석 · 5개 이벤트 · 10명 사용자 |
| GET /health | ✅ 200 OK · **0.50ms** |
| GET /api/v1/events | ✅ 200 OK · 29ms · 5개 이벤트 |
| GET /api/v1/events/{id}/seats | ✅ 200 OK · 28ms · **1,175개 좌석** |
| 단위 테스트 | ✅ **11개 PASS** |

---

## Week 2 — Phase 1: 대기열 시스템

**목표:** 트래픽 폭발 상황에서도 순서대로 입장 — Redis Sorted Set 대기열

### 핵심 작업

**1. Redis Sorted Set 대기열**
- `ZADD queue:evt-123 timestamp user_id` → 시간 기반 FIFO 순번
- `ZRANK`로 현재 위치 조회, TTL 1시간 자동 만료
- `consume_token()` — 대기 완료 시 JWT access_token 발급 (Lua 스크립트로 원자성 보장)

**2. JWT 인증 흐름**
- 대기 단계: `queue_token` → 대기 완료 후: `access_token`
- 이후 좌석 예매 API는 access_token 보유자만 접근 가능

**3. Rate Limiting (Redis 슬라이딩 윈도우)**
- `/api/queue/join` : IP당 1 req/sec — 티켓팅 봇 방어
- 일반 API: IP당 10 req/sec

### API 엔드포인트

| 엔드포인트 | 역할 |
|-----------|------|
| `POST /api/queue/join` | 대기열 진입 |
| `GET /api/queue/status` | 현재 순번 조회 |
| `SSE /api/queue/sse` | 실시간 대기 순번 push |

### 코드 품질 개선 (2026-05-25)

- Critical 6건: secret key 기본값 제거, 내부 에러 메시지 클라이언트 노출 차단
- 단위 테스트 11개 PASS 유지

---

## 핵심 수치

| 지표 | 결과 |
|------|------|
| 좌석 데이터 | **5,875개** |
| 헬스체크 응답 | **0.50ms** |
| Rate Limit | **1 req/sec** (대기열 진입) |
| 단위 테스트 | **11개 PASS** |

---

> **1~2주차의 핵심 의미**
> Week 3 Redlock 분산 락이 가능하려면 Redis 연결, DB 트랜잭션, JWT 인증이 모두 준비되어 있어야 했고 — 이 두 주간 그 기반을 완성했습니다.

---

## 기술 세부 구현

### PostgreSQL

**파일:** `apps/core-api/src/database/db.py`

**왜 사용했는가**
예약·결제처럼 "돈이 오가는 데이터"는 ACID 트랜잭션이 필수다. Redis는 빠르지만 트랜잭션 롤백과 관계형 무결성(FK, UniqueConstraint)을 보장하지 않는다. 사용자-좌석-예약-결제 4개 테이블의 관계를 정확히 유지하면서 "중복 예매 0건"을 보장하려면 PostgreSQL이 적합하다.

SQLAlchemy ORM + `QueuePool`로 커넥션 풀링을 구성했다. 연결 설정:

```python
engine = create_engine(
  settings.database_url,
  poolclass=QueuePool,
  pool_size=10,       # 기본 유지 연결 수
  max_overflow=20,    # 피크 시 최대 추가 연결
  pool_pre_ping=True, # 연결 끊김 감지 후 재연결
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
```

- `autocommit=False` → 트랜잭션을 명시적으로 커밋해야 반영됨 (예약/결제 안전성)
- `pool_pre_ping=True` → 장시간 유휴 후 재요청 시 stale 연결로 인한 오류 방지

---

### 인덱스 설계

**파일:** `apps/core-api/src/models/seat.py`, `apps/core-api/alembic/versions/001_initial_schema.py`

**왜 사용했는가**
이벤트 하나에 좌석 1,175개, 전체 5,875개다. 인덱스 없이 "이 이벤트의 available 좌석"을 조회하면 매번 전체 테이블을 스캔한다. 티켓팅 피크 시 수천 명이 동시에 좌석 조회를 요청하면 DB가 즉시 병목이 된다. `(event_id, status)` 복합 인덱스 하나로 이 쿼리를 인덱스 스캔으로 전환해 응답 속도를 확보한다.

ORM 모델에서 `__table_args__`로 인덱스를 선언하고, Alembic 마이그레이션 파일에서 `op.create_index()`로 DB에 실제 생성했다.

```python
# seat.py - ORM 모델 선언
__table_args__ = (
  UniqueConstraint("event_id", "section", "row", "seat_number"),  # 중복 좌석 방지
  Index("idx_seats_event_status", "event_id", "status"),           # 좌석 목록 조회
  Index("idx_seats_held_until", "held_until"),                     # 만료 좌석 탐색
)

# 001_initial_schema.py - Alembic 마이그레이션
op.create_index('idx_seats_event_status', 'seats', ['event_id', 'status'])
op.create_index('idx_seats_held_until', 'seats', ['held_until'])
```

| 인덱스 | 컬럼 | 용도 |
|--------|------|------|
| `idx_seats_event_status` | `(event_id, status)` | 특정 이벤트의 available 좌석 필터 조회 |
| `idx_seats_held_until` | `held_until` | 5분 hold 만료된 좌석 일괄 회수 |
| `idx_reservations_user_created` | `(user_id, created_at)` | 내 예약 목록 시간순 조회 |
| `idx_users_email` | `email` | 로그인 시 이메일 조회 |

### 데이터베이스 관계도

```
users                events               seats
┌──────────┐        ┌──────────┐         ┌────────────────────┐
│ user_id  │        │ event_id │────┬────►│ seat_id            │
│ email    │        │ name     │    │     │ event_id (FK)      │
│ phone    │        │ start_at │    │     │ section / row / num│
└────┬─────┘        │ capacity │    │     │ status             │
     │              └──────────┘    │     │ held_until         │
     │                              │     └────────┬───────────┘
     │         reservations         │              │
     │        ┌─────────────────┐   │              │
     └───────►│ reservation_id  │◄──┘              │
              │ user_id (FK)    │                  │
              │ event_id (FK)   │◄─────────────────┘
              │ status          │  (seat_id도 참조)
              └────────┬────────┘
                       │
              payments │
             ┌─────────▼──────┐
             │ payment_id     │
             │ reservation_id │
             │ amount         │
             │ status         │
             └────────────────┘

인덱스 전략: seats(event_id, status)  ← 좌석 조회 핵심
             seats(held_until)        ← 만료 좌석 회수
```

---

### Redis — Sorted Set 대기열

**파일:** `apps/core-api/src/redis/queue.py`

**왜 사용했는가**
티켓팅 오픈 순간 수천 명이 동시에 접속하면 모두 DB에 바로 도달하면 서버가 다운된다. Redis Sorted Set은 메모리 기반이라 초당 수만 건의 ZADD/ZRANK를 처리할 수 있다. score에 타임스탬프를 넣으면 별도 정렬 없이 FIFO 순서가 보장되고, ZRANK 한 번으로 O(log N) 만에 현재 순번을 반환한다.

Redis Sorted Set을 FIFO 큐로 활용. score에 `time.time()` 타임스탬프를 저장해 먼저 들어온 순서를 보장한다.

```python
# 대기열 추가 — score = 입장 시각
r.zadd("queue:evt-123", {"user-1": 1716100000.0})
r.expire("queue:evt-123", 3600)  # 1시간 TTL

# 순번 조회 — ZRANK는 0-based이므로 +1
rank = r.zrank("queue:evt-123", "user-1")  # → 0
position = rank + 1                         # → 1 (1번)

# 전체 대기 인원
total = r.zcard("queue:evt-123")
```

### Sorted Set 대기열 시각화

```
사용자 A (t=1000)  →  ZADD queue:evt-123  1000  "user-A"
사용자 B (t=1001)  →  ZADD queue:evt-123  1001  "user-B"
사용자 C (t=1002)  →  ZADD queue:evt-123  1002  "user-C"

Redis Sorted Set (score = 입장 시각):
┌────────────────────────────────────────┐
│  score  │  member                      │
│─────────┼──────────────────────────────│
│  1000   │  user-A  ← position 1 (선두) │
│  1001   │  user-B  ← position 2        │
│  1002   │  user-C  ← position 3        │
└────────────────────────────────────────┘

ZRANK user-A → 0  →  position = 0 + 1 = 1
ZCARD         → 3  →  total = 3

consume_token() (Lua 스크립트, 원자적):
  ZRANK user-A == 0? → YES → ZREM user-A → access_token 발급
  ZRANK user-B == 0? → NO  → 아직 대기 중
```

---

### Lua 스크립트 — 원자적 consume

**파일:** `apps/core-api/src/redis/queue.py` (함수: `consume_from_queue_atomic`)

**왜 사용했는가**
ZRANK로 순번을 확인한 뒤 ZREM으로 제거하는 두 명령 사이에 다른 요청이 끼어들면 같은 position=1 사용자가 두 번 consume될 수 있다. Python 코드 레벨에서는 이 타이밍을 막을 수 없다. Redis는 Lua 스크립트를 단일 명령으로 실행하므로 ZRANK+ZREM 사이에 어떤 명령도 끼어들 수 없어 "한 명만 통과"를 원자적으로 보장한다.

`position=1`인 사용자만 ZREM하는 ZRANK 확인 + ZREM을 하나의 Lua 스크립트로 묶어 원자성을 보장한다. 두 요청이 동시에 consume을 시도해도 한 명만 성공한다.

```python
lua_script = """
local key = KEYS[1]
local user_id = ARGV[1]
local rank = redis.call('ZRANK', key, user_id)
if rank == 0 then          -- rank=0 → position=1
  redis.call('ZREM', key, user_id)
  return 1                 -- 성공
end
return 0                   -- 실패 (순번 아님 or 이미 소비됨)
"""
result = r.eval(lua_script, 1, key, user_id)  # → 1 또는 0
```

- Lua 스크립트는 Redis에서 단일 명령처럼 실행되어 **중간에 다른 명령이 끼어들 수 없음**
- ZRANK가 0이 아닌 사용자는 ZREM 없이 0을 반환 → access_token 발급 불가

---

### JWT — 2단계 토큰

**파일:** `apps/core-api/src/auth/token.py`

**왜 사용했는가**
"대기열을 거치지 않고 직접 예매 API를 호출"하는 것을 막아야 한다. 단순 세션 방식은 서버가 상태를 저장해야 하고 수평 확장 시 세션 동기화 문제가 생긴다. JWT는 서버 상태 없이 서명만으로 검증 가능하다. `type` 클레임을 queue/access로 구분해 대기 완료 전에는 예매 API에 접근 자체를 차단한다.

대기 중엔 `queue_token`, 대기 완료 후엔 `access_token`을 발급하는 2단계 구조다.

```python
# 대기 단계 토큰 — type: "queue"
payload = {
  "sub": user_id, "event_id": event_id,
  "position": position, "type": "queue", "exp": expire
}
jwt.encode(payload, settings.secret_key, algorithm="HS256")

# 예매 허가 토큰 — type: "access"
payload = {
  "sub": user_id, "event_id": event_id,
  "type": "access", "exp": expire
}
```

### 2단계 토큰 흐름

```
[대기열 진입]                   [대기 완료]              [예매]
     │                               │                      │
     ▼                               ▼                      ▼
POST /api/queue/join       consume_token() 성공      POST /api/v1/reservations
     │                               │               (Authorization: Bearer <token>)
     ▼                               ▼                      │
queue_token 발급             access_token 발급               ▼
{                           {                        type == "access" 검증
  type: "queue",              type: "access",              │
  position: 3,                event_id: "evt-123",    ✅ 통과 → 예매 진행
  exp: +30min                 exp: +60min             ❌ queue_token → 403 Forbidden
}                           }
     │
     ▼
GET /api/queue/status
(queue_token 전용)
```

- `/api/queue/status`는 `queue_token`만 허용
- `/api/v1/reservations`는 `access_token`만 허용 → 대기열을 통과하지 않으면 예매 불가
- `decode_token()`에서 만료/변조 시 `JWTError` → `ValueError`로 변환해 403 반환

---

### Rate Limiting — 슬라이딩 윈도우 (Redis 기반)

**파일:** `apps/core-api/src/middleware/rate_limiter.py`

**왜 사용했는가**
티켓팅 봇은 짧은 시간에 수백 번 요청을 보내 대기열 앞자리를 독점한다. 이를 막으려면 요청 빈도를 제한해야 한다. Redis INCR은 원자적이라 분산 환경에서도 카운트가 정확하다. 로컬 메모리 방식은 Pod가 여러 개일 때 각자 카운트해서 제한이 무력화되지만, Redis를 공유 카운터로 쓰면 전체 Pod를 합산한 정확한 제한이 가능하다.

`time.time() / window_seconds`를 정수로 버려 현재 시간 버킷을 만들고, 버킷 단위로 INCR을 카운트한다.

```python
bucket = int(time.time() / window_seconds)   # 현재 1초 버킷
rate_key = f"rate:{user_id}:{path}:{bucket}" # 예: rate:u1:/api/queue/join:1716100000

current = r.incr(rate_key)      # 카운트 증가
if current == 1:
  r.expire(rate_key, window_seconds * 2)  # 최초 생성 시 TTL 설정

if current > max_requests:
  return 429 Too Many Requests  # retry_after 포함
```

### 슬라이딩 윈도우 시각화

```
시각    0s   1s   2s   3s   4s
        │    │    │    │    │
user-A  ■    ■    ·    ■    ·    (1 req/sec 제한)
          └── 버킷 키: rate:user-A:/api/queue/join:1716100
                 Redis INCR → 2 → 429 Too Many Requests

정상 흐름:
  bucket = int(time.time() / 1)    # 현재 1초 버킷
  count  = r.incr(rate_key)        # 원자적 증가
  if count == 1: r.expire(rate_key, 2)
  if count > 1:  return 429

제한 기준:
  /api/queue/join  → user_id 기준 1 req/sec  (봇 방어)
  그 외 API        → IP 기준 10 req/sec
```

| 엔드포인트 | 기준 | 제한 |
|-----------|------|------|
| `/api/queue/join` | user_id | 1 req/sec |
| 그 외 | IP | 10 req/sec |

- `/api/queue/join`은 IP가 아닌 **user_id 기준** → 동일 사용자가 프록시를 바꿔도 차단
- Redis 키에 TTL `window * 2`를 설정해 버킷이 넘어가면 자동 삭제

---

### CI/CD 파이프라인

**파일:** `.github/workflows/ci-core-api.yml`

**왜 사용했는가**
코드 변경 후 배포까지 모든 과정을 자동화해야 인간 실수를 줄인다. lint는 코드 스타일 위반을 조기에 잡고, test는 예약/결제처럼 돈이 오가는 로직의 버그를 방지한다. lint/test 실패 시 Docker 빌드를 스킵하면 잘못된 이미지가 배포되는 것을 막는다. GHA 캐시를 쓰면 매 배포마다 dependencies를 다시 다운받지 않아 빌드 시간이 단축된다.

`apps/core-api/` 경로 변경 시에만 트리거되는 3단계 파이프라인:

```
push / PR (main, develop)
        │
        ▼
  ┌─── lint ───────────────────────────────────────┐
  │  flake8 src/ --max-line-length=100             │
  └────────────────────────────────────────────────┘
        │
        ▼
  ┌─── test ───────────────────────────────────────┐
  │  pytest tests/ -v --tb=short                  │
  └────────────────────────────────────────────────┘
        │  (lint + test 모두 성공 시)
        ▼
  ┌─── build ──────────────────────────────────────┐
  │  docker build (push: false, GHA 캐시 활용)     │
  └────────────────────────────────────────────────┘
```

- `needs: [lint, test]` → lint 또는 test 실패 시 Docker 빌드 스킵
- `cache-from: type=gha` → GitHub Actions 레이어 캐시로 빌드 속도 단축
- `paths` 필터 → core-api 외 파일 수정 시 불필요한 파이프라인 실행 방지

---

## 검증 세부사항

**파일:** `apps/core-api/tests/test_queue.py` — 총 11개 테스트, 3개 클래스

**왜 이렇게 검증했는가**
Redis, JWT, Rate Limiting은 외부 의존성이다. 실제 Redis 서버를 매번 띄우면 테스트가 느리고, 환경 문제에 취약하다. Mock Redis를 쓰면 외부 의존성 없이 Python 로직만 검증 가능하고, CI에서도 즉시 실행된다. TestClient로 HTTP 레벨 테스트도 함께 해서 API 계층의 버그(헤더 검증, 응답 형식 등)도 잡는다.

### 테스트 구조

```
TestQueueService (7개)          — 비즈니스 로직 단위 테스트
  ├─ test_join_queue_new_user       ZADD 호출 확인, position=1 반환
  ├─ test_join_queue_existing_user  이미 있는 사용자 → ZADD 미호출, 현재 순번 반환
  ├─ test_get_position_exists       ZRANK 반환값 +1 변환 확인
  ├─ test_get_position_not_exists   대기열 없는 사용자 → None
  ├─ test_leave_queue               ZREM 호출 확인
  ├─ test_consume_token_when_position_1    Lua eval=1 → access_token 반환
  └─ test_consume_token_already_consumed  Lua eval=0 → None 반환

TestQueueAPI (4개)              — HTTP 엔드포인트 통합 테스트
  ├─ test_post_join_success           200, position=1, queue_token 포함
  ├─ test_post_join_rate_limit_exceeded  incr=2 → 429, retry_after 포함
  ├─ test_get_status_without_auth     토큰 없이 /status → 401
  └─ test_get_status_with_valid_queue_token  유효 토큰 → 200, position/total 확인
  └─ test_get_status_user_mismatch    토큰 sub ≠ query user_id → 403

TestTokenAuth (3개)             — JWT 인코딩/디코딩 단위 테스트
  ├─ test_create_and_decode_queue_token   sub, event_id, position, type 검증
  ├─ test_create_and_decode_access_token  type="access" 확인
  └─ test_decode_invalid_token_raises     잘못된 토큰 → ValueError 발생
```

### Mock 전략

```python
# Redis를 MagicMock으로 교체 — 실제 Redis 없이 테스트
@pytest.fixture
def mock_redis():
  r = MagicMock()
  r.zadd.return_value = 1
  r.zrank.return_value = None
  return r

# FastAPI TestClient + patch로 HTTP 레벨 테스트
with patch("src.redis.client.redis_client", mock_redis):
  client = TestClient(app)
  response = client.post("/api/queue/join", json={...})
```

- Redis I/O 없이 로직만 검증 → **외부 의존성 없이 CI에서 실행 가능**
- `mock_redis.eval.return_value = 1` → Lua 스크립트 성공/실패 시나리오 시뮬레이션
- `mock_redis.incr.return_value = 2` → Rate Limit 초과 시나리오 시뮬레이션
