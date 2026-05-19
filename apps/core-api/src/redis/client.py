import redis
from src.config import get_settings

settings = get_settings()

# Redis 클라이언트 생성 (연결 풀링)
redis_client = redis.from_url(
  settings.redis_url,
  decode_responses=True,
  socket_connect_timeout=5,
  socket_keepalive=True,
  health_check_interval=30,
)
