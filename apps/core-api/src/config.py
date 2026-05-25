from functools import lru_cache
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
  """환경변수 설정"""

  # PostgreSQL
  database_url: str

  # Redis
  redis_url: str = "redis://localhost:6379"

  # FastAPI
  debug: bool = False
  log_level: str = "info"

  # JWT
  secret_key: str
  jwt_algorithm: str = "HS256"
  jwt_expiration_hours: int = 24
  queue_token_expiration_hours: int = 1

  # CORS
  cors_origins: List[str] = ["http://localhost:3001", "http://localhost:5173"]

  model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)


@lru_cache()
def get_settings() -> Settings:
  """설정 싱글톤"""
  return Settings()
