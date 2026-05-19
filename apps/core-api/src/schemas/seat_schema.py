from typing import List
from pydantic import BaseModel
from enum import Enum
import uuid
from decimal import Decimal


class SeatStatus(str, Enum):
  """좌석 상태"""
  AVAILABLE = "available"
  HOLD = "hold"
  SOLD = "sold"


class SeatResponse(BaseModel):
  """좌석 응답 DTO"""
  seat_id: uuid.UUID
  event_id: uuid.UUID
  section: str
  row: str
  seat_number: int
  status: SeatStatus
  price: Decimal

  class Config:
    from_attributes = True


class SeatListResponse(BaseModel):
  """좌석 목록 응답"""
  items: List[SeatResponse]
  total: int
