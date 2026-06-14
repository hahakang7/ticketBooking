"""
예측형 오토스케일링: 예측 기반 사전 Pod 증설.

이벤트 시작 60분 이내 → 예측 호출 → K8s replicas 패치
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from kubernetes import client, config
from kubernetes.client.rest import ApiException
from sqlalchemy.orm import Session

from src.models.event import Event
from src.services.prediction_service import PredictionService

logger = logging.getLogger(__name__)

LOOKAHEAD_MIN = 60  # 60분 이내 시작 이벤트 대상
SAFETY_REPLICAS = 3  # 예측 실패 시 최소값


class ScalerService:
  """K8s deployment 자동 스케일링."""

  def __init__(
      self,
      db: Session,
      prediction_svc: PredictionService,
  ):
    self.db = db
    self.pred_svc = prediction_svc
    self.namespace = os.getenv("K8S_NAMESPACE", "default")
    self.deployment = os.getenv("K8S_DEPLOYMENT_NAME", "core-api")
    self._api_client: Optional[client.AppsV1Api] = None

  def _get_api_client(self) -> Optional[client.AppsV1Api]:
    """K8s API 클라이언트 초기화 (in-cluster 감지)."""
    if self._api_client is not None:
      return self._api_client

    try:
      config.load_incluster_config()
      self._api_client = client.AppsV1Api()
      logger.info("K8s in-cluster 설정 로드 완료")
      return self._api_client
    except config.ConfigException:
      logger.debug("K8s 외부 환경 — 스케일링 API 비활성화")
      return None

  def get_upcoming_event_ids(self) -> list[str]:
    """
    start_at이 NOW ~ NOW+LOOKAHEAD_MIN 사이인 이벤트 ID 목록 반환.
    """
    now = datetime.now(timezone.utc)
    lookahead = now + timedelta(minutes=LOOKAHEAD_MIN)

    events = self.db.query(Event).filter(
        Event.start_at >= now,
        Event.start_at <= lookahead,
    ).all()

    ids = [str(e.event_id) for e in events]
    logger.info(f"예정 이벤트 {len(ids)}건 발견 (다음 {LOOKAHEAD_MIN}분)")
    return ids

  def predict_max_replicas(self, event_ids: list[str]) -> int:
    """
    여러 이벤트의 예측값 중 최대 replica 수 반환.
    예측 실패 시 현재값 조회 후 반환 (또는 SAFETY_REPLICAS).
    """
    max_replicas = SAFETY_REPLICAS

    for event_id in event_ids:
      try:
        plan = self.pred_svc.get_resource_plan(event_id)
        replicas = plan.get("recommended_replicas", SAFETY_REPLICAS)
        max_replicas = max(max_replicas, replicas)
        logger.debug(f"이벤트 {event_id}: 예측 {replicas} Pod")
      except Exception as e:
        logger.error(f"이벤트 {event_id} 예측 실패: {e}")

    logger.info(f"목표 replica: {max_replicas}")
    return max_replicas

  def get_current_replicas(self) -> Optional[int]:
    """현재 deployment replicas 조회."""
    api = self._get_api_client()
    if api is None:
      return None

    try:
      scale = api.read_namespaced_deployment_scale(
          self.deployment,
          self.namespace,
      )
      current = scale.spec.replicas
      logger.debug(f"현재 replicas: {current}")
      return current
    except ApiException as e:
      logger.error(f"deployment scale 조회 실패: {e}")
      return None

  def scale_if_needed(self, target_replicas: int) -> None:
    """
    현재 replicas < target일 때만 증설.
    스케일 다운은 HPA에 위임 (scale-down 안정화 정책 존중).
    """
    api = self._get_api_client()
    if api is None:
      logger.info("K8s 외부 환경 — 스케일링 건너뜀")
      return

    current = self.get_current_replicas()
    if current is None:
      logger.warning("현재 replicas를 얻지 못함 — 스케일링 건너뜀")
      return

    if target_replicas > current:
      try:
        scale = client.V1Scale(spec=client.V1ScaleSpec(replicas=target_replicas))
        api.patch_namespaced_deployment_scale(
            self.deployment,
            self.namespace,
            scale,
        )
        logger.info(f"스케일 증설: {current} → {target_replicas} Pod")
      except ApiException as e:
        logger.error(f"deployment 패치 실패: {e}")
    else:
      logger.debug(
          f"스케일 유지: 현재 {current} >= 목표 {target_replicas} Pod"
      )
