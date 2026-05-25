from decimal import Decimal
from typing import Optional
from sqlalchemy.orm import Session
import uuid

from src.models.payment import Payment


class PaymentRepository:
  def __init__(self, db: Session):
    self.db = db

  def create(
    self,
    reservation_id: uuid.UUID,
    user_id: uuid.UUID,
    amount: Decimal,
    payment_method: str,
  ) -> Payment:
    payment = Payment(
      reservation_id=reservation_id,
      user_id=user_id,
      amount=amount,
      status="pending",
      payment_method=payment_method,
    )
    self.db.add(payment)
    self.db.flush()
    return payment

  def get_by_id(self, payment_id: uuid.UUID) -> Optional[Payment]:
    return self.db.query(Payment).filter(Payment.payment_id == payment_id).first()

  def get_by_reservation(self, reservation_id: uuid.UUID) -> Optional[Payment]:
    return (
      self.db.query(Payment)
      .filter(Payment.reservation_id == reservation_id)
      .first()
    )

  def update_status(self, payment_id: uuid.UUID, status: str) -> Optional[Payment]:
    payment = self.get_by_id(payment_id)
    if payment:
      payment.status = status
      self.db.flush()
    return payment

  def commit(self):
    self.db.commit()

  def rollback(self):
    self.db.rollback()
