import json
import logging
from datetime import datetime, timedelta

import redis as redis_lib
from sqlalchemy.orm import Session

from src.models.event import Event
from src.prediction import ResourceCalculator, TrafficForecaster

logger = logging.getLogger("core-api")

_forecaster_instance = None
_calculator_instance = None


def _get_forecaster() -> TrafficForecaster:
  global _forecaster_instance
  if _forecaster_instance is None:
    logger.info("[Prediction] Initializing TrafficForecaster (LSTM model)...")
    _forecaster_instance = TrafficForecaster()
    logger.info("[Prediction] TrafficForecaster initialized")
  return _forecaster_instance


def _get_calculator() -> ResourceCalculator:
  global _calculator_instance
  if _calculator_instance is None:
    _calculator_instance = ResourceCalculator(rps_per_pod=250, cpu_request_m=500, memory_request_mi=512)
  return _calculator_instance


class PredictionService:
  def __init__(self, db: Session, r: redis_lib.Redis):
    self.db = db
    self.r = r

  def get_resource_plan(self, event_id: str) -> dict:
    """
    예측 모델 기반 리소스 계획 조회
    - Redis 캐시 확인 (TTL 5분)
    - Event 조회 → TrafficForecaster → ResourceCalculator
    - 결과 캐싱 후 반환

    반환: {"recommended_replicas": int, "peak_rps": float}
    """
    cache_key = f"prediction:resource_plan:{event_id}"

    # 1. Redis 캐시 확인
    cached = self.r.get(cache_key)
    if cached:
      logger.info(f"[Prediction] Cache hit for event={event_id}")
      return json.loads(cached)

    # 2. Event 조회
    event = self.db.query(Event).filter(Event.event_id == event_id).first()
    if not event:
      logger.warning(f"[Prediction] Event {event_id} not found, using mock values")
      return {"recommended_replicas": 10, "peak_rps": 0.0}

    try:
      # 3. TrafficForecaster 호출
      forecaster = _get_forecaster()
      event_scale = min(event.total_seats / 50000, 1.0)
      points = forecaster.predict(
        event_id=str(event_id),
        target_datetime=event.start_at,
        horizon_hours=6,
        granularity_minutes=15,
        event_scale=event_scale,
        mc_samples=40,
      )

      # 4. ResourceCalculator 호출
      calculator = _get_calculator()
      windows = calculator.calculate(
        event_id=str(event_id),
        forecast=points,
        safety_factor=1.5,
      )

      # 5. 피크 윈도우에서 권고값 추출 (windows[0]은 T-3h로 RPS≈0)
      if windows:
        recommended_replicas = max(w.recommended_replicas for w in windows)
        peak_rps = max([p.predicted_rps for p in points], default=0.0)
      else:
        recommended_replicas = 10
        peak_rps = 0.0

      result = {"recommended_replicas": recommended_replicas, "peak_rps": peak_rps}

      # 6. Redis 캐시 저장 (TTL 5분)
      self.r.setex(cache_key, 300, json.dumps(result))

      logger.info(f"[Prediction] event={event_id} → recommend {recommended_replicas} replicas (peak_rps={peak_rps:.2f})")
      return result

    except Exception as e:
      logger.error(f"[Prediction] Error calculating resource plan for event={event_id}: {e}", exc_info=True)
      return {"recommended_replicas": 10, "peak_rps": 0.0}

  def get_forecast(self, event_id: str) -> dict:
    """
    LSTM 기반 트래픽 예측 (피크 RPS + 피크 시각)

    반환: {"expected_users": int, "peak_time": str}
    - expected_users: 피크 RPS (동시 접속 규모 근사값)
    - peak_time: 피크 발생 시각 (HH:MM 형식)
    """
    cache_key = f"prediction:forecast:{event_id}"

    cached = self.r.get(cache_key)
    if cached:
      logger.info(f"[Prediction] Forecast cache hit for event={event_id}")
      return json.loads(cached)

    event = self.db.query(Event).filter(Event.event_id == event_id).first()
    if not event:
      logger.warning(f"[Prediction] Event {event_id} not found, using mock forecast")
      return {"expected_users": 5000, "peak_time": "14:00"}

    try:
      forecaster = _get_forecaster()
      event_scale = min(event.total_seats / 50000, 1.0)
      points = forecaster.predict(
        event_id=str(event_id),
        target_datetime=event.start_at,
        horizon_hours=6,
        granularity_minutes=15,
        event_scale=event_scale,
        mc_samples=10,  # forecast는 피크값만 필요 → 샘플 수 줄여 응답 속도 개선
      )

      if not points:
        return {"expected_users": 5000, "peak_time": "14:00"}

      peak_point = max(points, key=lambda p: p.predicted_rps)
      result = {
        "expected_users": round(peak_point.predicted_rps),
        "peak_time": peak_point.timestamp.strftime("%H:%M"),
      }

      self.r.setex(cache_key, 300, json.dumps(result))
      logger.info(f"[Prediction] Forecast event={event_id} → peak {result['expected_users']} RPS at {result['peak_time']}")
      return result

    except Exception as e:
      logger.error(f"[Prediction] Forecast error for event={event_id}: {e}", exc_info=True)
      return {"expected_users": 5000, "peak_time": "14:00"}
