from datetime import datetime
from typing import List
from decimal import Decimal
from pydantic import BaseModel, field_validator
from enum import Enum
import uuid


class ReservationStatus(str, Enum):
  HELD = "held"
  COMPLETED = "completed"
  CANCELLED = "cancelled"


# --- Request ---

class HoldSeatsRequest(BaseModel):
  """좌석 hold 요청 (access_token은 Authorization 헤더)"""
  seat_ids: List[uuid.UUID]

  @field_validator("seat_ids")
  @classmethod
  def validate_seat_count(cls, v):
    if len(v) == 0:
      raise ValueError("At least one seat required")
    if len(v) > 4:
      raise ValueError("Cannot hold more than 4 seats at once")
    return v


class ConfirmReservationRequest(BaseModel):
  """예약 확정 요청 (결제 완료 후 상태 변경)"""
  reservation_id: uuid.UUID


# --- Response ---

class ReservationResponse(BaseModel):
  reservation_id: uuid.UUID
  user_id: uuid.UUID
  event_id: uuid.UUID
  seat_ids: List[str]         # JSON 컬럼 → List[str] 그대로
  status: ReservationStatus
  created_at: datetime
  expires_at: datetime
  total_price: Decimal        # service 계산 값, 모델 컬럼 없음

  class Config:
    from_attributes = True


class ReservationListResponse(BaseModel):
  items: List[ReservationResponse]
  total: int
