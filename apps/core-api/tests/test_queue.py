import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi.testclient import TestClient


@pytest.fixture
def mock_redis():
  r = MagicMock()
  r.zadd.return_value = 1
  r.expire.return_value = True
  r.zrank.return_value = None
  r.zcard.return_value = 0
  r.zrem.return_value = 0
  r.incr.return_value = 1
  return r


@pytest.fixture
def app_client(mock_redis):
  with patch("src.redis.client.redis_client", mock_redis):
    from src.main import app
    client = TestClient(app, raise_server_exceptions=False)
    yield client, mock_redis


class TestQueueService:
  def test_join_queue_new_user(self, mock_redis):
    """신규 사용자 대기열 참가: ZADD 호출 후 position 1 반환"""
    from src.services.queue_service import QueueService

    mock_redis.zrank.side_effect = [None, 0]
    mock_redis.zcard.return_value = 1

    service = QueueService(mock_redis)
    result = service.join_queue("user-1", "event-1")

    mock_redis.zadd.assert_called_once()
    assert result["position"] == 1
    assert result["total"] == 1
    assert "queue_token" in result

  def test_join_queue_existing_user(self, mock_redis):
    """이미 대기열에 있는 사용자: ZADD 없이 현재 순번 반환"""
    from src.services.queue_service import QueueService

    mock_redis.zrank.return_value = 2
    mock_redis.zcard.return_value = 10

    service = QueueService(mock_redis)
    result = service.join_queue("user-1", "event-1")

    mock_redis.zadd.assert_not_called()
    assert result["position"] == 3
    assert result["total"] == 10

  def test_get_position_exists(self, mock_redis):
    """대기열에 있는 사용자 순번 조회"""
    from src.services.queue_service import QueueService

    mock_redis.zrank.return_value = 4
    service = QueueService(mock_redis)

    pos = service.get_position("user-1", "event-1")
    assert pos == 5

  def test_get_position_not_exists(self, mock_redis):
    """대기열에 없는 사용자 순번 조회 → None"""
    from src.services.queue_service import QueueService

    mock_redis.zrank.return_value = None
    service = QueueService(mock_redis)

    pos = service.get_position("user-1", "event-1")
    assert pos is None

  def test_leave_queue(self, mock_redis):
    """대기열 이탈: ZREM 호출 확인"""
    from src.services.queue_service import QueueService

    mock_redis.zrem.return_value = 1
    service = QueueService(mock_redis)

    result = service.leave_queue("user-1", "event-1")
    mock_redis.zrem.assert_called_once()
    assert result is True

  def test_consume_token_when_in_queue(self, mock_redis):
    """position=1 소비: ZREM 호출 및 access_token 반환"""
    from src.services.queue_service import QueueService

    mock_redis.zrank.return_value = 0
    mock_redis.zrem.return_value = 1
    service = QueueService(mock_redis)

    token = service.consume_token("user-1", "event-1")
    assert token is not None
    assert isinstance(token, str)
    mock_redis.zrem.assert_called_once()

  def test_consume_token_not_in_queue(self, mock_redis):
    """대기열에 없는 사용자 consume → None"""
    from src.services.queue_service import QueueService

    mock_redis.zrank.return_value = None
    service = QueueService(mock_redis)

    token = service.consume_token("user-1", "event-1")
    assert token is None


class TestQueueAPI:
  def test_post_join_success(self, app_client):
    client, mock_redis = app_client
    mock_redis.reset_mock()
    mock_redis.zrank.side_effect = [None, 0]
    mock_redis.zcard.return_value = 1
    mock_redis.incr.return_value = 1
    mock_redis.expire.return_value = True

    response = client.post("/api/queue/join", json={"user_id": "u1", "event_id": "e1"})
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 200
    assert data["data"]["position"] == 1
    assert "queue_token" in data["data"]


class TestTokenAuth:
  def test_create_and_decode_queue_token(self):
    from src.auth.token import create_queue_token, decode_token

    token = create_queue_token("user-1", "event-1", 5)
    payload = decode_token(token)

    assert payload["sub"] == "user-1"
    assert payload["event_id"] == "event-1"
    assert payload["position"] == 5
    assert payload["type"] == "queue"

  def test_create_and_decode_access_token(self):
    from src.auth.token import create_access_token, decode_token

    token = create_access_token("user-1", "event-1")
    payload = decode_token(token)

    assert payload["sub"] == "user-1"
    assert payload["type"] == "access"

  def test_decode_invalid_token_raises(self):
    from src.auth.token import decode_token

    with pytest.raises(ValueError):
      decode_token("invalid.token.here")
