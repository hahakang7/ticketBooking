"""
팀원 1 ↔ 팀원 2 공유 데이터 타입.
팀원 2는 이 타입을 Pydantic 스키마로 변환하여 API 응답에 사용.
"""
from dataclasses import dataclass
from datetime import datetime


@dataclass
class ForecastPoint:
    """단일 시간 지점의 RPS 예측값."""
    timestamp: datetime
    predicted_rps: float
    lower_bound: float   # 90% 신뢰구간 하한
    upper_bound: float   # 90% 신뢰구간 상한


@dataclass
class ScalingWindow:
    """K8s 스케일링 적용 시간 구간."""
    from_datetime: datetime
    to_datetime: datetime
    recommended_replicas: int
    cpu_request_m: int        # 파드당 CPU (millicores)
    memory_request_mi: int    # 파드당 메모리 (MiB)