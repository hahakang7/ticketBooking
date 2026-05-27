import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
import redis as redis_lib
import uuid

from src.dependencies import get_db, get_redis
from src.redis.constants import CACHE_SEATS_KEY, SEAT_CACHE_TTL
from src.services.event_service import EventService
from src.schemas.common import ApiResponse
from src.schemas.event_schema import EventResponse, EventListResponse
from src.schemas.seat_schema import SeatListResponse, SeatResponse

router = APIRouter(prefix="/api/v1/events", tags=["events"])


@router.get("", response_model=ApiResponse[EventListResponse])
async def list_events(
  page: int = Query(default=1, ge=1),
  limit: int = Query(default=20, ge=1, le=100),
  db: Session = Depends(get_db)
):
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
async def get_event_seats(
  event_id: uuid.UUID,
  db: Session = Depends(get_db),
  r: redis_lib.Redis = Depends(get_redis),
):
  """이벤트 좌석 조회"""
  cache_key = CACHE_SEATS_KEY(str(event_id))
  cached = r.get(cache_key)
  if cached:
    items = [SeatResponse.model_validate(s) for s in json.loads(cached)]
    return ApiResponse(code=200, message="success (cached)", data=SeatListResponse(items=items, total=len(items)))

  service = EventService(db)
  event = service.get_event_by_id(event_id)
  if not event:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
  seats = service.get_seats_by_event(event_id)
  seat_list = seats if seats else SeatListResponse(items=[], total=0)
  r.set(cache_key, json.dumps([i.model_dump(mode="json") for i in seat_list.items]), ex=SEAT_CACHE_TTL)
  return ApiResponse(code=200, message="success", data=seat_list)
