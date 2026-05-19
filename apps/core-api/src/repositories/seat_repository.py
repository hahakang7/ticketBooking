from sqlalchemy.orm import Session
from sqlalchemy import and_
import uuid

from src.models.seat import Seat


class SeatRepository:
  def __init__(self, db: Session):
    self.db = db

  def get_by_event_id(self, event_id: uuid.UUID) -> list[Seat]:
    """이벤트의 모든 좌석 조회"""
    return self.db.query(Seat).filter(Seat.event_id == event_id).all()

  def get_by_id(self, seat_id: uuid.UUID) -> Seat | None:
    """좌석 단건 조회"""
    return self.db.query(Seat).filter(Seat.seat_id == seat_id).first()

  def get_available_seats(self, event_id: uuid.UUID) -> list[Seat]:
    """이벤트의 이용 가능한 좌석 조회"""
    return self.db.query(Seat).filter(
      and_(
        Seat.event_id == event_id,
        Seat.status == "available"
      )
    ).all()

  def update_seat_status(self, seat_id: uuid.UUID, status: str):
    """좌석 상태 업데이트"""
    seat = self.get_by_id(seat_id)
    if seat:
      seat.status = status
      self.db.add(seat)
      self.db.commit()
      return seat
    return None
