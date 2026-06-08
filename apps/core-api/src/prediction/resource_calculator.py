"""
RPS 예측 기반 K8s 스케일링 계획 계산기.

팀원 2 사용법:
    from src.prediction.resource_calculator import ResourceCalculator

    calc = ResourceCalculator()
    windows = calc.calculate(
        event_id="...",
        forecast=points,        # TrafficForecaster.predict() 반환값
        safety_factor=1.5,
    )
"""
import math
import logging
from datetime import datetime
from typing import List

from src.prediction.types import ForecastPoint, ScalingWindow

logger = logging.getLogger(__name__)

# 파드 1개가 처리 가능한 최대 RPS (부하 테스트 기준치)
_DEFAULT_RPS_PER_POD: int = 250

# 파드 스펙 (K8s resource request)
_CPU_REQUEST_M: int = 500       # 0.5 core
_MEMORY_REQUEST_MI: int = 512   # 512 MiB

_MIN_REPLICAS: int = 2
_MAX_REPLICAS: int = 50


class ResourceCalculator:
    """
    트래픽 예측을 K8s 파드 스케일링 계획으로 변환.

    Parameters
    ----------
    rps_per_pod : int
        파드 1개당 처리 가능 RPS. 부하 테스트 결과로 조정할 것.
        (기본값 250 RPS/pod — k6 결과 기준 업데이트 권장)
    cpu_request_m : int
        파드당 CPU 요청량 (millicores)
    memory_request_mi : int
        파드당 메모리 요청량 (MiB)
    """

    def __init__(
        self,
        rps_per_pod: int = _DEFAULT_RPS_PER_POD,
        cpu_request_m: int = _CPU_REQUEST_M,
        memory_request_mi: int = _MEMORY_REQUEST_MI,
    ):
        self.rps_per_pod = rps_per_pod
        self.cpu_request_m = cpu_request_m
        self.memory_request_mi = memory_request_mi

    def calculate(
        self,
        event_id: str,
        forecast: List[ForecastPoint],
        safety_factor: float = 1.5,
    ) -> List[ScalingWindow]:
        """
        Parameters
        ----------
        event_id : str
            이벤트 UUID (로깅용)
        forecast : List[ForecastPoint]
            TrafficForecaster.predict() 반환값
        safety_factor : float
            예측 RPS에 곱하는 안전 계수.
            1.5 → 예측 대비 50% 여유 확보 (기본값 권장)

        Returns
        -------
        List[ScalingWindow]
            연속적으로 동일한 replica 수가 필요한 구간들.
            scale_up_at = windows[0].from_datetime (사전 스케일업 기준)
        """
        if not forecast:
            return []

        replicas_per_step = [
            self._rps_to_replicas(p.upper_bound * safety_factor)
            for p in forecast
        ]

        windows = self._merge_windows(forecast, replicas_per_step)

        logger.debug(
            f"[{event_id}] 스케일링 계획: {len(windows)}개 구간, "
            f"max_replicas={max(w.recommended_replicas for w in windows)}"
        )
        return windows

    # ── 내부 메서드 ──────────────────────────────────────────────────────────────

    def _rps_to_replicas(self, rps: float) -> int:
        """RPS → 파드 수 (min/max 범위 클리핑 포함)."""
        raw = math.ceil(rps / self.rps_per_pod)
        return max(_MIN_REPLICAS, min(_MAX_REPLICAS, raw))

    def _merge_windows(
        self,
        forecast: List[ForecastPoint],
        replicas: List[int],
    ) -> List[ScalingWindow]:
        """
        연속하여 동일한 replica 수인 구간을 하나의 ScalingWindow로 합침.
        스케일다운은 한 단계씩만 허용 (급격한 다운스케일 방지).
        """
        smoothed = self._smooth_scale_down(replicas)

        windows: List[ScalingWindow] = []
        start_idx = 0

        for i in range(1, len(smoothed) + 1):
            if i == len(smoothed) or smoothed[i] != smoothed[start_idx]:
                windows.append(ScalingWindow(
                    from_datetime=forecast[start_idx].timestamp,
                    to_datetime=forecast[i - 1].timestamp,
                    recommended_replicas=smoothed[start_idx],
                    cpu_request_m=self.cpu_request_m,
                    memory_request_mi=self.memory_request_mi,
                ))
                start_idx = i

        return windows

    @staticmethod
    def _smooth_scale_down(replicas: List[int]) -> List[int]:
        """
        스케일다운 시 급격한 감소를 완화.
        연속 구간에서 최대 20% 이상 감소하지 않도록 제한.
        """
        if not replicas:
            return replicas

        smoothed = list(replicas)
        for i in range(1, len(smoothed)):
            max_decrease = max(1, math.floor(smoothed[i - 1] * 0.8))
            smoothed[i] = max(smoothed[i], max_decrease)
        return smoothed