from src.database.db import SessionLocal
from src.models.event import Event
from src.models.seat import Seat
from src.models.user import User

db = SessionLocal()

events = db.query(Event).all()
seats = db.query(Seat).all()
users = db.query(User).all()

print("=== Database Verification ===\n")
print(f"Events: {len(events)}")
for event in events:
    print(f"  - {event.name}")

print(f"\nSeats: {len(seats)}")
available = db.query(Seat).filter(Seat.status == 'available').count()
print(f"  - Available: {available}")

print(f"\nUsers: {len(users)}")

db.close()
print("\nMigration and seed data loaded successfully!")
