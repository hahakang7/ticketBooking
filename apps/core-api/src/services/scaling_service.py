"""
LSTM 예측 기반 선제 스케일링 서비스.

동작 원리:
  - 60초마다 DB에서 "곧 열릴 이벤트" (오픈 1~15분 전) 를 조회
  - LSTM으로 예상 RPS → 필요 Pod 수 계산
  - core-api-hpa 의 minReplicas를 올려 선제 스케일업
  - 오픈 후 10분이 지나면 minReplicas를 원래 값(2)으로 복원

발표 시연 포인트:
  - HPA만 사용 시: 부하 급증 → CPU 증가 → 30~60초 후 파드 추가 → 그 동안 레이턴시 스파이크
  - 예측 스케일링 사용 시: 5분 전 선제 증설 → 오픈 순간 파드 이미 준비 → 레이턴시 스파이크 없음
"""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session
from sqlalchemy import text

from src.models.event import Event
from src.services.prediction_service import PredictionService
from src.metrics import predicted_replicas_gauge, prescale_events_total

logger = logging.getLogger("core-api")

# 설정
_PRESCALE_WINDOW_MIN = 15    # 오픈 N분 전부터 스케일업 검토
_PRESCALE_LEAD_MIN   = 5     # 오픈 N분 전에 실제 스케일업 실행
_RESTORE_AFTER_MIN   = 10    # 오픈 후 N분 뒤 minReplicas 복원
_DEFAULT_MIN_REPLICAS = 2    # 평시 HPA minReplicas
_HPA_NAME            = "core-api-hpa"
_NAMESPACE           = "ticket-system"

# 이미 스케일업한 이벤트 추적 (프로세스 내 메모리)
_scaled_events: dict[str, datetime] = {}   # event_id → open_at


def _get_k8s_autoscaling():
    """k8s 클라이언트 반환. 클러스터 밖이면 None."""
    try:
        from kubernetes import client, config
        try:
            config.load_incluster_config()
        except Exception:
            config.load_kube_config()
        return client.AutoscalingV2Api()
    except Exception as e:
        logger.debug(f"[PreScale] k8s 클라이언트 초기화 실패 (로컬 환경): {e}")
        return None


def _patch_hpa_min_replicas(replicas: int) -> bool:
    """core-api-hpa 의 minReplicas를 replicas로 변경. 성공 여부 반환."""
    api = _get_k8s_autoscaling()
    if api is None:
        return False
    try:
        api.patch_namespaced_horizontal_pod_autoscaler(
            name=_HPA_NAME,
            namespace=_NAMESPACE,
            body={"spec": {"minReplicas": replicas}},
        )
        logger.info(f"[PreScale] HPA minReplicas → {replicas}")
        return True
    except Exception as e:
        logger.error(f"[PreScale] HPA 패치 실패: {e}")
        return False


def run_prescale_check(db: Session, r) -> None:
    """
    곧 열릴 이벤트를 찾아 선제 스케일업을 수행한다.
    main.py 의 백그라운드 루프에서 60초마다 호출.
    """
    now = datetime.now(timezone.utc)
    window_start = now + timedelta(minutes=_PRESCALE_LEAD_MIN)
    window_end   = now + timedelta(minutes=_PRESCALE_WINDOW_MIN)

    # 1. 스케일업 대상 이벤트 조회 (오픈 5~15분 후)
    upcoming: list[Event] = (
        db.query(Event)
        .filter(Event.start_at >= window_start, Event.start_at <= window_end)
        .all()
    )

    for event in upcoming:
        event_id = str(event.event_id)
        if event_id in _scaled_events:
            continue  # 이미 처리한 이벤트

        # 2. LSTM 예측
        svc = PredictionService(db, r)
        plan = svc.get_resource_plan(event_id)
        recommended = plan.get("recommended_replicas", _DEFAULT_MIN_REPLICAS)
        peak_rps    = plan.get("peak_rps", 0.0)

        logger.info(
            f"[PreScale] 이벤트 '{event.name}' 오픈 예정 "
            f"({(event.start_at.replace(tzinfo=timezone.utc) - now).seconds // 60}분 후) "
            f"→ 예측 peak {peak_rps:.0f} RPS, 필요 Pod {recommended}개"
        )

        # 3. HPA minReplicas 상향 (maxReplicas 초과 방지)
        recommended = min(recommended, 30)  # HPA maxReplicas 상한만 적용
        if _patch_hpa_min_replicas(recommended):
            _scaled_events[event_id] = event.start_at.replace(tzinfo=timezone.utc)
            predicted_replicas_gauge.set(recommended)
            prescale_events_total.inc()

    # 4. 오픈 후 복원 대상 확인
    to_restore = [
        eid for eid, open_at in _scaled_events.items()
        if now >= open_at + timedelta(minutes=_RESTORE_AFTER_MIN)
    ]
    for eid in to_restore:
        logger.info(f"[PreScale] 이벤트 {eid} 오픈 후 {_RESTORE_AFTER_MIN}분 경과 → minReplicas 복원")
        _patch_hpa_min_replicas(_DEFAULT_MIN_REPLICAS)
        predicted_replicas_gauge.set(_DEFAULT_MIN_REPLICAS)
        del _scaled_events[eid]
