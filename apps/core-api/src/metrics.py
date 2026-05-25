from prometheus_client import Counter, Histogram

duplicate_reservation_total = Counter(
    'duplicate_reservation_total',
    'Total duplicate reservation attempts blocked'
)

reservation_duration_seconds = Histogram(
    'reservation_duration_seconds',
    'Time spent processing reservations',
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5]
)