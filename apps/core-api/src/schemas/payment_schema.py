from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel
from enum import Enum
import uuid


class PaymentMethod(str, Enum):
  CARD = "card"
  BANK_TRANSFER = "bank_transfer"


class PaymentStatus(str, Enum):
  PENDING = "pending"
  COMPLETED = "completed"
  FAILED = "failed"


# --- Request ---

class ProcessPaymentRequest(BaseModel):
  """결제 처리 요청"""
  reservation_id: uuid.UUID
  payment_method: PaymentMethod
  amount: Decimal             # 클라이언트가 전달, 서버에서 검증


# --- Response ---

class PaymentResponse(BaseModel):
  payment_id: uuid.UUID
  reservation_id: uuid.UUID
  user_id: uuid.UUID
  amount: Decimal
  status: PaymentStatus
  payment_method: str
  created_at: datetime

  class Config:
    from_attributes = True
