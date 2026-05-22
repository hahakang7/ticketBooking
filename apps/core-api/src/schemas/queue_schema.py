from typing import Optional
from pydantic import BaseModel


class QueueJoinRequest(BaseModel):
  user_id: str
  event_id: str


class QueueJoinResponse(BaseModel):
  position: int
  queue_token: str
  total: int


class QueueStatusResponse(BaseModel):
  position: Optional[int]
  total: int
  is_in_queue: bool


class QueueConsumeResponse(BaseModel):
  access_token: str
  user_id: str
  event_id: str
