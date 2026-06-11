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

      # 5. 첫 번째 스케일링 윈도우에서 권고값 추출
      if windows:
        recommended_replicas = windows[0].recommended_replicas
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
