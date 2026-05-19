from typing import Generic, Optional, TypeVar, Any
from pydantic import BaseModel

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
  """API 공통 응답 포맷"""
  code: int
  message: str
  data: Optional[T] = None
