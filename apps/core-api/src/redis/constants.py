# Redis 키 네이밍 규칙: {domain}:{event_id}:{identifier}:{optional_suffix}

# 대기열 (Phase 1)
def QUEUE_KEY(event_id: str) -> str:
  return f"queue:{event_id}"

# 좌석 점유 (Phase 2)
def SEAT_HOLD_KEY(event_id: str, seat_id: str) -> str:
  return f"seat:{event_id}:{seat_id}:hold"

# 좌석 상태
def SEAT_STATUS_KEY(event_id: str) -> str:
  return f"seat:{event_id}:status"

# 분산 락 (Phase 3)
def LOCK_RESERVATION_KEY(event_id: str) -> str:
  return f"lock:reservation:{event_id}"

# 이벤트 캐시
def CACHE_EVENT_KEY(event_id: str) -> str:
  return f"cache:event:{event_id}"

# TTL (초)
QUEUE_TTL = 3600      # 1시간
LOCK_TTL = 300        # 5분
CACHE_TTL = 600       # 10분
SEAT_HOLD_TTL = 300   # 5분
SEAT_CACHE_TTL = 10   # 10초 — 초기 로드 버스트 방어용 (WebSocket이 실시간 업데이트 담당)

# 좌석 목록 캐시
def CACHE_SEATS_KEY(event_id: str) -> str:
  return f"cache:seats:{event_id}"

# 이용 가능한 좌석 캐시
def CACHE_AVAILABLE_SEATS_KEY(event_id: str) -> str:
  return f"cache:available-seats:{event_id}"
