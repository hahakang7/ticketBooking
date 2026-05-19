import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import Column, String, DateTime, ForeignKey, Index, Enum, Numeric
from sqlalchemy.dialects.postgresql import UUID

from src.database.db import Base


class Payment(Base):
  __tablename__ = "payments"

  payment_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
  reservation_id = Column(UUID(as_uuid=True), ForeignKey("reservations.reservation_id"), nullable=False)
  user_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id"), nullable=False)
  amount = Column(Numeric(10, 2), nullable=False)
  status = Column(
    Enum("pending", "completed", "failed", name="payment_status"),
    default="pending",
    nullable=False
  )
  payment_method = Column(String(50), nullable=False)  # card, bank_transfer
  created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

  __table_args__ = (
    Index("idx_payments_reservation", "reservation_id"),
  )
