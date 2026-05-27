from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
import logging

from src.schemas.common import ApiResponse
from src.exceptions.custom_exceptions import BusinessLogicError

logger = logging.getLogger(__name__)


class ErrorHandlerMiddleware(BaseHTTPMiddleware):
  async def dispatch(self, request: Request, call_next):
    try:
      response = await call_next(request)
      return response
    except BusinessLogicError as e:
      return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content=ApiResponse(
          code=409,
          message="Conflict",
          data={"error": str(e)},
        ).model_dump(),
      )
    except ValueError as e:
      # UUID 형식 오류 등 잘못된 입력값 — 500이 아닌 400으로 반환
      return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content=ApiResponse(
          code=400,
          message="Bad request",
          data={"error": str(e)},
        ).model_dump(),
      )
    except Exception as e:
      logger.error(f"Unhandled exception: {e}", exc_info=True)
      return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=ApiResponse(
          code=500,
          message="Internal server error",
        ).model_dump(),
      )
