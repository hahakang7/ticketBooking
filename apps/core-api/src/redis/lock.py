import uuid
import time
import logging
from contextlib import contextmanager
from typing import Optional

import redis as redis_lib

from src.redis.constants import LOCK_RESERVATION_KEY

logger = logging.getLogger("core-api")

# Lua: lock_value가 일치할 때만 DEL → 자신의 락만 해제
RELEASE_SCRIPT = """
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
else
    return 0
end
"""

LOCK_TTL_MS = 10_000   # 10초 (요구사항)


class LockAcquireError(Exception):
  """락 획득 실패"""
  pass


class RedisLock:
  """
  단일 Redis 노드 SETNX 기반 분산 락.
  lock_value는 UUID로 소유자 식별.
  """

  def __init__(self, r: redis_lib.Redis, key: str, ttl_ms: int = LOCK_TTL_MS):
    self.r = r
    self.key = key
    self.ttl_ms = ttl_ms
    self.lock_value: Optional[str] = None
    self._release_script = self.r.register_script(RELEASE_SCRIPT)

  def acquire(self, retry: int = 3, retry_delay_ms: int = 100) -> bool:
    """
    SET key value NX PX ttl_ms.
    retry: 재시도 횟수 (기본 3회)
    retry_delay_ms: 초기 재시도 간격 (ms), 지수 백오프 적용
    반환: 성공 True, 실패 False
    """
    self.lock_value = str(uuid.uuid4())
    current_delay_ms = retry_delay_ms
    for attempt in range(retry):
      result = self.r.set(
        self.key,
        self.lock_value,
        nx=True,
        px=self.ttl_ms
      )
      if result:
        logger.debug(f"Lock acquired: {self.key} (attempt {attempt+1})")
        return True
      if attempt < retry - 1:
        # 지수 백오프: 100ms → 200ms → 400ms
        time.sleep(current_delay_ms / 1000)
        current_delay_ms = min(current_delay_ms * 2, 1000)  # 최대 1초로 제한
    logger.warning(f"Lock acquire failed: {self.key}")
    return False

  def release(self) -> bool:
    """Lua 스크립트로 원자적 해제. lock_value 불일치 시 False."""
    if not self.lock_value:
      return False
    result = self._release_script(keys=[self.key], args=[self.lock_value])
    self.lock_value = None
    return bool(result)

  def is_locked(self) -> bool:
    return self.r.exists(self.key) == 1


def acquire_reservation_lock(
  r: redis_lib.Redis,
  event_id: str,
  retry: int = 3,
  retry_delay_ms: int = 100,
) -> RedisLock:
  """
  예약용 락 헬퍼. LockAcquireError를 raise한다.
  caller는 finally에서 lock.release() 호출.
  """
  key = LOCK_RESERVATION_KEY(event_id)
  lock = RedisLock(r, key)
  if not lock.acquire(retry=retry, retry_delay_ms=retry_delay_ms):
    raise LockAcquireError(f"Cannot acquire reservation lock for event {event_id}")
  return lock


@contextmanager
def reservation_lock(r: redis_lib.Redis, event_id: str, retry: int = 3):
  """
  컨텍스트 매니저 버전:
      with reservation_lock(r, event_id) as lock:
          ...
  LockAcquireError는 그대로 전파.
  """
  lock = acquire_reservation_lock(r, event_id, retry=retry)
  try:
    yield lock
  finally:
    lock.release()
