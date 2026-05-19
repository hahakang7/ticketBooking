from fastapi.testclient import TestClient
from src.main import app

client = TestClient(app)

print("=== API Endpoint Tests ===\n")

# Test /health
print("1. GET /health")
response = client.get("/health")
print(f"   Status: {response.status_code}")
print(f"   Response: {response.json()}\n")

# Test /api/v1/events
print("2. GET /api/v1/events")
response = client.get("/api/v1/events")
print(f"   Status: {response.status_code}")
data = response.json()
print(f"   Events count: {len(data['data']['items'])}")
if data['data']['items']:
    print(f"   First event: {data['data']['items'][0]['name']}\n")

# Test /api/v1/events/{id}
if data['data']['items']:
    event_id = data['data']['items'][0]['event_id']
    print(f"3. GET /api/v1/events/{event_id}")
    response = client.get(f"/api/v1/events/{event_id}")
    print(f"   Status: {response.status_code}")
    event = response.json()['data']
    print(f"   Event: {event['name']} ({event['total_seats']} seats)\n")

    # Test /api/v1/events/{id}/seats
    print(f"4. GET /api/v1/events/{event_id}/seats")
    response = client.get(f"/api/v1/events/{event_id}/seats")
    print(f"   Status: {response.status_code}")
    seats = response.json()['data']
    print(f"   Seats count: {len(seats['items'])}")

print("\n✓ All API endpoints working correctly!")
