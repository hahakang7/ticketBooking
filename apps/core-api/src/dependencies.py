from typing import Optional

from fastapi import Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from src.database.db import SessionLocal
from src.redis.client import redis_client
from src.config import Settings, get_settings
from src.auth.token import decode_token


def get_db() -> Session:
  """DB 세션 의존성"""
  db = SessionLocal()
  try:
    yield db
  except Exception:
    db.rollback()
    raise
  finally:
    db.close()


def get_redis():
  """Redis 클라이언트 의존성"""
  return redis_client


def get_config() -> Settings:
  """설정 의존성"""
  return get_settings()


def get_current_user(authorization: str = Header(...)) -> dict:
  """
  Authorization: Bearer <access_token> 검증.
  반환: {"sub": user_id, "event_id": event_id, "type": "access"}
  """
  auth_header = authorization.strip()
  if not auth_header.lower().startswith("bearer "):
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail="Invalid authorization header format",
    )
  token = auth_header[7:]
  try:
    payload = decode_token(token)
  except ValueError as e:
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail=str(e),
    )
  if payload.get("type") != "access":
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail="Access token required",
    )
  return payload


def get_user_from_queue_token(
  authorization: Optional[str] = Header(None),
  queue_token: Optional[str] = Query(None),
) -> dict:
  """
  Authorization: Bearer <queue_token> 헤더 또는 ?queue_token= 쿼리 파라미터로 검증.
  EventSource는 커스텀 헤더를 보낼 수 없으므로 쿼리 파라미터도 허용.
  반환: {"sub": user_id, "event_id": event_id, "position": position, "type": "queue"}
  """
  token: Optional[str] = None
  if authorization:
    auth_header = authorization.strip()
    if not auth_header.lower().startswith("bearer "):
      raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authorization header format",
      )
    token = auth_header[7:]
  elif queue_token:
    token = queue_token
  else:
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail="Queue token required (Authorization header or queue_token param)",
    )
  try:
    payload = decode_token(token)
  except ValueError as e:
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail=str(e),
    )
  if payload.get("type") != "queue":
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail="Queue token required",
    )
  return payload
