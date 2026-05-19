from fastapi import Depends
from sqlalchemy.orm import Session

from src.database.db import SessionLocal
from src.redis.client import redis_client
from src.config import Settings, get_settings


def get_db() -> Session:
  """DB 세션 의존성"""
  db = SessionLocal()
  try:
    yield db
  finally:
    db.close()


def get_redis():
  """Redis 클라이언트 의존성"""
  return redis_client


def get_config() -> Settings:
  """설정 의존성"""
  return get_settings()
