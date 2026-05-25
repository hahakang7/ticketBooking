# Week 2 코드 개선 사항

**작성일:** 2026-05-25  
**담당자:** 팀원 2 (백엔드)

---

## 📋 개선 개요

Week 2에서 구현된 대기열 시스템의 보안 취약점, 동시성 버그, 코드 품질 문제를 식별하고 개선했습니다.

### 개선 파일 목록
- ✅ config.py
- ✅ auth/token.py
- ✅ redis/queue.py
- ✅ services/queue_service.py
- ✅ dependencies.py
- ✅ api/v1/queue.py
- ✅ middleware/rate_limiter.py
- ✅ tests/test_queue.py

---

## 🔴 Critical 개선사항 (보안)

### 1. `datetime.utcnow()` Deprecated 문제
**파일:** `auth/token.py`

**문제:**
- Python 3.12에서 deprecated, 미래 버전에서 제거 예정
- 런타임 경고 발생 가능

**개선 사항:**
```python
# Before
expire = datetime.utcnow() + timedelta(hours=1)

# After
from datetime import timezone
expire = datetime.now(timezone.utc) + timedelta(hours=settings.queue_token_expiration_hours)
```

**영향:**
- Python 3.12+ 호환성 확보
- 코드 안정성 향상

---

### 2. SSE & Status 엔드포인트 인증 추가
**파일:** `api/v1/queue.py`, `dependencies.py`

**문제:**
- `/api/queue/status`와 `/api/queue/sse` 엔드포인트가 body/query의 `user_id`를 그대로 신뢰
- 누구든 타인의 `user_id`를 입력해 타인의 대기 상태 조회 가능 (프라이버시 침해)

**개선 사항:**
```python
# dependencies.py - 새로운 인증 함수
def get_user_from_queue_token(authorization: str = Header(...)) -> dict:
  """queue_token으로 사용자 인증"""
  # 토큰 검증 및 추출

# api/v1/queue.py - 인증 적용
@router.get("/status")
async def get_queue_status(
  user_id: str = Query(...),
  token_user: dict = Depends(get_user_from_queue_token),  # ← 인증 추가
  ...
):
  if token_user["sub"] != user_id:  # ← user_id 검증
    raise HTTPException(status_code=403)
  ...
```

**영향:**
- 프라이버시 보호
- 타인 대기 상태 조회 불가능
- 인증된 사용자만 접근 가능

---

## 🟡 Medium 개선사항 (동시성/기능)

### 3. SSE 클라이언트 연결 해제 미감지
**파일:** `api/v1/queue.py`

**문제:**
- 클라이언트가 브라우저를 닫아도 서버 SSE 루프가 계속 실행
- 불필요한 Redis 호출과 CPU 낭비

**개선 사항:**
```python
# SSE 이벤트 스트림 내
async def event_stream():
  while True:
    if await request.is_disconnected():  # ← 연결 해제 감지
      break
    
    # ... 나머지 로직 ...
    await asyncio.sleep(2)
```

**영향:**
- 리소스 절감
- 불필요한 Redis 호출 감소
- 서버 성능 향상

---

### 4. `consume_token` 비원자성 (경쟁 조건)
**파일:** `redis/queue.py`, `services/queue_service.py`

**문제:**
- 기존: `get_position` 확인 → `remove_from_queue` 실행 (2단계)
- 두 SSE 탭이 동시에 `position==1` 감지하면 두 개의 `access_token` 발급 가능
- 시스템 무결성 손상

**개선 사항:**

Redis Lua 스크립트로 원자적 처리:
```python
# redis/queue.py - 새로운 함수
def consume_from_queue_atomic(r: redis.Redis, event_id: str, user_id: str) -> bool:
  """원자적으로 position=1인 사용자 제거 (Lua 스크립트 사용)"""
  lua_script = """
  local rank = redis.call('ZRANK', KEYS[1], ARGV[1])
  if rank == 0 then
    redis.call('ZREM', KEYS[1], ARGV[1])
    return 1
  end
  return 0
  """
  result = r.eval(lua_script, 1, key, user_id)
  return result == 1

# services/queue_service.py - 사용
def consume_token(self, user_id: str, event_id: str) -> Optional[str]:
  if not consume_from_queue_atomic(self.r, event_id, user_id):
    return None  # 이미 다른 요청이 consume함
  return self.token_service.issue_access_token(user_id, event_id)
```

**영향:**
- 중복 토큰 발급 불가능
- Race condition 제거
- 시스템 안정성 향상

---

### 5. Rate Limiter 개선
**파일:** `middleware/rate_limiter.py`

**문제:**
1. 매 요청마다 `from src.redis.client import redis_client` 실행 (모듈 로딩 오버헤드)
2. `/api/queue/join` endpoint는 user_id 기반 제한 필요 (IP 공유 시 다른 사용자도 차단됨)

**개선 사항:**
```python
# 모듈 상단에서 redis_client import
from src.redis.client import redis_client

class RateLimiterMiddleware(BaseHTTPMiddleware):
  async def dispatch(self, request: Request, call_next):
    if path == "/api/queue/join":
      # user_id 기반 제한
      limit_response = await self._check_rate_limit_by_user(request, redis_client, path)
    else:
      # IP 기반 제한
      limit_response = await self._check_rate_limit_by_ip(request, redis_client, path)
    
    if limit_response:
      return limit_response
    return await call_next(request)

  async def _check_rate_limit_by_user(self, request: Request, r, path: str):
    # user_id 추출 후 rate_key 생성
    user_id = ... # request body에서 추출
    rate_key = f"rate:{user_id}:{path}:{bucket}"
    ...
```

**영향:**
- Rate limiter 성능 향상 (중복 import 제거)
- 공유 IP 환경에서 다른 사용자 보호
- 더 정확한 rate limiting

---

### 6. Queue Token TTL 설정 표준화
**파일:** `config.py`, `auth/token.py`

**문제:**
- Queue token: 하드코딩된 1시간
- Access token: `settings.jwt_expiration_hours` 참조
- 설정 관리 불일치

**개선 사항:**
```python
# config.py - 새로운 설정값
class Settings(BaseSettings):
  queue_token_expiration_hours: int = 1  # ← 추가

# auth/token.py - 사용
def create_queue_token(...):
  expire = datetime.now(timezone.utc) + timedelta(
    hours=settings.queue_token_expiration_hours  # ← 설정값 참조
  )
```

**영향:**
- 일관된 설정 관리
- TTL 변경 용이
- 코드 유지보수성 향상

---

## 🟢 Low 개선사항 (테스트)

### 7. 테스트 커버리지 확대
**파일:** `tests/test_queue.py`

**추가 테스트 케이스:**

```python
# consume_token 원자성 테스트
def test_consume_token_when_position_1():
  """position=1 소비: Lua eval 호출 및 access_token 반환 (원자성)"""

def test_consume_token_already_consumed():
  """이미 다른 요청이 consume한 경우 → None"""

def test_consume_token_not_position_1():
  """position≠1이면 consume 실패 → None"""

# Rate limiter 테스트
def test_post_join_rate_limit_exceeded():
  """Rate limiting: 1초 내 2번째 요청 → 429"""

# 인증 테스트
def test_get_status_without_auth():
  """queue_token 없이 /status 접근 → 401"""

def test_get_status_with_valid_queue_token():
  """queue_token으로 /status 접근 → 성공"""

def test_get_status_user_mismatch():
  """query user_id와 token user_id 불일치 → 403"""
```

**테스트 결과:**
- 기존 8개 테스트: ✅ PASS
- 신규 8개 테스트: ✅ PASS
- **총 16개 테스트: 100% PASS**

**영향:**
- 코드 품질 향상
- 회귀 테스트 강화
- 버그 조기 발견

---

## 📊 개선 요약

| 구분 | 항목 | 상태 | 영향도 |
|------|------|------|--------|
| 보안 | Python 3.12 호환성 | ✅ 완료 | High |
| 보안 | 엔드포인트 인증 추가 | ✅ 완료 | High |
| 동시성 | consume_token 원자성 | ✅ 완료 | High |
| 기능 | SSE 연결 해제 감지 | ✅ 완료 | Medium |
| 성능 | Rate limiter 최적화 | ✅ 완료 | Medium |
| 유지보수 | 설정 표준화 | ✅ 완료 | Low |
| 품질 | 테스트 커버리지 | ✅ 완료 | Medium |

---

## ✅ 검증 항목

- [x] pytest 16개 테스트 PASS
- [x] flake8 lint 체크
- [x] 타입 힌팅 검증
- [x] 기존 기능 회귀 테스트

---

## 📝 다음 단계

1. Week 3 구현 코드 리뷰 (예약/결제)
2. 통합 테스트 (Queue → Reservation → Payment)
3. Week 4 부하 테스트 (k6)

