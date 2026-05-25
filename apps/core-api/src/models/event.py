import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, Integer, Index, Text
from sqlalchemy.dialects.postgresql import UUID

from src.database.db import Base


class Event(Base):
  __tablename__ = "events"

  event_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
  name = Column(String(255), nullable=False)
  description = Column(Text, nullable=True)
  location = Column(String(255), nullable=False)
  start_at = Column(DateTime(timezone=True), nullable=False)
  end_at = Column(DateTime(timezone=True), nullable=False)
  total_seats = Column(Integer, nullable=False)
  available_seats = Column(Integer, nullable=False)
  created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

  __table_args__ = (
    Index("idx_events_start_at", "start_at"),
  )
