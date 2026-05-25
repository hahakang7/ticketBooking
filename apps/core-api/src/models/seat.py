import uuid
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import Column, String, DateTime, Integer, ForeignKey, Index, Enum, Numeric, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from src.database.db import Base


class Seat(Base):
  __tablename__ = "seats"

  seat_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
  event_id = Column(UUID(as_uuid=True), ForeignKey("events.event_id"), nullable=False)
  section = Column(String(50), nullable=False)
  row = Column(String(5), nullable=False)
  seat_number = Column(Integer, nullable=False)
  status = Column(
    Enum("available", "hold", "sold", name="seat_status"),
    default="available",
    nullable=False
  )
  price = Column(Numeric(10, 2), nullable=False)
  held_by = Column(UUID(as_uuid=True), nullable=True)
  held_until = Column(DateTime(timezone=True), nullable=True)

  __table_args__ = (
    UniqueConstraint("event_id", "section", "row", "seat_number", name="uq_seats_event_section_row_number"),
    Index("idx_seats_event_status", "event_id", "status"),
    Index("idx_seats_held_until", "held_until"),
  )
