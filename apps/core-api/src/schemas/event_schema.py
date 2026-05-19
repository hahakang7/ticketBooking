from datetime import datetime
from typing import List
from pydantic import BaseModel
import uuid


class EventResponse(BaseModel):
  """이벤트 응답 DTO"""
  event_id: uuid.UUID
  name: str
  description: str | None
  location: str
  start_at: datetime
  end_at: datetime
  total_seats: int
  available_seats: int

  class Config:
    from_attributes = True


class EventListResponse(BaseModel):
  """이벤트 목록 응답"""
  items: List[EventResponse]
  total: int
  page: int
  limit: int
