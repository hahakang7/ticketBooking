from sqlalchemy.orm import Session
import uuid

from src.models.user import User


class UserRepository:
  def __init__(self, db: Session):
    self.db = db

  def get_by_email(self, email: str) -> User | None:
    """이메일로 사용자 조회"""
    return self.db.query(User).filter(User.email == email).first()

  def get_by_id(self, user_id: uuid.UUID) -> User | None:
    """사용자 ID로 조회"""
    return self.db.query(User).filter(User.user_id == user_id).first()
