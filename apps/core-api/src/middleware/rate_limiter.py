import asyncio
import logging
import time

from fastapi import status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from src.redis.client import redis_client

logger = logging.getLogger("core-api")

# (max_requests, window_seconds) per IP
RATE_LIMIT_RULES: dict = {
  "/api/queue/join": (10, 10),  # 10초에 10회 (IP 기반)
}
DEFAULT_LIMIT = (60, 60)


class RateLimiterMiddleware(BaseHTTPMiddleware):
  async def dispatch(self, request: Request, call_next):
    if request.method == "OPTIONS":
      return await call_next(request)

    path = request.url.path

    try:
      client_ip = request.client.host if request.client else "unknown"
      max_requests, window_seconds = RATE_LIMIT_RULES.get(path, DEFAULT_LIMIT)
      bucket = int(time.time() / window_seconds)
      rate_key = f"rate:{client_ip}:{path}:{bucket}"

      # asyncio.to_thread: 동기 Redis 호출이 이벤트 루프를 블록하지 않도록 스레드 풀에서 실행
      current = await asyncio.to_thread(redis_client.incr, rate_key)
      if current == 1:
        await asyncio.to_thread(redis_client.expire, rate_key, window_seconds * 2)

      if current > max_requests:
        logger.warning(f"Rate limit exceeded: ip={client_ip} -> {path} ({current}/{max_requests})")
        return JSONResponse(
          status_code=status.HTTP_429_TOO_MANY_REQUESTS,
          content={"code": 429, "message": "Too Many Requests", "data": {"retry_after": window_seconds}},
        )
    except Exception as e:
      # Redis 장애 시 rate limit 검사 생략 (fail-open)
      logger.error(f"Rate limiter error: {e}")

    return await call_next(request)
