from sqlalchemy.orm import Session
from sqlalchemy import desc
import uuid

from src.models.event import Event


class EventRepository:
  def __init__(self, db: Session):
    self.db = db

  def get_all(self, page: int = 1, limit: int = 20) -> tuple[list[Event], int]:
    """모든 이벤트 조회 (페이지네이션)"""
    query = self.db.query(Event).order_by(desc(Event.start_at))
    total = query.count()
    events = query.offset((page - 1) * limit).limit(limit).all()
    return events, total

  def get_by_id(self, event_id: uuid.UUID) -> Event | None:
    """이벤트 단건 조회"""
    return self.db.query(Event).filter(Event.event_id == event_id).first()
