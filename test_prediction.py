"""
새 모델로 예측 테스트 — step 38(9시 30분)에서 호출 시나리오
"""
import sys
import os
sys.path.insert(0, "D:\distributeSys\apps\core-api")

from datetime import datetime
from src.prediction.traffic_forecaster import TrafficForecaster

forecaster = TrafficForecaster()

# 오전 9시 30분(step 38)에 API 호출한다고 가정
# target_datetime은 오전 0시(시퀀스 시작점)
target_dt = datetime(2026, 6, 15, 0, 0, 0)
event_scale = 0.7

print("=" * 70)
print("예측 테스트: 6시간 horizon, 15분 granularity")
print(f"이벤트 규모: {event_scale}")
print("=" * 70)

points = forecaster.predict(
    event_id="test-event-1",
    target_datetime=target_dt,
    horizon_hours=6,
    granularity_minutes=15,
    event_scale=event_scale,
    mc_samples=40,
)

print("\n[주요 시점 예측 결과]")
print(f"{'시각':<10} {'예측 RPS':<12} {'하한':<12} {'상한':<12}")
print("-" * 50)

for i, point in enumerate(points):
    step = i
    hour = step * 15 // 60
    minute = (step * 15) % 60
    time_str = f"{hour:02d}:{minute:02d}"

    rps = point.predicted_rps
    lower = point.lower_bound
    upper = point.upper_bound

    print(f"{time_str:<10} {rps:<12.0f} {lower:<12.0f} {upper:<12.0f}")

# 피크 찾기
peak_idx = max(range(len(points)), key=lambda i: points[i].predicted_rps)
peak_point = points[peak_idx]
peak_step = peak_idx
peak_hour = peak_step * 15 // 60
peak_minute = (peak_step * 15) % 60

print("\n" + "=" * 70)
print(f"[피크 시점] {peak_hour:02d}:{peak_minute:02d} (step {peak_step})")
print(f"  예측 RPS: {peak_point.predicted_rps:.0f}")
print(f"  90% 신뢰구간: [{peak_point.lower_bound:.0f}, {peak_point.upper_bound:.0f}]")
print("=" * 70)
