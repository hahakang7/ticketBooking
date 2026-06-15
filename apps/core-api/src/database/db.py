from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import QueuePool

from src.config import get_settings

settings = get_settings()

# SQLAlchemy 엔진 생성
# 2 workers × 6 pods × (pool_size + max_overflow) = 2 × 6 × 4 = 48 connections (PostgreSQL max_connections=100 내 안전)
engine = create_engine(
  settings.database_url,
  poolclass=QueuePool,
  pool_size=3,        # 5 → 3 (2 workers × 6 pods 대응)
  max_overflow=1,     # 10 → 1
  pool_pre_ping=True,  # 연결 상태 확인
  echo=settings.debug,
)

# 세션 팩토리
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ORM 기본 클래스
Base = declarative_base()
