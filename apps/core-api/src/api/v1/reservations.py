from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional
import uuid

import redis as redis_lib

from src.config import get_settings
from src.dependencies import get_db, get_redis, get_current_user
from src.services.reservation_service import ReservationService
from src.schemas.common import ApiResponse
from src.schemas.reservation_schema import (
  HoldSeatsRequest,
  ReservationResponse,
)

router = APIRouter(prefix="/api/v1/reservations", tags=["reservations"])


def get_reservation_service(
  db: Session = Depends(get_db),
  r: redis_lib.Redis = Depends(get_redis),
) -> ReservationService:
  return ReservationService(db, r)


@router.post("", response_model=ApiResponse[ReservationResponse], status_code=status.HTTP_201_CREATED)
async def hold_seats(
  body: HoldSeatsRequest,
  service: ReservationService = Depends(get_reservation_service),
  user=Depends(get_current_user),
):
  """좌석 hold + 예약 생성"""
  result = service.hold_seats(
    user_id=user["sub"],
    event_id=user["event_id"],
    seat_ids=body.seat_ids,
  )
  return ApiResponse(code=201, message="Seats held successfully", data=result)


@router.get("/{reservation_id}", response_model=ApiResponse[ReservationResponse])
async def get_reservation(
  reservation_id: uuid.UUID,
  service: ReservationService = Depends(get_reservation_service),
  user=Depends(get_current_user),
):
  result = service.get_reservation(reservation_id, user["sub"])
  return ApiResponse(code=200, message="success", data=result)


@router.delete("/{reservation_id}", response_model=ApiResponse[ReservationResponse])
async def cancel_reservation(
  reservation_id: uuid.UUID,
  service: ReservationService = Depends(get_reservation_service),
  user=Depends(get_current_user),
):
  result = service.cancel_reservation(reservation_id, user["sub"])
  return ApiResponse(code=200, message="Reservation cancelled", data=result)


class ReleaseUserRequest(BaseModel):
  user_id: str


@router.post("/internal/release-user", status_code=status.HTTP_200_OK, include_in_schema=False)
async def release_user_holds_internal(
  body: ReleaseUserRequest,
  x_internal_secret: Optional[str] = Header(None),
  service: ReservationService = Depends(get_reservation_service),
):
  """
  내부 전용 엔드포인트: WebSocket 서비스가 사용자 연결 해제 후 hold를 풀 때 호출.
  X-Internal-Secret 헤더로 인증한다.
  """
  settings = get_settings()
  if not settings.internal_secret or x_internal_secret != settings.internal_secret:
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

  released = service.release_user_holds(body.user_id)
  return {"released_seats": released, "user_id": body.user_id}
