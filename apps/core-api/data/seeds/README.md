# 더미 데이터 (Seed Data)

초기 개발 및 테스트 환경을 위한 더미 데이터입니다.

## 파일 구조

```
data/seeds/
├── events.json          # 이벤트 마스터 데이터
├── venues.json          # 공연장 정보
├── sections.json        # 좌석 섹션 정보
├── seats.json           # 좌석 상세 정보
└── README.md            # 이 파일
```

## 데이터 로드 방법

### 1. PostgreSQL 초기화
```bash
cd apps/core-api
python -m src.database.seed
```

### 2. Redis 데이터 초기화
```bash
python -m src.redis_client.seed_locks
```

## 데이터 명세

### events.json
```json
[
  {
    "event_id": "evt-20260515-001",
    "name": "2026 K-POP Concert",
    "description": "대규모 K-POP 콘서트",
    "start_at": "2026-06-01T19:00:00Z",
    "end_at": "2026-06-01T22:00:00Z",
    "location": "서울",
    "venue_id": "venue-001",
    "total_seats": 10000,
    "price_range": {"min": 50000, "max": 150000}
  }
]
```

### sections.json
```json
[
  {
    "section_id": "sec-A",
    "venue_id": "venue-001",
    "name": "VIP석",
    "rows": ["A", "B", "C"],
    "seats_per_row": 20,
    "price": 150000
  },
  {
    "section_id": "sec-B",
    "venue_id": "venue-001",
    "name": "R석",
    "rows": ["D", "E", "F", "G", "H"],
    "seats_per_row": 25,
    "price": 100000
  }
]
```

### seats.json
생성 규칙:
- 섹션별로 자동 생성
- 좌석 ID: `{section_id}-{row}-{seat_number}`
- 예: `sec-A-A-01`, `sec-A-B-20`

## 테스트 데이터 통계

| 항목 | 수량 |
|------|------|
| 이벤트 | 5개 |
| 공연장 | 2개 |
| 좌석 | 10,000개 |
| 사용자 (테스트) | 100개 |

## 초기 상태

- 모든 좌석: `available` 상태
- 대기열: 비어있음
- Redis 락: 초기화됨

## 부하 테스트용 확장 데이터

`k6_test_data.json` - 5,000명의 동시 사용자를 시뮬레이션하기 위한 데이터
- 사용자 ID: `user-0001` ~ `user-5000`
- 토큰: 자동 생성

## 데이터 리셋

```bash
# PostgreSQL 데이터 삭제 및 재로드
python -m src.database.reset_and_seed

# Redis 데이터 삭제
redis-cli FLUSHDB
```

## 데이터 검증

```bash
# 데이터 무결성 검사
python -m src.database.validate_seed
```
