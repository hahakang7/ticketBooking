import asyncio
import json
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse

from src.dependencies import get_redis
from src.schemas.common import ApiResponse
from src.schemas.queue_schema import QueueJoinRequest, QueueJoinResponse, QueueStatusResponse
from src.services.queue_service import QueueService

router = APIRouter(prefix="/api/queue", tags=["queue"])


def get_queue_service(r=Depends(get_redis)) -> QueueService:
  return QueueService(r)


@router.post("/join", response_model=ApiResponse[QueueJoinResponse], status_code=status.HTTP_200_OK)
async def join_queue(body: QueueJoinRequest, service: QueueService = Depends(get_queue_service)):
  """대기열 참가"""
  result = service.join_queue(body.user_id, body.event_id)
  return ApiResponse(code=200, message="success", data=QueueJoinResponse(**result))


@router.get("/status", response_model=ApiResponse[QueueStatusResponse])
async def get_queue_status(
  user_id: str = Query(...),
  event_id: str = Query(...),
  service: QueueService = Depends(get_queue_service),
):
  """대기열 현재 상태 조회"""
  position = service.get_position(user_id, event_id)
  total = service.get_total(event_id)
  return ApiResponse(
    code=200,
    message="success",
    data=QueueStatusResponse(position=position, total=total, is_in_queue=position is not None),
  )


@router.get("/sse")
async def queue_sse(
  user_id: str = Query(...),
  event_id: str = Query(...),
  service: QueueService = Depends(get_queue_service),
):
  """SSE 스트림: 2초마다 현재 순번 전송. position=1 도달 시 access_token 발급 후 종료."""

  async def event_stream() -> AsyncGenerator[str, None]:
    while True:
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
