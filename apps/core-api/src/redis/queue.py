import time
from typing import Optional

import redis as redis_lib

from src.redis.constants import QUEUE_KEY, QUEUE_TTL


def add_to_queue(r: redis_lib.Redis, event_id: str, user_id: str, timestamp: Optional[float] = None) -> None:
  """대기열 추가 (ZADD + EXPIRE)"""
  score = timestamp if timestamp is not None else time.time()
  key = QUEUE_KEY(event_id)
  r.zadd(key, {user_id: score})
  r.expire(key, QUEUE_TTL)


def get_position(r: redis_lib.Redis, event_id: str, user_id: str) -> Optional[int]:
  """현재 대기 순번 반환 (1-based). 없으면 None."""
  rank = r.zrank(QUEUE_KEY(event_id), user_id)
  if rank is None:
    return None
  return rank + 1


def get_queue_size(r: redis_lib.Redis, event_id: str) -> int:
  """대기열 전체 인원 수"""
  return r.zcard(QUEUE_KEY(event_id))


def remove_from_queue(r: redis_lib.Redis, event_id: str, user_id: str) -> int:
  """대기열에서 제거. 제거된 항목 수(0 or 1) 반환."""
  return r.zrem(QUEUE_KEY(event_id), user_id)
