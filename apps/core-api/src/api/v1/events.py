from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import uuid

from src.dependencies import get_db
from src.services.event_service import EventService
from src.schemas.common import ApiResponse
from src.schemas.event_schema import EventResponse, EventListResponse
from src.schemas.seat_schema import SeatListResponse

router = APIRouter(prefix="/api/v1/events", tags=["events"])


@router.get("", response_model=ApiResponse[EventListResponse])
async def list_events(page: int = 1, limit: int = 20, db: Session = Depends(get_db)):
  """이벤트 목록 조회"""
  service = EventService(db)
  events = service.get_events(page, limit)
  return ApiResponse(code=200, message="success", data=events)


@router.get("/{event_id}", response_model=ApiResponse[EventResponse])
async def get_event(event_id: uuid.UUID, db: Session = Depends(get_db)):
  """이벤트 단건 조회"""
  service = EventService(db)
  event = service.get_event_by_id(event_id)
  if not event:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
  return ApiResponse(code=200, message="success", data=event)


@router.get("/{event_id}/seats", response_model=ApiResponse[SeatListResponse])
async def get_event_seats(event_id: uuid.UUID, db: Session = Depends(get_db)):
  """이벤트 좌석 조회"""
  service = EventService(db)
  seats = service.get_seats_by_event(event_id)
  if not seats:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
  return ApiResponse(code=200, message="success", data=seats)
