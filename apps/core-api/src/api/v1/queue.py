import asyncio
import json
import logging
from typing import AsyncGenerator

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from src.database.db import SessionLocal
from src.dependencies import get_redis, get_user_from_queue_token
from src.schemas.common import ApiResponse
from src.schemas.queue_schema import QueueJoinRequest, QueueJoinResponse, QueueStatusResponse
from src.services.prediction_service import PredictionService
from src.services.queue_service import QueueService

logger = logging.getLogger("core-api")

router = APIRouter(prefix="/api/queue", tags=["queue"])


def get_queue_service(r=Depends(get_redis)) -> QueueService:
  return QueueService(r)


def _log_scaling_recommendation(event_id: str, r):
  """대기열 최초 오픈 시 예측 모델 호출 및 로깅 (백그라운드 태스크)"""
  db = None
  try:
    db = SessionLocal()
    service = PredictionService(db, r)
    service.get_resource_plan(event_id)
  except Exception as e:
    logger.error(f"[Prediction] Background task failed for event={event_id}: {e}")
  finally:
    if db:
      db.close()


@router.post("/join", response_model=ApiResponse[QueueJoinResponse], status_code=status.HTTP_200_OK)
async def join_queue(
  body: QueueJoinRequest,
  background_tasks: BackgroundTasks,
  service: QueueService = Depends(get_queue_service),
  r=Depends(get_redis),
):
  """대기열 참가 (join 성공 시 예측 모델 백그라운드 실행)"""
  result = service.join_queue(body.user_id, body.event_id)

  # 대기열 최초 오픈 시점(queue total == 1)에만 예측 실행
  if result.get("total") == 1:
    background_tasks.add_task(_log_scaling_recommendation, body.event_id, r)

  return ApiResponse(code=200, message="success", data=QueueJoinResponse(**result))


@router.get("/status", response_model=ApiResponse[QueueStatusResponse])
async def get_queue_status(
  user_id: str = Query(...),
  event_id: str = Query(...),
  token_user: dict = Depends(get_user_from_queue_token),
  service: QueueService = Depends(get_queue_service),
):
  """대기열 현재 상태 조회 (queue_token 필수)"""
  if token_user["sub"] != user_id:
    raise HTTPException(
      status_code=status.HTTP_403_FORBIDDEN,
      detail="user_id mismatch with token",
    )
  position = service.get_position(user_id, event_id)
  total = service.get_total(event_id)
  return ApiResponse(
    code=200,
    message="success",
    data=QueueStatusResponse(position=position, total=total, is_in_queue=position is not None),
  )


@router.get("/sse")
async def queue_sse(
  request: Request,
  user_id: str = Query(...),
  event_id: str = Query(...),
  token_user: dict = Depends(get_user_from_queue_token),
  service: QueueService = Depends(get_queue_service),
):
  """SSE 스트림: 2초마다 현재 순번 전송. position=1 도달 시 access_token 발급 후 종료."""
  if token_user["sub"] != user_id:
    raise HTTPException(
      status_code=status.HTTP_403_FORBIDDEN,
      detail="user_id mismatch with token",
    )

  async def event_stream() -> AsyncGenerator[str, None]:
    while True:
      if await request.is_disconnected():
        break

      position = service.get_position(user_id, event_id)
      total = service.get_total(event_id)

      if position is None:
        payload = json.dumps({"status": "not_in_queue", "position": None, "total": total})
        yield f"data: {payload}\n\n"
        break

      if position == 1:
        access_token = service.consume_token(user_id, event_id)
        payload = json.dumps({"status": "ready", "position": 0, "total": total, "access_token": access_token})
        yield f"data: {payload}\n\n"
        break

      payload = json.dumps({"status": "waiting", "position": position, "total": total})
      yield f"data: {payload}\n\n"
      await asyncio.sleep(2)

  return StreamingResponse(event_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.delete("/leave", response_model=ApiResponse[None], status_code=status.HTTP_200_OK)
async def leave_queue(
  user_id: str = Query(...),
  event_id: str = Query(...),
  token_user: dict = Depends(get_user_from_queue_token),
  service: QueueService = Depends(get_queue_service),
):
  """대기열 이탈 (queue_token 필수)"""
  if token_user["sub"] != user_id:
    raise HTTPException(
      status_code=status.HTTP_403_FORBIDDEN,
      detail="user_id mismatch with token",
    )

  removed = service.leave_queue(user_id, event_id)
  if not removed:
    raise HTTPException(
      status_code=status.HTTP_404_NOT_FOUND,
      detail="user not in queue",
    )

  return ApiResponse(code=200, message="success", data=None)
