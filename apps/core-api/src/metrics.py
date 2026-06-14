from prometheus_client import Counter, Histogram, Gauge

duplicate_reservation_total = Counter(
    'duplicate_reservation_total',
    'Total duplicate reservation attempts blocked'
)

reservation_duration_seconds = Histogram(
    'reservation_duration_seconds',
    'Time spent processing reservations',
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5]
)

# 예측 스케일링 메트릭
predicted_replicas_gauge = Gauge(
    'predicted_replicas',
    'LSTM predicted required Pod count for upcoming event'
)

prescale_events_total = Counter(
    'prescale_events_total',
    'Number of predictive pre-scale-up events triggered'
)