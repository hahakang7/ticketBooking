"""공통 pytest fixtures"""
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session


@pytest.fixture
def mock_redis():
  """Redis 클라이언트 Mock"""
  r = MagicMock()
  r.zadd.return_value = 1
  r.expire.return_value = True
  r.zrank.return_value = None
  r.zcard.return_value = 0
  r.zrem.return_value = 0
  r.incr.return_value = 1
  r.set.return_value = True
  r.exists.return_value = 0
  r.register_script.return_value = MagicMock()
  r.get.return_value = None
  r.pipeline.return_value = MagicMock()
  return r


@pytest.fixture
def mock_db():
  """SQLAlchemy Session Mock"""
  return MagicMock(spec=Session)


@pytest.fixture
def app_client(mock_redis):
  """FastAPI 테스트 클라이언트"""
  with patch("src.redis.client.redis_client", mock_redis), \
       patch("src.dependencies.redis_client", mock_redis), \
       patch("src.middleware.rate_limiter.redis_client", mock_redis):
    from src.main import app
    client = TestClient(app, raise_server_exceptions=False)
    yield client, mock_redis
