from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from src.config import get_settings
from src.database.db import engine
from src.api.v1 import health, events, queue, seats, reservations, payments
from src.middleware import ErrorHandlerMiddleware, LoggerMiddleware, RateLimiterMiddleware
from src.redis.client import redis_client

# 로깅 설정
logging.basicConfig(
  level=logging.INFO,
  format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("core-api")

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
  """앱 시작/종료 관리"""
  logger.info("Application startup")

  try:
    from src.database.db import SessionLocal
    db = SessionLocal()
    from sqlalchemy import text
    db.execute(text("SELECT 1"))
    db.close()
    logger.info("Database connection successful")
  except Exception as e:
    logger.error(f"Database connection failed: {e}")

  try:
    redis_client.ping()
    logger.info("Redis connection successful")
  except Exception as e:
    logger.error(f"Redis connection failed: {e}")

  yield

  logger.info("Application shutdown")
  try:
    redis_client.close()
  except Exception as e:
    logger.error(f"Redis close failed: {e}")


# FastAPI 앱 생성
app = FastAPI(
  title="Ticket Booking API",
  description="Predictive Ticket Reservation System",
  version="1.0.0",
  lifespan=lifespan,
)

# CORS 설정
app.add_middleware(
  CORSMiddleware,
  allow_origins=settings.cors_origins,
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

# 커스텀 미들웨어 (등록 역순으로 실행)
app.add_middleware(RateLimiterMiddleware)
app.add_middleware(LoggerMiddleware)
app.add_middleware(ErrorHandlerMiddleware)

# 라우터 등록
app.include_router(health.router)
app.include_router(events.router)
app.include_router(queue.router)
app.include_router(seats.router)
app.include_router(reservations.router)
app.include_router(payments.router)
