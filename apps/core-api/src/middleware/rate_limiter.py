import json
import logging
import time

from fastapi import status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from src.redis.client import redis_client

logger = logging.getLogger("core-api")

RATE_LIMIT_RULES: dict = {
  "/api/queue/join": (1, 1),
}
DEFAULT_LIMIT = (10, 1)


class RateLimiterMiddleware(BaseHTTPMiddleware):
  async def dispatch(self, request: Request, call_next):
    if request.method == "OPTIONS":
      return await call_next(request)

    path = request.url.path

    try:
      if path == "/api/queue/join":
        limit_response = await self._check_rate_limit_by_user(request, redis_client, path)
        if limit_response:
          return limit_response
      else:
        limit_response = await self._check_rate_limit_by_ip(request, redis_client, path)
        if limit_response:
          return limit_response
    except Exception as e:
      logger.error(f"Rate limiter error: {e}")

    return await call_next(request)

  async def _check_rate_limit_by_user(self, request: Request, r, path: str):
    """user_id 기반 rate limiting (join endpoint용). 초과시 response 반환, 아니면 None."""
    try:
      body = await request.body()
      data = json.loads(body) if body else {}
      user_id = data.get("user_id", "unknown")
    except Exception:
      user_id = "unknown"

    max_requests, window_seconds = RATE_LIMIT_RULES.get(path, DEFAULT_LIMIT)
    bucket = int(time.time() / window_seconds)
    rate_key = f"rate:{user_id}:{path}:{bucket}"

    current = r.incr(rate_key)
    if current == 1:
      r.expire(rate_key, window_seconds * 2)

    if current > max_requests:
      logger.warning(f"Rate limit exceeded: user={user_id} -> {path} ({current}/{max_requests})")
      return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={"code": 429, "message": "Too Many Requests", "data": {"retry_after": window_seconds}},
      )
    return None

  async def _check_rate_limit_by_ip(self, request: Request, r, path: str):
    """IP 기반 rate limiting (기타 엔드포인트). 초과시 response 반환, 아니면 None."""
    client_ip = request.client.host if request.client else "unknown"
    max_requests, window_seconds = RATE_LIMIT_RULES.get(path, DEFAULT_LIMIT)
    bucket = int(time.time() / window_seconds)
    rate_key = f"rate:{client_ip}:{path}:{bucket}"

    current = r.incr(rate_key)
    if current == 1:
      r.expire(rate_key, window_seconds * 2)

    if current > max_requests:
      logger.warning(f"Rate limit exceeded: ip={client_ip} -> {path} ({current}/{max_requests})")
      return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={"code": 429, "message": "Too Many Requests", "data": {"retry_after": window_seconds}},
      )
    return None
