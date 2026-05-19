from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
import time
import logging

logger = logging.getLogger("core-api")


class LoggerMiddleware(BaseHTTPMiddleware):
  async def dispatch(self, request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time

    logger.info(
      f"{request.method} {request.url.path} {response.status_code} {process_time*1000:.2f}ms"
    )

    return response
