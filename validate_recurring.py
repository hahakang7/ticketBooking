#!/usr/bin/env python
from datetime import datetime
from src.prediction.traffic_forecaster import TrafficForecaster

f = TrafficForecaster()

# 화요일 10시 오픈 (event_scale=0.7)
pts_tue = f.predict('tue', datetime(2026, 6, 17, 10, 0), 6, 15, 0.7)
peak_tue = max(p.predicted_rps for p in pts_tue)
time_tue = [p.timestamp for p in pts_tue if p.predicted_rps == peak_tue][0]

# 목요일 10시 오픈 (동일한 event_scale=0.7)
pts_thu = f.predict('thu', datetime(2026, 6, 19, 10, 0), 6, 15, 0.7)
peak_thu = max(p.predicted_rps for p in pts_thu)
time_thu = [p.timestamp for p in pts_thu if p.predicted_rps == peak_thu][0]

# 정기 이벤트 일관성 비교
diff_pct = abs(peak_tue - peak_thu) / peak_tue * 100

print("=== 매주 정기 이벤트 (화/목 10시) 일관성 검증 ===\n")
print(f"화요일 피크: {peak_tue:.0f} RPS @ {time_tue.strftime('%H:%M')}")
print(f"목요일 피크: {peak_thu:.0f} RPS @ {time_thu.strftime('%H:%M')}")
print(f"\n차이: {diff_pct:.2f}% {'✓ 일관성 양호' if diff_pct < 2 else '⚠ 편차 주의'}\n")

# 상세 곡선 비교
print("시각별 RPS 예측:")
print("\n       화요일        목요일")
for i in range(len(pts_tue)):
    t = pts_tue[i].timestamp.strftime('%H:%M')
    rps_tue = pts_tue[i].predicted_rps
    rps_thu = pts_thu[i].predicted_rps
    marker = " ← PEAK" if rps_tue == peak_tue else ""
    print(f"{t}: {rps_tue:>7.0f} RPS  {rps_thu:>7.0f} RPS{marker}")
