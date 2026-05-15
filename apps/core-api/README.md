# Core API

FastAPI 기반의 예매 시스템 핵심 API 서비스입니다.

## 아키텍처

레이어드 아키텍처 (Controller → Service → Repository)

```
src/
├── main.py                          # 애플리케이션 진입점
├── config.py                        # 설정 및 환경변수
├── dependencies.py                  # 의존성 주입
├── api/
│   ├── __init__.py
│   ├── v1/
│   │   ├── __init__.py
│   │   ├── queue.py                # 대기열 엔드포인트
│   │   ├── events.py               # 이벤트 엔드포인트
│   │   ├── seats.py                # 좌석 엔드포인트
│   │   ├── reservations.py         # 예약 엔드포인트
│   │   └── payments.py             # 결제 엔드포인트
│   └── router.py                   # 라우터 통합
├── services/
│   ├── __init__.py
│   ├── queue_service.py            # 대기열 로직 (Redis Sorted Set)
│   ├── seat_service.py             # 좌석 조회 로직
│   ├── reservation_service.py      # 예약 및 분산 락 로직
│   ├── payment_service.py          # 결제 처리 로직
│   ├── event_service.py            # 이벤트 관리 로직
│   └── token_service.py            # 토큰 발급/검증
├── repositories/
│   ├── __init__.py
│   ├── event_repository.py         # 이벤트 DB 접근
│   ├── seat_repository.py          # 좌석 DB 접근
│   ├── reservation_repository.py   # 예약 DB 접근
│   ├── payment_repository.py       # 결제 DB 접근
│   └── user_repository.py          # 사용자 DB 접근
├── models/
│   ├── __init__.py
│   ├── event.py                    # Event SQLAlchemy 모델
│   ├── seat.py                     # Seat SQLAlchemy 모델
│   ├── reservation.py              # Reservation SQLAlchemy 모델
│   ├── payment.py                  # Payment SQLAlchemy 모델
│   └── user.py                     # User SQLAlchemy 모델
├── schemas/
│   ├── __init__.py
│   ├── queue_schema.py             # 대기열 DTO
│   ├── event_schema.py             # 이벤트 DTO
│   ├── seat_schema.py              # 좌석 DTO
│   ├── reservation_schema.py       # 예약 DTO
│   └── payment_schema.py           # 결제 DTO
├── database/
│   ├── __init__.py
│   ├── db.py                       # SQLAlchemy 세션
│   ├── migration.py                # DB 마이그레이션
│   └── seed.py                     # 초기 데이터
├── redis/
│   ├── __init__.py
│   ├── client.py                   # Redis 클라이언트
│   ├── queue.py                    # Redis Sorted Set (대기열)
│   ├── lock.py                     # Redis Distributed Lock (Redlock)
│   └── cache.py                    # Redis 캐시 유틸
├── auth/
│   ├── __init__.py
│   ├── token.py                    # JWT 토큰 생성/검증
│   └── security.py                 # 보안 유틸
├── exceptions/
│   ├── __init__.py
│   └── custom_exceptions.py        # 커스텀 예외
├── middleware/
│   ├── __init__.py
│   ├── error_handler.py            # 에러 핸들링
│   └── rate_limiter.py             # Rate Limiting
└── utils/
    ├── __init__.py
    ├── logger.py                   # 로깅 설정
    └── constants.py                # 상수 정의
```

## 핵심 기능

### Phase 1: 트래픽 제어 및 대기열
- **Redis Sorted Set** 기반 순번 관리
- **Token 기반 접근 제어**: 대기 완료 사용자만 API 접근 허용
- **SSE**: 실시간 대기 상태 업데이트
- **Admission Control**: 시스템 부하에 따른 유입 조절

### Phase 2: 실시간 좌석 동기화
- **WebSocket & Redis Pub/Sub**: 여러 인스턴스 간 메시지 브로드캐스트
- **좌석 상태 캐싱**: Redis Hash로 빠른 조회
- **0.1초 이내 전파 목표**

### Phase 3: 분산 락을 통한 무결성
- **Redis Distributed Lock** (Redlock 알고리즘)
- **0.001초 차이의 중복 선점 방지**
- **TTL 기반 임시 점유** (기본 5분)

## 환경 설정

`.env` 파일 예제:
```
DATABASE_URL=postgresql://user:password@localhost/dbname
REDIS_URL=redis://localhost:6379
DEBUG=True
SECRET_KEY=your-secret-key
JWT_ALGORITHM=HS256
JWT_EXPIRATION_HOURS=24
```

## 개발

```bash
# 의존성 설치
pip install -r requirements.txt

# DB 마이그레이션
alembic upgrade head

# 초기 데이터 로드
python -m src.database.seed

# 개발 서버 실행
python -m uvicorn src.main:app --reload

# 테스트
pytest

# 테스트 커버리지
pytest --cov=src
```

## API 문서

- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc
- API 명세: `docs/api-specs/core-api.md`

## 데이터베이스 스키마

### events 테이블
```sql
event_id (PK), name, description, start_at, end_at, 
location, venue_id, total_seats, available_seats
```

### seats 테이블
```sql
seat_id (PK), event_id (FK), section, row, seat_number, 
status (available/hold/sold), price, held_by, held_until
```

### reservations 테이블
```sql
reservation_id (PK), user_id (FK), event_id (FK), 
seat_ids (JSON array), status, created_at, expires_at
```

### payments 테이블
```sql
payment_id (PK), reservation_id (FK), user_id (FK), 
amount, status, payment_method, created_at
```

## Redis 스토리지

### Queue (대기열)
- **Key**: `queue:{event_id}`
- **Type**: Sorted Set
- **Score**: Unix timestamp (가입 시간)
- **Value**: user_id

### Seat Status (좌석 상태)
- **Key**: `seats:{event_id}`
- **Type**: Hash
- **Field**: seat_id
- **Value**: JSON (status, held_by, held_until)

### Distributed Lock (분산 락)
- **Key**: `lock:seat:{seat_id}`
- **Type**: String
- **Value**: 락 소유자 (reservation_id)
- **TTL**: 5분 (임시 점유 시간)

## 성능 최적화

1. **DB 커넥션 풀**: PostgreSQL 연결 재사용
2. **Redis 캐싱**: 좌석 상태 메모리 캐싱
3. **쿼리 최적화**: 인덱스 설정 (event_id, seat_id, user_id)
4. **배치 처리**: 대량 좌석 조회 시 배치 쿼리
5. **비동기 작업**: Celery로 이메일, 로깅 등 오프로드

## 에러 처리

모든 에러는 표준 형식으로 응답:
```json
{
  "error_code": "CONFLICT",
  "message": "좌석이 이미 점유되었습니다",
  "details": {...},
  "timestamp": "2026-05-15T14:30:00Z"
}
```

## 보안

- **토큰 기반 인증**: JWT
- **토큰 갱신**: 대기 완료 후 access_token 발급
- **Rate Limiting**: IP 및 사용자별 제한
- **SQL Injection 방지**: ORM 사용
- **CORS**: 정책 설정 완료
