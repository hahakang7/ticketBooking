from fastapi import APIRouter
from datetime import datetime

router = APIRouter()


@router.get("/health")
async def health_check():
  """헬스 체크 엔드포인트"""
  return {
    "status": "ok",
    "timestamp": datetime.utcnow().isoformat(),
  }
