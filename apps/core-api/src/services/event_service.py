from sqlalchemy.orm import Session
import uuid

from src.repositories.event_repository import EventRepository
from src.repositories.seat_repository import SeatRepository
from src.schemas.event_schema import EventResponse, EventListResponse
from src.schemas.seat_schema import SeatResponse, SeatListResponse


class EventService:
  def __init__(self, db: Session):
    self.db = db
    self.event_repo = EventRepository(db)
    self.seat_repo = SeatRepository(db)

  def get_events(self, page: int = 1, limit: int = 20) -> EventListResponse:
    """이벤트 목록 조회"""
    events, total = self.event_repo.get_all(page, limit)
    items = [EventResponse.from_orm(event) for event in events]
    return EventListResponse(items=items, total=total, page=page, limit=limit)

  def get_event_by_id(self, event_id: uuid.UUID) -> EventResponse | None:
    """이벤트 단건 조회"""
    event = self.event_repo.get_by_id(event_id)
    if event:
      return EventResponse.from_orm(event)
    return None

  def get_seats_by_event(self, event_id: uuid.UUID) -> SeatListResponse | None:
    """이벤트의 좌석 조회"""
    # 이벤트 존재 여부 확인
    event = self.event_repo.get_by_id(event_id)
    if not event:
      return None

    seats = self.seat_repo.get_by_event_id(event_id)
    items = [SeatResponse.from_orm(seat) for seat in seats]
    return SeatListResponse(items=items, total=len(items))
