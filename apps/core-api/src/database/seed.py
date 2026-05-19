import json
import uuid
from datetime import datetime
from decimal import Decimal
import sys
from pathlib import Path

# 프로젝트 루트 추가
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from src.database.db import SessionLocal, Base, engine
from src.models.event import Event
from src.models.seat import Seat
from src.models.user import User


def load_seed_data():
  """시드 데이터 로드"""
  # DB 테이블 생성
  Base.metadata.create_all(bind=engine)

  db = SessionLocal()

  try:
    # 이벤트 데이터 로드
    with open("data/seeds/events.json", "r", encoding="utf-8") as f:
      events_data = json.load(f)

    # 섹션 데이터 로드
    with open("data/seeds/sections.json", "r", encoding="utf-8") as f:
      sections_data = json.load(f)

    # 이벤트 생성
    for event_data in events_data:
      # 기존 이벤트 확인 (이름으로 확인)
      existing = db.query(Event).filter(Event.name == event_data["name"]).first()
      if existing:
        print(f"Event {event_data['name']} already exists, skipping")
        continue

      event = Event(
        event_id=uuid.uuid4(),  # 새로운 UUID 생성
        name=event_data["name"],
        description=event_data.get("description"),
        location=event_data["location"],
        start_at=datetime.fromisoformat(event_data["start_at"].replace("Z", "+00:00")),
        end_at=datetime.fromisoformat(event_data["end_at"].replace("Z", "+00:00")),
        total_seats=event_data["total_seats"],
        available_seats=event_data["total_seats"],
      )
      db.add(event)
      db.commit()
      print(f"Created event: {event.name} ({event.event_id})")

      # 좌석 생성
      seat_count = 0
      for section_data in sections_data:
        section_code = section_data["section_code"]
        price = event_data["price_per_section"][section_code]

        for row_idx in range(1, section_data["row_count"] + 1):
          for seat_idx in range(1, section_data["seats_per_row"] + 1):
            seat = Seat(
              seat_id=uuid.uuid4(),
              event_id=event.event_id,
              section=section_code,
              row=f"{row_idx:02d}",
              seat_number=seat_idx,
              status="available",
              price=Decimal(str(price)),
            )
            db.add(seat)
            seat_count += 1

      db.commit()
      print(f"Created {seat_count} seats for event {event.name}")

    # 테스트 사용자 생성
    test_users = [
      {
        "email": f"user{i}@test.com",
        "name": f"Test User {i}",
        "phone": f"010-1234-{i:04d}",
      }
      for i in range(1, 11)
    ]

    for user_data in test_users:
      existing = db.query(User).filter(User.email == user_data["email"]).first()
      if existing:
        continue

      user = User(
        user_id=uuid.uuid4(),
        email=user_data["email"],
        hashed_password="$2b$12$dummy_hashed_password",  # 테스트용 더미 비밀번호
        name=user_data["name"],
        phone=user_data["phone"],
      )
      db.add(user)

    db.commit()
    print("Seed data loading completed!")

  except Exception as e:
    print(f"Error loading seed data: {e}")
    db.rollback()
  finally:
    db.close()


if __name__ == "__main__":
  load_seed_data()
