import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, Index, Enum, JSON
from sqlalchemy.dialects.postgresql import UUID

from src.database.db import Base


class Reservation(Base):
  __tablename__ = "reservations"

  reservation_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
  user_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id"), nullable=False)
  event_id = Column(UUID(as_uuid=True), ForeignKey("events.event_id"), nullable=False)
  seat_ids = Column(JSON, nullable=False)  # [seat_id1, seat_id2, ...]
  status = Column(
    Enum("held", "completed", "cancelled", name="reservation_status"),
    default="held",
    nullable=False
  )
  created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
  expires_at = Column(DateTime, nullable=False)  # 예약 만료 시간

  __table_args__ = (
    # 사용자 예약 조회
    Index("idx_reservations_user_created", "user_id", "created_at"),
  )
