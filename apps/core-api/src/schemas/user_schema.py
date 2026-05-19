from pydantic import BaseModel
import uuid


class UserBase(BaseModel):
  """사용자 기본 DTO"""
  email: str
  name: str
  phone: str | None = None


class UserResponse(UserBase):
  """사용자 응답 DTO"""
  user_id: uuid.UUID

  class Config:
    from_attributes = True
