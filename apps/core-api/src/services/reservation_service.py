import uuid
import logging
from datetime import datetime, timedelta
from decimal import Decimal
from typing import List
import json
import time

import redis as redis_lib
from sqlalchemy.orm import Session
from sqlalchemy import and_

from src.metrics import duplicate_reservation_total, reservation_duration_seconds
from src.models.seat import Seat
from src.models.reservation import Reservation
from src.redis.lock import reservation_lock, LockAcquireError
from src.redis.constants import SEAT_HOLD_KEY, SEAT_HOLD_TTL, CACHE_SEATS_KEY
from src.repositories.reservation_repository import ReservationRepository
from src.repositories.seat_repository import SeatRepository
from src.schemas.reservation_schema import ReservationResponse
from src.exceptions.custom_exceptions import (
  SeatNotAvailableError,
  DuplicateReservationError,
  ReservationNotFoundError,
)

logger = logging.getLogger("core-api")

RESERVATION_HOLD_MINUTES = 5    # Reservation.expires_at


class ReservationService:
  def __init__(self, db: Session, r: redis_lib.Redis):
    self.db = db
    self.r = r
    self.reservation_repo = ReservationRepository(db)
    self.seat_repo = SeatRepository(db)

  def hold_seats(
    self, user_id: str, event_id: str, seat_ids: List[uuid.UUID]
  ) -> ReservationResponse:
    """
    1. Redis 분산 락 획득 (event_id 단위)
    2. DB double-check: 동일 사용자의 held 예약 존재 여부
    3. SELECT FOR UPDATE: 좌석 상태 원자적 검증
    4. Seat.status = hold, held_by, held_until 설정
    5. Reservation 생성 (flush)
    6. Redis SEAT_HOLD_KEY 설정 (TTL 300s)
    7. DB commit
    8. Pub/Sub 발행
    9. 락 해제
    """
    user_uuid = uuid.UUID(user_id)
    event_uuid = uuid.UUID(event_id)
    _start = time.perf_counter()

    with reservation_lock(self.r, event_id):
      # --- DB 레벨 double-check ---
      existing = self.reservation_repo.get_held_by_user_and_event(
        user_uuid, event_uuid
      )
      if existing:
        duplicate_reservation_total.inc()
        raise DuplicateReservationError(
          f"User {user_id} already has a held reservation for event {event_id}"
        )

      # --- SELECT FOR UPDATE (비관적 락) ---
      seats = (
        self.db.query(Seat)
        .filter(
          and_(
            Seat.seat_id.in_(seat_ids),
            Seat.event_id == event_uuid,
          )
        )
        .with_for_update()   # row-level lock
        .all()
      )

      # 요청 좌석 수 검증
      if len(seats) != len(seat_ids):
        raise SeatNotAvailableError("One or more seats not found")

      # 모든 좌석이 available인지 확인
      unavailable = [s for s in seats if s.status != "available"]
      if unavailable:
        ids = [str(s.seat_id) for s in unavailable]
        raise SeatNotAvailableError(f"Seats already taken: {ids}")

      # --- 좌석 상태 변경 (hold) ---
      now = datetime.utcnow()
      hold_until = now + timedelta(minutes=RESERVATION_HOLD_MINUTES)
      for seat in seats:
        seat.status = "hold"
        seat.held_by = user_uuid
        seat.held_until = hold_until
        self.db.add(seat)

      # --- 예약 생성 ---
      reservation = self.reservation_repo.create(
        user_id=user_uuid,
        event_id=event_uuid,
        seat_ids=[str(s.seat_id) for s in seats],
        expires_at=hold_until,
      )

      # --- Redis 좌석 hold 키 설정 ---
      pipe = self.r.pipeline()
      for seat in seats:
        pipe.set(
          SEAT_HOLD_KEY(event_id, str(seat.seat_id)),
          user_id,
          ex=SEAT_HOLD_TTL,
        )
      pipe.execute()

      # --- DB commit (좌석 변경 + 예약 생성 한 번에) ---
      self.reservation_repo.commit()

      # --- Pub/Sub 발행 ---
      self._publish_seat_update(event_id, seats, "hold")

    # 총 금액 계산
    total_price = sum(s.price for s in seats)
    reservation_duration_seconds.observe(time.perf_counter() - _start)
    return self._to_response(reservation, total_price)

  def cancel_reservation(
    self, reservation_id: uuid.UUID, user_id: str
  ) -> ReservationResponse:
    reservation = self.reservation_repo.get_by_id(reservation_id)
    if not reservation:
      raise ReservationNotFoundError(f"Reservation {reservation_id} not found")
    if str(reservation.user_id) != user_id:
      raise ReservationNotFoundError("Not your reservation")
    if reservation.status != "held":
      raise SeatNotAvailableError(f"Cannot cancel reservation in status: {reservation.status}")

    event_id = str(reservation.event_id)

    with reservation_lock(self.r, event_id):
      seats = (
        self.db.query(Seat)
        .filter(Seat.seat_id.in_([uuid.UUID(sid) for sid in reservation.seat_ids]))
        .with_for_update()
        .all()
      )
      for seat in seats:
        seat.status = "available"
        seat.held_by = None
        seat.held_until = None
        self.db.add(seat)

      self.reservation_repo.update_status(reservation_id, "cancelled")
      self.reservation_repo.commit()

      # Redis hold 키 삭제
      pipe = self.r.pipeline()
      for seat in seats:
        pipe.delete(SEAT_HOLD_KEY(event_id, str(seat.seat_id)))
      pipe.execute()

      self._publish_seat_update(event_id, seats, "available")

    total_price = sum(s.price for s in seats)
    return self._to_response(reservation, total_price)

  def get_reservation(self, reservation_id: uuid.UUID, user_id: str) -> ReservationResponse:
    reservation = self.reservation_repo.get_by_id(reservation_id)
    if not reservation or str(reservation.user_id) != user_id:
      raise ReservationNotFoundError(f"Reservation {reservation_id} not found")
    seats = self.db.query(Seat).filter(
      Seat.seat_id.in_([uuid.UUID(s) for s in reservation.seat_ids])
    ).all()
    total_price = sum(s.price for s in seats)
    return self._to_response(reservation, total_price)

  def complete_reservation(self, reservation_id: uuid.UUID) -> Reservation:
    """결제 완료 후 reservation status = completed, seat status = sold"""
    reservation = self.reservation_repo.get_by_id(reservation_id)
    if not reservation or reservation.status != "held":
      raise ReservationNotFoundError("Held reservation not found")

    event_id = str(reservation.event_id)
    with reservation_lock(self.r, event_id):
      seats = (
        self.db.query(Seat)
        .filter(Seat.seat_id.in_([uuid.UUID(s) for s in reservation.seat_ids]))
        .with_for_update()
        .all()
      )
      for seat in seats:
        seat.status = "sold"
        seat.held_by = None
        seat.held_until = None
        self.db.add(seat)

      self.reservation_repo.update_status(reservation_id, "completed")
      self.reservation_repo.commit()

      # Redis hold 키 삭제
      pipe = self.r.pipeline()
      for seat in seats:
        pipe.delete(SEAT_HOLD_KEY(event_id, str(seat.seat_id)))
      pipe.execute()

      self._publish_seat_update(event_id, seats, "sold")

    return reservation

  def release_expired_holds(self) -> int:
    """
    만료된 held 예약을 일괄 해제한다. (백그라운드 정리 작업에서 주기적으로 호출)
    - expires_at < NOW() 인 held 예약을 찾아 좌석을 available 로 되돌린다.
    - 각 예약마다 분산 락을 획득해 결제 완료 처리와의 경합을 방지한다.
    """
    expired = self.reservation_repo.get_expired_held()
    if not expired:
      return 0

    released_count = 0
    for reservation in expired:
      event_id = str(reservation.event_id)
      try:
        with reservation_lock(self.r, event_id):
          # 락 획득 후 재조회 — 그 사이 결제 완료됐을 수 있음
          fresh = self.reservation_repo.get_by_id(reservation.reservation_id)
          if not fresh or fresh.status != "held":
            continue

          seats = (
            self.db.query(Seat)
            .filter(Seat.seat_id.in_([uuid.UUID(sid) for sid in fresh.seat_ids]))
            .with_for_update()
            .all()
          )
          for seat in seats:
            seat.status = "available"
            seat.held_by = None
            seat.held_until = None
            self.db.add(seat)

          self.reservation_repo.update_status(fresh.reservation_id, "cancelled")
          self.reservation_repo.commit()

          pipe = self.r.pipeline()
          for seat in seats:
            pipe.delete(SEAT_HOLD_KEY(event_id, str(seat.seat_id)))
          pipe.execute()

          self._publish_seat_update(event_id, seats, "available")
          released_count += len(seats)
          logger.info(f"Expired reservation {fresh.reservation_id}: released {len(seats)} seats")
      except Exception as e:
        logger.error(f"Failed to release reservation {reservation.reservation_id}: {e}")
        try:
          self.reservation_repo.rollback()
        except Exception:
          pass

    return released_count

  def release_user_holds(self, user_id: str) -> int:
    """
    특정 유저의 모든 held 예약을 해제한다.
    (WebSocket 연결 해제 후 유예 시간이 지났을 때 호출)
    """
    user_uuid = uuid.UUID(user_id)
    reservations = self.reservation_repo.get_held_by_user(user_uuid)
    if not reservations:
      return 0

    released_count = 0
    for reservation in reservations:
      event_id = str(reservation.event_id)
      try:
        with reservation_lock(self.r, event_id):
          fresh = self.reservation_repo.get_by_id(reservation.reservation_id)
          if not fresh or fresh.status != "held":
            continue

          seats = (
            self.db.query(Seat)
            .filter(Seat.seat_id.in_([uuid.UUID(sid) for sid in fresh.seat_ids]))
            .with_for_update()
            .all()
          )
          for seat in seats:
            seat.status = "available"
            seat.held_by = None
            seat.held_until = None
            self.db.add(seat)

          self.reservation_repo.update_status(fresh.reservation_id, "cancelled")
          self.reservation_repo.commit()

          pipe = self.r.pipeline()
          for seat in seats:
            pipe.delete(SEAT_HOLD_KEY(event_id, str(seat.seat_id)))
          pipe.execute()

          self._publish_seat_update(event_id, seats, "available")
          released_count += len(seats)
          logger.info(f"Disconnected user {user_id}: released {len(seats)} seats")
      except Exception as e:
        logger.error(f"Failed to release holds for user {user_id}: {e}")
        try:
          self.reservation_repo.rollback()
        except Exception:
          pass

    return released_count

  def _publish_seat_update(self, event_id: str, seats: list, new_status: str):
    channel = f"seat_updates:{event_id}"
    message = json.dumps({
      "event_id": event_id,
      "seats": [
        {"seat_id": str(s.seat_id), "status": new_status}
        for s in seats
      ],
      "timestamp": datetime.utcnow().isoformat(),
    })
    try:
      # 좌석 상태 변경 시 캐시 즉시 무효화
      pipe = self.r.pipeline()
      pipe.delete(CACHE_SEATS_KEY(event_id))
      pipe.publish(channel, message)
      pipe.execute()
    except Exception as e:
      # Pub/Sub 실패는 예약 실패로 이어지지 않음 (best-effort)
      logger.warning(f"Pub/Sub publish failed: {e}")

  def _to_response(self, reservation: Reservation, total_price: Decimal) -> ReservationResponse:
    return ReservationResponse(
      reservation_id=reservation.reservation_id,
      user_id=reservation.user_id,
      event_id=reservation.event_id,
      seat_ids=reservation.seat_ids,
      status=reservation.status,
      created_at=reservation.created_at,
      expires_at=reservation.expires_at,
      total_price=total_price,
    )
