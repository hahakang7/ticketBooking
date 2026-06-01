import asyncio
import logging
import time

from fastapi import status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from src.redis.client import redis_client

logger = logging.getLogger("core-api")

# (max_requests, window_seconds, rate_limit_type)
# rate_limit_type: "ip" (IP 기반) 또는 "user" (사용자 기반)
RATE_LIMIT_RULES: dict = {
  "/api/queue/join": (1, 1, "ip"),  # 1초에 1회 (IP 기반) — 티켓팅 봇 방어
  "/api/v1/reservations": (2, 1, "user"),  # 1초에 2회 (사용자 기반) — 좌석 선점 방어
}
DEFAULT_LIMIT = (60, 60, "ip")


class RateLimiterMiddleware(BaseHTTPMiddleware):
  async def dispatch(self, request: Request, call_next):
    if request.method == "OPTIONS":
      return await call_next(request)

    path = request.url.path

    try:
      client_ip = request.client.host if request.client else "unknown"
      rule = RATE_LIMIT_RULES.get(path)

      if rule:
        max_requests, window_seconds, rate_limit_type = rule
      else:
        max_requests, window_seconds, rate_limit_type = DEFAULT_LIMIT

      bucket = int(time.time() / window_seconds)

      # user 기반 rate limit: Authorization 헤더에서 user_id 추출
      if rate_limit_type == "user":
        user_id = await self._extract_user_id(request)
        if user_id:
          rate_key = f"rate:{user_id}:{path}:{bucket}"
        else:
          # user_id 추출 실패 시 IP 기반으로 폴백
          rate_key = f"rate:{client_ip}:{path}:{bucket}"
      else:
        # IP 기반 rate limit
        rate_key = f"rate:{client_ip}:{path}:{bucket}"

      # asyncio.to_thread: 동기 Redis 호출이 이벤트 루프를 블록하지 않도록 스레드 풀에서 실행
      current = await asyncio.to_thread(redis_client.incr, rate_key)
      if current == 1:
        await asyncio.to_thread(redis_client.expire, rate_key, window_seconds * 2)

      if current > max_requests:
        logger.warning(f"Rate limit exceeded: {rate_limit_type}={rate_key} -> {path} ({current}/{max_requests})")
        return JSONResponse(
          status_code=status.HTTP_429_TOO_MANY_REQUESTS,
          content={"code": 429, "message": "Too Many Requests", "data": {"retry_after": window_seconds}},
        )
    except Exception as e:
      # Redis 장애 시 rate limit 검사 생략 (fail-open)
      logger.error(f"Rate limiter error: {e}")

    return await call_next(request)

  async def _extract_user_id(self, request: Request) -> str | None:
    """Authorization 헤더에서 user_id 추출 (JWT decode)"""
    try:
      auth_header = request.headers.get("authorization", "").lower()
      if not auth_header.startswith("bearer "):
        return None

      token = auth_header[7:]  # "bearer " 제거
      from src.auth.token import decode_token
      payload = decode_token(token)
      return payload.get("sub")
    except Exception:
      return None
