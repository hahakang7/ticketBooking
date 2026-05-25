from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
import uuid

import redis as redis_lib

from src.dependencies import get_db, get_redis, get_current_user
from src.services.payment_service import PaymentService
from src.schemas.common import ApiResponse
from src.schemas.payment_schema import ProcessPaymentRequest, PaymentResponse

router = APIRouter(prefix="/api/v1/payments", tags=["payments"])


def get_payment_service(
  db: Session = Depends(get_db),
  r: redis_lib.Redis = Depends(get_redis),
) -> PaymentService:
  return PaymentService(db, r)


@router.post("", response_model=ApiResponse[PaymentResponse], status_code=status.HTTP_201_CREATED)
async def process_payment(
  body: ProcessPaymentRequest,
  service: PaymentService = Depends(get_payment_service),
  user=Depends(get_current_user),
):
  """결제 처리"""
  result = service.process_payment(
    user_id=user["sub"],
    reservation_id=body.reservation_id,
    payment_method=body.payment_method,
    amount=body.amount,
  )
  return ApiResponse(code=201, message="Payment processed", data=result)


@router.get("/{payment_id}", response_model=ApiResponse[PaymentResponse])
async def get_payment(
  payment_id: uuid.UUID,
  service: PaymentService = Depends(get_payment_service),
  user=Depends(get_current_user),
):
  result = service.get_payment(payment_id, user["sub"])
  return ApiResponse(code=200, message="success", data=result)
