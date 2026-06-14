import pytest
import logging
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi.testclient import TestClient
import fakeredis
from src.redis.queue import add_to_queue, get_position, consume_from_queue_atomic

logger = logging.getLogger("core-api")


class TestQueueService:
  def test_join_queue_new_user(self, mock_redis):
    """신규 사용자 대기열 참가: ZADD 호출 후 position 1 반환"""
    logger.info("신규 사용자: ZADD 호출 후 position=1 반환 확인")
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
    logger.info("기존 대기 사용자: ZADD 없이 현재 순번 그대로 반환 확인")
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
    logger.info("ZRANK 반환값에 +1 보정해 1-based position 반환 확인")
    from src.services.queue_service import QueueService

    mock_redis.zrank.return_value = 4
    service = QueueService(mock_redis)

    pos = service.get_position("user-1", "event-1")
    assert pos == 5

  def test_get_position_not_exists(self, mock_redis):
    """대기열에 없는 사용자 순번 조회 → None"""
    logger.info("대기열에 없는 사용자 → position None 반환 확인")
    from src.services.queue_service import QueueService

    mock_redis.zrank.return_value = None
    service = QueueService(mock_redis)

    pos = service.get_position("user-1", "event-1")
    assert pos is None

  def test_leave_queue(self, mock_redis):
    """대기열 이탈: ZREM 호출 확인"""
    logger.info("ZREM 호출로 대기열에서 정상 제거 확인")
    from src.services.queue_service import QueueService

    mock_redis.zrem.return_value = 1
    service = QueueService(mock_redis)

    result = service.leave_queue("user-1", "event-1")
    mock_redis.zrem.assert_called_once()
    assert result is True

  def test_consume_token_when_position_1(self, mock_redis):
    """position=1 소비: Lua eval 호출 및 access_token 반환 (원자성)"""
    logger.info("position=1: Lua eval 성공 → access_token 발급 확인")
    from src.services.queue_service import QueueService

    mock_redis.eval.return_value = 1
    service = QueueService(mock_redis)

    token = service.consume_token("user-1", "event-1")
    assert token is not None
    assert isinstance(token, str)
    mock_redis.eval.assert_called_once()

  def test_consume_token_already_consumed(self, mock_redis):
    """이미 다른 요청이 consume한 경우 → None (Lua eval 반환 0)"""
    logger.info("이미 consume된 경우: Lua eval=0 → None 반환 확인")
    from src.services.queue_service import QueueService

    mock_redis.eval.return_value = 0
    service = QueueService(mock_redis)

    token = service.consume_token("user-1", "event-1")
    assert token is None

  def test_consume_token_not_position_1(self, mock_redis):
    """position≠1이면 consume 실패 → None (Lua eval 반환 0)"""
    logger.info("position≠1인 경우: consume 실패 → None 반환 확인")
    from src.services.queue_service import QueueService

    mock_redis.eval.return_value = 0
    service = QueueService(mock_redis)

    token = service.consume_token("user-1", "event-1")
    assert token is None


class TestQueueAPI:
  def test_post_join_success(self, app_client):
    logger.info("POST /api/queue/join: 200 + position=1 + queue_token 포함 확인")
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

  def test_post_join_rate_limit_exceeded(self, app_client):
    """Rate limiting: 1초 내 2번째 요청 → 429"""
    logger.info("POST /api/queue/join: 1초 초과 시 429 + retry_after 반환 확인")
    client, mock_redis = app_client
    mock_redis.reset_mock()
    mock_redis.zrank.side_effect = [None, 0]
    mock_redis.zcard.return_value = 1
    mock_redis.incr.return_value = 2
    mock_redis.expire.return_value = True

    response = client.post("/api/queue/join", json={"user_id": "u1", "event_id": "e1"})
    assert response.status_code == 429
    data = response.json()
    assert data["code"] == 429
    assert "retry_after" in data["data"]

  def test_get_status_without_auth(self, app_client):
    """queue_token 없이 /status 접근 → 401"""
    logger.info("GET /api/queue/status: 토큰 없이 접근 → 401 반환 확인")
    client, mock_redis = app_client
    response = client.get("/api/queue/status?user_id=u1&event_id=e1")
    assert response.status_code == 401

  def test_get_status_with_valid_queue_token(self, app_client):
    """queue_token으로 /status 접근 → 성공"""
    logger.info("GET /api/queue/status: queue_token 인증 → 200 + position/total 확인")
    from src.auth.token import create_queue_token

    client, mock_redis = app_client
    token = create_queue_token("u1", "e1", 5)
    mock_redis.zrank.return_value = 4
    mock_redis.zcard.return_value = 10

    response = client.get(
      "/api/queue/status?user_id=u1&event_id=e1",
      headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["data"]["position"] == 5
    assert data["data"]["total"] == 10

  def test_get_status_user_mismatch(self, app_client):
    """query user_id와 token user_id 불일치 → 403"""
    logger.info("GET /api/queue/status: 토큰 user_id ≠ query user_id → 403 반환 확인")
    from src.auth.token import create_queue_token

    client, mock_redis = app_client
    token = create_queue_token("u1", "e1", 5)

    response = client.get(
      "/api/queue/status?user_id=u2&event_id=e1",
      headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403

  def test_get_sse_without_auth(self, app_client):
    """queue_token 없이 SSE 접근 → 401"""
    logger.info("GET /api/queue/sse: 토큰 없이 접근 → 401 반환 확인")
    client, mock_redis = app_client
    response = client.get("/api/queue/sse?user_id=u1&event_id=e1")
    assert response.status_code == 401

  def test_get_sse_streaming_headers(self, app_client):
    """SSE 엔드포인트 응답 헤더 검증"""
    logger.info("GET /api/queue/sse: Content-Type, Cache-Control, X-Accel-Buffering 헤더 검증")
    from src.auth.token import create_queue_token

    client, mock_redis = app_client
    token = create_queue_token("u1", "e1", 2)
    mock_redis.zrank.return_value = 1
    mock_redis.zcard.return_value = 5

    response = client.get(
      "/api/queue/sse?user_id=u1&event_id=e1",
      headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert "text/event-stream" in response.headers.get("content-type", "")
    assert response.headers.get("cache-control") == "no-cache"

  def test_delete_leave_without_auth(self, app_client):
    """queue_token 없이 /leave 접근 → 401"""
    logger.info("DELETE /api/queue/leave: 토큰 없이 접근 → 401 반환 확인")
    client, mock_redis = app_client
    response = client.delete("/api/queue/leave?user_id=u1&event_id=e1")
    assert response.status_code == 401

  def test_delete_leave_user_mismatch(self, app_client):
    """query user_id와 token user_id 불일치 → 403"""
    logger.info("DELETE /api/queue/leave: 토큰 user_id ≠ query user_id → 403 반환 확인")
    from src.auth.token import create_queue_token

    client, mock_redis = app_client
    token = create_queue_token("u1", "e1", 5)

    response = client.delete(
      "/api/queue/leave?user_id=u2&event_id=e1",
      headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403

  def test_delete_leave_success(self, app_client):
    """대기열 이탈 성공: queue_token + user_id 일치 + 대기열에 존재"""
    logger.info("DELETE /api/queue/leave: 정상 토큰 + 대기열에 있음 → 200 확인")
    from src.auth.token import create_queue_token

    client, mock_redis = app_client
    token = create_queue_token("u1", "e1", 5)
    mock_redis.zrem.return_value = 1  # 대기열에서 제거됨

    response = client.delete(
      "/api/queue/leave?user_id=u1&event_id=e1",
      headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 200
    assert data["message"] == "success"
    mock_redis.zrem.assert_called_once()

  def test_delete_leave_not_in_queue(self, app_client):
    """대기열에 없는 사용자: queue_token 유효하지만 zrem 반환 0"""
    logger.info("DELETE /api/queue/leave: 대기열에 없음 → 404 반환 확인")
    from src.auth.token import create_queue_token

    client, mock_redis = app_client
    token = create_queue_token("u1", "e1", 5)
    mock_redis.zrem.return_value = 0  # 대기열에 없음

    response = client.delete(
      "/api/queue/leave?user_id=u1&event_id=e1",
      headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 404
    data = response.json()
    assert data["code"] == 404


class TestTokenAuth:
  def test_create_and_decode_queue_token(self):
    logger.info("queue_token 생성 및 디코딩: sub/event_id/position/type 클레임 검증")
    from src.auth.token import create_queue_token, decode_token

    token = create_queue_token("user-1", "event-1", 5)
    payload = decode_token(token)

    assert payload["sub"] == "user-1"
    assert payload["event_id"] == "event-1"
    assert payload["position"] == 5
    assert payload["type"] == "queue"

  def test_create_and_decode_access_token(self):
    logger.info("access_token 생성 및 디코딩: type=access 클레임 검증")
    from src.auth.token import create_access_token, decode_token

    token = create_access_token("user-1", "event-1")
    payload = decode_token(token)

    assert payload["sub"] == "user-1"
    assert payload["type"] == "access"

  def test_decode_invalid_token_raises(self):
    logger.info("잘못된 토큰 디코딩 시 ValueError 발생 확인")
    from src.auth.token import decode_token

    with pytest.raises(ValueError):
      decode_token("invalid.token.here")


class TestQueueIntegration:
  """fakeredis로 실제 Redis 동작 검증 — Lua 스크립트·Sorted Set 포함"""

  @pytest.fixture
  def fake_redis(self):
    return fakeredis.FakeRedis()

  def test_fifo_ordering(self, fake_redis):
    """timestamp 기반 FIFO 순서 보장"""
    logger.info("FIFO 순서: timestamp 빠른 사용자가 낮은 position을 받는지 확인")
    add_to_queue(fake_redis, "evt-1", "user-A", timestamp=1000.0)
    add_to_queue(fake_redis, "evt-1", "user-B", timestamp=2000.0)
    add_to_queue(fake_redis, "evt-1", "user-C", timestamp=3000.0)

    assert get_position(fake_redis, "evt-1", "user-A") == 1
    assert get_position(fake_redis, "evt-1", "user-B") == 2
    assert get_position(fake_redis, "evt-1", "user-C") == 3

  def test_lua_position_2_cannot_consume(self, fake_redis):
    """Lua 스크립트: position=2인 사용자는 consume 실패"""
    logger.info("Lua 스크립트: position=2 사용자의 consume 실패 확인")
    add_to_queue(fake_redis, "evt-1", "user-A", timestamp=1000.0)
    add_to_queue(fake_redis, "evt-1", "user-B", timestamp=2000.0)

    assert consume_from_queue_atomic(fake_redis, "evt-1", "user-B") is False

  def test_lua_position_1_consumes_and_shifts_queue(self, fake_redis):
    """Lua 스크립트: position=1 consume 후 다음 사람이 1번이 됨"""
    logger.info("Lua 스크립트: position=1 consume 후 다음 사용자가 1번으로 이동 확인")
    add_to_queue(fake_redis, "evt-1", "user-A", timestamp=1000.0)
    add_to_queue(fake_redis, "evt-1", "user-B", timestamp=2000.0)

    assert consume_from_queue_atomic(fake_redis, "evt-1", "user-A") is True
    assert get_position(fake_redis, "evt-1", "user-B") == 1

  def test_double_consume_second_fails(self, fake_redis):
    """같은 사용자가 두 번 consume: 두 번째는 반드시 실패"""
    logger.info("원자성: 동일 사용자 두 번째 consume 실패 확인")
    add_to_queue(fake_redis, "evt-1", "user-A", timestamp=1000.0)

    first = consume_from_queue_atomic(fake_redis, "evt-1", "user-A")
    second = consume_from_queue_atomic(fake_redis, "evt-1", "user-A")

    assert first is True
    assert second is False
