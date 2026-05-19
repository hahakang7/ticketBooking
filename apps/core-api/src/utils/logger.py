import logging
from src.config import get_settings

settings = get_settings()

# 로깅 설정
logger = logging.getLogger("core-api")
logger.setLevel(settings.log_level.upper())

# 스트림 핸들러
handler = logging.StreamHandler()
handler.setLevel(settings.log_level.upper())

# 포맷터
formatter = logging.Formatter(
  "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
handler.setFormatter(formatter)

if not logger.handlers:
  logger.addHandler(handler)
