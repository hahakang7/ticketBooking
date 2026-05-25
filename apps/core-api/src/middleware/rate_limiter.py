import time
import logging
from fastapi import status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

logger = logging.getLogger("core-api")

RATE_LIMIT_RULES: dict = {
  "/api/queue/join": (1, 1),
}
DEFAULT_LIMIT = (10, 1)


class RateLimiterMiddleware(BaseHTTPMiddleware):
  async def dispatch(self, request: Request, call_next):
    if request.method == "OPTIONS":
      return await call_next(request)

    try:
      from src.redis.client import redis_client
      r = redis_client
    except Exception:
      return await call_next(request)

    client_ip = request.client.host if request.client else "unknown"
    path = request.url.path
    max_requests, window_seconds = RATE_LIMIT_RULES.get(path, DEFAULT_LIMIT)
    bucket = int(time.time() / window_seconds)
    rate_key = f"rate:{client_ip}:{path}:{bucket}"

    try:
      current = r.incr(rate_key)
      if current == 1:
        r.expire(rate_key, window_seconds * 2)
      if isinstance(current, int) and current > max_requests:
        logger.warning(f"Rate limit exceeded: {client_ip} -> {path} ({current}/{max_requests})")
        return JSONResponse(
          status_code=status.HTTP_429_TOO_MANY_REQUESTS,
          content={"code": 429, "message": "Too Many Requests", "data": {"retry_after": window_seconds}},
        )
    except Exception as e:
      logger.error(f"Rate limiter Redis error: {e}")

    return await call_next(request)
