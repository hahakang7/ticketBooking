from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
import uuid

import redis as redis_lib

from src.dependencies import get_db, get_current_user
from src.repositories.seat_repository import SeatRepository
from src.schemas.common import ApiResponse
from src.schemas.seat_schema import SeatListResponse, SeatResponse

router = APIRouter(prefix="/api/v1/seats", tags=["seats"])


@router.get("/{event_id}", response_model=ApiResponse[SeatListResponse])
async def get_seats(
  event_id: uuid.UUID,
  db: Session = Depends(get_db),
  _user=Depends(get_current_user),
):
  """이벤트 좌석 목록 조회 (access_token 필요)"""
  repo = SeatRepository(db)
  seats = repo.get_by_event_id(event_id)
  items = [SeatResponse.model_validate(s) for s in seats]
  return ApiResponse(
    code=200,
    message="success",
    data=SeatListResponse(items=items, total=len(items)),
  )


@router.get("/{event_id}/available", response_model=ApiResponse[SeatListResponse])
async def get_available_seats(
  event_id: uuid.UUID,
  db: Session = Depends(get_db),
  _user=Depends(get_current_user),
):
  """이용 가능한 좌석만 조회"""
  repo = SeatRepository(db)
  seats = repo.get_available_seats(event_id)
  items = [SeatResponse.model_validate(s) for s in seats]
  return ApiResponse(
    code=200,
    message="success",
    data=SeatListResponse(items=items, total=len(items)),
  )
