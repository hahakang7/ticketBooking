import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, Index
from sqlalchemy.dialects.postgresql import UUID

from src.database.db import Base


class User(Base):
  __tablename__ = "users"

  user_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
  email = Column(String(255), unique=True, nullable=False)
  hashed_password = Column(String(255), nullable=False)
  name = Column(String(255), nullable=False)
  phone = Column(String(20), nullable=True)
  created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

  __table_args__ = (
    Index("idx_users_email", "email"),
  )
