from typing import Optional

import redis as redis_lib

from src.redis.queue import add_to_queue, get_position, get_queue_size, remove_from_queue
from src.services.token_service import TokenService


class QueueService:
  def __init__(self, r: redis_lib.Redis):
    self.r = r
    self.token_service = TokenService()

  def join_queue(self, user_id: str, event_id: str) -> dict:
    """
    대기열 참가.
    이미 존재하면 현재 순번 반환 (ZADD 없음).
    신규이면 ZADD 후 순번 반환.
    """
    existing = get_position(self.r, event_id, user_id)
    if existing is not None:
      total = get_queue_size(self.r, event_id)
      token = self.token_service.issue_queue_token(user_id, event_id, existing)
      return {"position": existing, "queue_token": token, "total": total}

    add_to_queue(self.r, event_id, user_id)
    position = get_position(self.r, event_id, user_id)
    total = get_queue_size(self.r, event_id)
    token = self.token_service.issue_queue_token(user_id, event_id, position)
    return {"position": position, "queue_token": token, "total": total}

  def get_position(self, user_id: str, event_id: str) -> Optional[int]:
    return get_position(self.r, event_id, user_id)

  def get_total(self, event_id: str) -> int:
    return get_queue_size(self.r, event_id)

  def leave_queue(self, user_id: str, event_id: str) -> bool:
    return remove_from_queue(self.r, event_id, user_id) > 0

  def consume_token(self, user_id: str, event_id: str) -> Optional[str]:
    """대기 완료: ZREM 후 access_token 발급. 대기열에 없으면 None."""
    position = get_position(self.r, event_id, user_id)
    if position is None:
      return None
    remove_from_queue(self.r, event_id, user_id)
    return self.token_service.issue_access_token(user_id, event_id)
