from datetime import datetime
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import and_
import uuid

from src.models.reservation import Reservation
from src.models.seat import Seat


class ReservationRepository:
  def __init__(self, db: Session):
    self.db = db

  def create(
    self,
    user_id: uuid.UUID,
    event_id: uuid.UUID,
    seat_ids: List[str],
    expires_at: datetime,
  ) -> Reservation:
    """예약 생성 (status=held). flush만: 트랜잭션 내 다른 작업과 묶기 위해"""
    reservation = Reservation(
      user_id=user_id,
      event_id=event_id,
      seat_ids=seat_ids,
      status="held",
      expires_at=expires_at,
    )
    self.db.add(reservation)
    self.db.flush()
    return reservation

  def get_by_id(self, reservation_id: uuid.UUID) -> Optional[Reservation]:
    return (
      self.db.query(Reservation)
      .filter(Reservation.reservation_id == reservation_id)
      .first()
    )

  def get_by_user(self, user_id: uuid.UUID) -> List[Reservation]:
    return (
      self.db.query(Reservation)
      .filter(Reservation.user_id == user_id)
      .order_by(Reservation.created_at.desc())
      .all()
    )

  def get_held_by_user_and_event(
    self, user_id: uuid.UUID, event_id: uuid.UUID
  ) -> Optional[Reservation]:
    """double-check: 동일 사용자가 동일 이벤트에 held 예약이 있는지"""
    return (
      self.db.query(Reservation)
      .filter(
        and_(
          Reservation.user_id == user_id,
          Reservation.event_id == event_id,
          Reservation.status == "held",
        )
      )
      .first()
    )

  def update_status(self, reservation_id: uuid.UUID, status: str) -> Optional[Reservation]:
    reservation = self.get_by_id(reservation_id)
    if reservation:
      reservation.status = status
      self.db.flush()
    return reservation

  def commit(self):
    self.db.commit()

  def rollback(self):
    self.db.rollback()
