import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
import logging

from prometheus_fastapi_instrumentator import Instrumentator
from src.metrics import duplicate_reservation_total, predicted_replicas_gauge, prescale_events_total

from src.config import get_settings
from src.database.db import engine
from src.api.v1 import health, events, queue, seats, reservations, payments, prediction
from src.middleware import ErrorHandlerMiddleware, LoggerMiddleware, RateLimiterMiddleware
from src.redis.client import redis_client

logging.basicConfig(
  level=logging.INFO,
  format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("core-api")

settings = get_settings()

# SQLAlchemy 로그는 DEBUG 모드에서만 출력, propagate=False로 이중 출력 방지
_sql_level = logging.DEBUG if settings.debug else logging.WARNING
_sa_logger = logging.getLogger("sqlalchemy.engine")
_sa_logger.setLevel(_sql_level)
_sa_logger.propagate = False

CLEANUP_INTERVAL_SECONDS  = 30
PRESCALE_INTERVAL_SECONDS = 60


def _run_cleanup():
  """동기 컨텍스트에서 만료된 hold 예약을 정리한다."""
  from src.database.db import SessionLocal
  from src.services.reservation_service import ReservationService
  from sqlalchemy import text

  # 만료된 예약이 있을 때만 세션을 열어 불필요한 BEGIN/ROLLBACK 트랜잭션을 방지
  check_db = SessionLocal()
  try:
    result = check_db.execute(
      text("SELECT 1 FROM reservations WHERE status='held' AND expires_at < NOW() LIMIT 1")
    )
    has_expired = result.fetchone() is not None
  finally:
    check_db.rollback()
    check_db.close()

  if not has_expired:
    return

  db = SessionLocal()
  try:
    service = ReservationService(db, redis_client)
    released = service.release_expired_holds()
    if released > 0:
      logger.info(f"[Cleanup] Released {released} expired seat hold(s)")
  except Exception as e:
    logger.error(f"[Cleanup] Failed: {e}")
  finally:
    db.rollback()
    db.close()


async def _cleanup_loop():
  """30초마다 만료된 좌석 hold를 정리하는 백그라운드 태스크."""
  while True:
    await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run_cleanup)


def _run_prescale():
  """LSTM 예측 기반 선제 스케일링 체크 (동기)."""
  from src.database.db import SessionLocal
  from src.services.scaling_service import run_prescale_check

  db = SessionLocal()
  try:
    run_prescale_check(db, redis_client)
  except Exception as e:
    logger.error(f"[PreScale] 체크 실패: {e}")
  finally:
    db.close()


async def _prescale_loop():
  """60초마다 이벤트 오픈 예정을 확인하고 선제 스케일업하는 백그라운드 태스크."""
  await asyncio.sleep(10)  # 앱 초기화 완료 후 시작
  while True:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run_prescale)
    await asyncio.sleep(PRESCALE_INTERVAL_SECONDS)


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

  cleanup_task  = asyncio.create_task(_cleanup_loop())
  prescale_task = asyncio.create_task(_prescale_loop())
  logger.info(f"[Cleanup]  Background task started (interval: {CLEANUP_INTERVAL_SECONDS}s)")
  logger.info(f"[PreScale] Background task started (interval: {PRESCALE_INTERVAL_SECONDS}s)")

  yield

  cleanup_task.cancel()
  prescale_task.cancel()
  for task in (cleanup_task, prescale_task):
    try:
      await task
    except asyncio.CancelledError:
      pass

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

Instrumentator().instrument(app).expose(app, include_in_schema=False)

# CORS 설정
app.add_middleware(
  CORSMiddleware,
  allow_origins=settings.cors_origins,
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

# 응답 압축
app.add_middleware(GZipMiddleware, minimum_size=1000)

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
app.include_router(prediction.router)
