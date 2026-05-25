import uuid
import random
import logging
from decimal import Decimal

from sqlalchemy.orm import Session
import redis as redis_lib

from src.models.seat import Seat
from src.repositories.payment_repository import PaymentRepository
from src.repositories.reservation_repository import ReservationRepository
from src.schemas.payment_schema import PaymentResponse
from src.services.reservation_service import ReservationService
from src.exceptions.custom_exceptions import ReservationNotFoundError, BusinessLogicError

logger = logging.getLogger("core-api")


class PaymentAmountMismatchError(BusinessLogicError):
  pass


class PaymentService:
  def __init__(self, db: Session, r: redis_lib.Redis):
    self.db = db
    self.r = r
    self.payment_repo = PaymentRepository(db)
    self.reservation_repo = ReservationRepository(db)
    self.reservation_service = ReservationService(db, r)

  def process_payment(
    self,
    user_id: str,
    reservation_id: uuid.UUID,
    payment_method: str,
    amount: Decimal,
  ) -> PaymentResponse:
    """
    1. 예약 검증 (held 상태인지, 소유자 확인)
    2. 금액 검증 (seat 가격 합산과 비교)
    3. Payment 레코드 생성 (pending)
    4. 외부 PG 시뮬레이션 (성공률 95%)
    5. 성공: reservation.complete_reservation() → payment.status = completed
       실패: payment.status = failed, reservation 유지 (재시도 가능)
    """
    user_uuid = uuid.UUID(user_id)
    reservation = self.reservation_repo.get_by_id(reservation_id)
    if not reservation:
      raise ReservationNotFoundError(f"Reservation {reservation_id} not found")
    if str(reservation.user_id) != user_id:
      raise ReservationNotFoundError("Not your reservation")
    if reservation.status != "held":
      raise BusinessLogicError(f"Reservation not in held status: {reservation.status}")

    # 금액 검증
    seats = self.db.query(Seat).filter(
      Seat.seat_id.in_([uuid.UUID(s) for s in reservation.seat_ids])
    ).all()
    expected_amount = sum(s.price for s in seats)
    if amount != expected_amount:
      raise PaymentAmountMismatchError(
        f"Amount mismatch: expected {expected_amount}, got {amount}"
      )

    # Payment 레코드 생성
    payment = self.payment_repo.create(
      reservation_id=reservation_id,
      user_id=user_uuid,
      amount=amount,
      payment_method=payment_method,
    )
    self.payment_repo.commit()

    # PG 시뮬레이션 (95% 성공)
    pg_success = self._simulate_pg(payment_method, amount)

    if pg_success:
      # 예약 완료 + 좌석 sold 처리
      self.reservation_service.complete_reservation(reservation_id)
      self.payment_repo.update_status(payment.payment_id, "completed")
      self.payment_repo.commit()
      logger.info(f"Payment completed: {payment.payment_id}")
    else:
      self.payment_repo.update_status(payment.payment_id, "failed")
      self.payment_repo.commit()
      raise BusinessLogicError("Payment failed (PG declined). Please retry.")

    return PaymentResponse.model_validate(payment)

  def get_payment(self, payment_id: uuid.UUID, user_id: str) -> PaymentResponse:
    payment = self.payment_repo.get_by_id(payment_id)
    if not payment or str(payment.user_id) != user_id:
      raise ReservationNotFoundError(f"Payment {payment_id} not found")
    return PaymentResponse.model_validate(payment)

  def _simulate_pg(self, payment_method: str, amount: Decimal) -> bool:
    """외부 PG 연동 시뮬레이션. 95% 성공."""
    return random.random() < 0.95
