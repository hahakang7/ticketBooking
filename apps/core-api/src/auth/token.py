from datetime import datetime, timedelta
from typing import Any, Dict

from jose import jwt, JWTError

from src.config import get_settings

settings = get_settings()


def create_queue_token(user_id: str, event_id: str, position: int) -> str:
  """대기열 JWT 생성 (TTL: 1시간)"""
  expire = datetime.utcnow() + timedelta(hours=1)
  payload = {
    "sub": user_id,
    "event_id": event_id,
    "position": position,
    "type": "queue",
    "exp": expire,
  }
  return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: str, event_id: str) -> str:
  """예매 허가 JWT 생성 (TTL: 24시간)"""
  expire = datetime.utcnow() + timedelta(hours=settings.jwt_expiration_hours)
  payload = {
    "sub": user_id,
    "event_id": event_id,
    "type": "access",
    "exp": expire,
  }
  return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> Dict[str, Any]:
  """JWT 디코딩 - 만료/잘못된 토큰 시 ValueError 발생"""
  try:
    return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
  except JWTError as e:
    raise ValueError(f"Invalid or expired token: {e}")
