import redis
from src.config import get_settings

settings = get_settings()

# Redis 클라이언트 생성 (연결 풀링)
redis_client = redis.from_url(
  settings.redis_url,
  decode_responses=True,
  max_connections=50,     # 추가: 명시적 커넥션 풀 제어
  socket_connect_timeout=3,
  socket_timeout=3,
  socket_keepalive=True,
  health_check_interval=30,
)
