"""
ScalerService 단위 테스트.
"""
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
from sqlalchemy.orm import Session

from src.services.scaler_service import ScalerService, SAFETY_REPLICAS
from src.models.event import Event


@pytest.fixture
def mock_db():
  """Mock SQLAlchemy Session."""
  return MagicMock(spec=Session)


@pytest.fixture
def mock_pred_svc():
  """Mock PredictionService."""
  svc = MagicMock()
  svc.get_resource_plan = MagicMock()
  return svc


@pytest.fixture
def scaler_svc(mock_db, mock_pred_svc):
  """ScalerService instance with mocks."""
  return ScalerService(mock_db, mock_pred_svc)


class TestGetUpcomingEventIds:
  """test get_upcoming_event_ids()"""

  def test_find_events_within_lookahead(self, scaler_svc, mock_db):
    """이벤트가 60분 이내면 반환."""
    now = datetime.now(timezone.utc)
    in_30min = now + timedelta(minutes=30)

    event1 = MagicMock()
    event1.event_id = "evt-1"
    event1.start_at = in_30min

    mock_db.query.return_value.filter.return_value.all.return_value = [event1]

    result = scaler_svc.get_upcoming_event_ids()
    assert result == ["evt-1"]
    mock_db.query.assert_called_once()

  def test_no_upcoming_events(self, scaler_svc, mock_db):
    """60분 이내 이벤트가 없으면 빈 리스트."""
    mock_db.query.return_value.filter.return_value.all.return_value = []

    result = scaler_svc.get_upcoming_event_ids()
    assert result == []


class TestPredictMaxReplicas:
  """test predict_max_replicas()"""

  def test_single_event_prediction(self, scaler_svc, mock_pred_svc):
    """단일 이벤트 예측 반환."""
    mock_pred_svc.get_resource_plan.return_value = {
        "recommended_replicas": 21,
        "peak_rps": 3000.0,
    }

    result = scaler_svc.predict_max_replicas(["evt-1"])
    assert result == 21
    mock_pred_svc.get_resource_plan.assert_called_once_with("evt-1")

  def test_multiple_events_max(self, scaler_svc, mock_pred_svc):
    """여러 이벤트 중 최댓값 반환."""
    mock_pred_svc.get_resource_plan.side_effect = [
        {"recommended_replicas": 15, "peak_rps": 2000.0},
        {"recommended_replicas": 25, "peak_rps": 3500.0},
        {"recommended_replicas": 10, "peak_rps": 1500.0},
    ]

    result = scaler_svc.predict_max_replicas(["evt-1", "evt-2", "evt-3"])
    assert result == 25

  def test_prediction_failure_fallback(self, scaler_svc, mock_pred_svc):
    """예측 실패 시 SAFETY_REPLICAS 반환."""
    mock_pred_svc.get_resource_plan.side_effect = Exception("API error")

    result = scaler_svc.predict_max_replicas(["evt-1"])
    assert result == SAFETY_REPLICAS

  def test_empty_event_list(self, scaler_svc):
    """빈 이벤트 리스트 → SAFETY_REPLICAS."""
    result = scaler_svc.predict_max_replicas([])
    assert result == SAFETY_REPLICAS


class TestScaleIfNeeded:
  """test scale_if_needed()"""

  def test_no_k8s_environment(self, scaler_svc):
    """K8s 외부 환경 → 스케일링 스킵."""
    scaler_svc._get_api_client = MagicMock(return_value=None)

    # 예외 없이 조용히 반환
    scaler_svc.scale_if_needed(21)
    # _get_api_client는 호출되지만 이후는 진행 안 됨

  def test_scale_up_when_needed(self, scaler_svc):
    """현재 < 목표 → 스케일 업."""
    mock_api = MagicMock()
    mock_scale = MagicMock()
    mock_scale.spec.replicas = 2

    mock_api.read_namespaced_deployment_scale.return_value = mock_scale
    scaler_svc._get_api_client = MagicMock(return_value=mock_api)

    scaler_svc.scale_if_needed(21)

    # patch 호출됨
    mock_api.patch_namespaced_deployment_scale.assert_called_once()

  def test_no_scale_when_current_sufficient(self, scaler_svc):
    """현재 >= 목표 → 스케일링 안 함."""
    mock_api = MagicMock()
    mock_scale = MagicMock()
    mock_scale.spec.replicas = 25  # 이미 충분함

    mock_api.read_namespaced_deployment_scale.return_value = mock_scale
    scaler_svc._get_api_client = MagicMock(return_value=mock_api)

    scaler_svc.scale_if_needed(21)

    # patch 호출 안 됨
    mock_api.patch_namespaced_deployment_scale.assert_not_called()

  def test_k8s_api_error_handled(self, scaler_svc):
    """K8s API 에러 → 로그만 기록, 예외 없음."""
    from kubernetes.client.rest import ApiException

    mock_api = MagicMock()
    mock_api.read_namespaced_deployment_scale.side_effect = ApiException(500, "API error")
    scaler_svc._get_api_client = MagicMock(return_value=mock_api)

    # 예외 발생 안 함
    scaler_svc.scale_if_needed(21)


class TestIntegration:
  """End-to-end flow test."""

  def test_full_scaling_flow(self, scaler_svc, mock_db, mock_pred_svc):
    """전체 흐름: 이벤트 조회 → 예측 → 스케일링."""
    now = datetime.now(timezone.utc)
    in_30min = now + timedelta(minutes=30)

    event = MagicMock()
    event.event_id = "evt-1"
    mock_db.query.return_value.filter.return_value.all.return_value = [event]

    mock_pred_svc.get_resource_plan.return_value = {
        "recommended_replicas": 21,
        "peak_rps": 3000.0,
    }

    mock_api = MagicMock()
    mock_scale = MagicMock()
    mock_scale.spec.replicas = 2
    mock_api.read_namespaced_deployment_scale.return_value = mock_scale
    scaler_svc._get_api_client = MagicMock(return_value=mock_api)

    # 전체 흐름 실행
    event_ids = scaler_svc.get_upcoming_event_ids()
    assert event_ids == ["evt-1"]

    target = scaler_svc.predict_max_replicas(event_ids)
    assert target == 21

    scaler_svc.scale_if_needed(target)
    mock_api.patch_namespaced_deployment_scale.assert_called_once()