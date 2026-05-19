from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from src.config import get_settings
from src.database.db import engine
from src.api.v1 import health, events
from src.middleware import ErrorHandlerMiddleware, LoggerMiddleware
from src.redis.client import redis_client

# FastAPI 앱 생성
app = FastAPI(
  title="Ticket Booking API",
  description="Predictive Ticket Reservation System",
  version="1.0.0",
)

settings = get_settings()

# CORS 설정
app.add_middleware(
  CORSMiddleware,
  allow_origins=settings.cors_origins,
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

# 커스텀 미들웨어
app.add_middleware(LoggerMiddleware)
app.add_middleware(ErrorHandlerMiddleware)

# 로깅 설정
logging.basicConfig(
  level=settings.log_level.upper(),
  format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("core-api")


@app.on_event("startup")
async def startup_event():
  """앱 시작 시 실행"""
  logger.info("Application startup")
  # DB 연결 확인
  try:
    from src.database.db import SessionLocal
    db = SessionLocal()
    db.close()
    logger.info("Database connection successful")
  except Exception as e:
    logger.error(f"Database connection failed: {e}")

  # Redis 연결 확인
  try:
    redis_client.ping()
    logger.info("Redis connection successful")
  except Exception as e:
    logger.error(f"Redis connection failed: {e}")


@app.on_event("shutdown")
async def shutdown_event():
  """앱 종료 시 실행"""
  logger.info("Application shutdown")
  try:
    redis_client.close()
  except Exception as e:
    logger.error(f"Redis close failed: {e}")


# 라우터 등록
app.include_router(health.router)
app.include_router(events.router)
