from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import QueuePool

from src.config import get_settings

settings = get_settings()

# SQLAlchemy 엔진 생성
engine = create_engine(
  settings.database_url,
  poolclass=QueuePool,
  pool_size=10,
  max_overflow=20,
  pool_pre_ping=True,  # 연결 상태 확인
  echo=settings.debug,
)

# 세션 팩토리
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ORM 기본 클래스
Base = declarative_base()
