from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
import time
import logging

logger = logging.getLogger("core-api")
SLOW_REQUEST_THRESHOLD_MS = 500


class LoggerMiddleware(BaseHTTPMiddleware):
  async def dispatch(self, request: Request, call_next):
    start_time = time.time()
    client_ip = request.client.host if request.client else "unknown"
    content_length = request.headers.get("content-length", "-")

    response = await call_next(request)

    process_time_ms = (time.time() - start_time) * 1000
    response_size = response.headers.get("content-length", "-")

    log_msg = (
      f"{request.method} {request.url.path} "
      f"status={response.status_code} "
      f"duration={process_time_ms:.2f}ms "
      f"req_size={content_length}B "
      f"res_size={response_size}B "
      f"ip={client_ip}"
    )

    if process_time_ms > SLOW_REQUEST_THRESHOLD_MS:
      logger.warning(f"[SLOW] {log_msg}")
    else:
      logger.info(log_msg)

    return response
