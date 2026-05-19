# 팀원 2 (백엔드 Core & 데이터베이스) 개발 가이드

> **담당 기술:** FastAPI, Redis (Sorted Set, Lock), PostgreSQL  
> **핵심 목표:** 0건 중복 예매 + 3초 이내 데이터 무결성 보장

---

## 📂 담당 파일/폴더 구조

```
apps/core-api/                       # 전체 FastAPI 애플리케이션 (단독 소유)
├── src/
│   ├── main.py                      ✏️ 작업 대상 (앱 진입점)
│   ├── config.py                    ✏️ 작업 대상 (설정)
│   ├── dependencies.py              ✏️ 작업 대상 (의존성 주입)
│   │
│   ├── api/v1/                      # REST API 엔드포인트
│   │   ├── __init__.py
│   │   ├── queue.py                 ✏️ Phase 1: 대기열 API
│   │   ├── events.py                ✏️ 이벤트 조회 API
│   │   ├── seats.py                 ✏️ Phase 2: 좌석 조회 API
│   │   ├── reservations.py          ✏️ Phase 3: 예약 API (분산 락)
│   │   ├── payments.py              ✏️ 결제 API
│   │   └── prediction.py            ✏️ Week 3: 예측 모델 API (팀원 1과 공유)
│   │
│   ├── services/                    # 비즈니스 로직
│   │   ├── __init__.py
│   │   ├── queue_service.py         ✏️ Phase 1: Redis Sorted Set 관리
│   │   ├── seat_service.py          ✏️ Phase 2: 좌석 상태 조회
│   │   ├── reservation_service.py   ✏️ Phase 3: 예약 + Redlock 로직
│   │   ├── payment_service.py       ✏️ 결제 처리
│   │   ├── event_service.py         ✏️ 이벤트 조회
│   │   └── token_service.py         ✏️ JWT 토큰 관리
│   │
│   ├── repositories/                # DB 접근 계층
│   │   ├── __init__.py
│   │   ├── event_repository.py      ✏️ Event 테이블 CRUD
│   │   ├── seat_repository.py       ✏️ Seat 테이블 CRUD
│   │   ├── reservation_repository.py ✏️ Reservation 테이블 CRUD
│   │   ├── payment_repository.py    ✏️ Payment 테이블 CRUD
│   │   └── user_repository.py       ✏️ User 테이블 CRUD
│   │
│   ├── models/                      # SQLAlchemy ORM 모델
│   │   ├── __init__.py
│   │   ├── event.py                 ✏️ Event 모델
│   │   ├── seat.py                  ✏️ Seat 모델
│   │   ├── reservation.py           ✏️ Reservation 모델
│   │   ├── payment.py               ✏️ Payment 모델
│   │   └── user.py                  ✏️ User 모델
│   │
│   ├── schemas/                     # Pydantic DTO
│   │   ├── __init__.py
│   │   ├── queue_schema.py          ✏️ 대기열 요청/응답 DTO
│   │   ├── event_schema.py          ✏️ 이벤트 DTO
│   │   ├── seat_schema.py           ✏️ 좌석 DTO
│   │   ├── reservation_schema.py    ✏️ 예약 DTO
│   │   └── payment_schema.py        ✏️ 결제 DTO
│   │
│   ├── database/                    # DB 설정 및 마이그레이션
│   │   ├── __init__.py
│   │   ├── db.py                    ✏️ SQLAlchemy 세션 팩토리
│   │   ├── migration.py             ✏️ Alembic 마이그레이션
│   │   └── seed.py                  ✏️ 초기 데이터 로드 스크립트
│   │
│   ├── redis/                       # Redis 클라이언트 및 로직
│   │   ├── __init__.py
│   │   ├── client.py                ✏️ Redis 연결 관리
│   │   ├── queue.py                 ✏️ Sorted Set 기반 대기열 (Phase 1)
│   │   ├── lock.py                  ✏️ Redlock 분산 락 (Phase 3)
│   │   ├── cache.py                 ✏️ 캐시 유틸
│   │   └── constants.py             ✏️ Redis 키 네이밍 상수
│   │
│   ├── auth/                        # 인증 및 토큰
│   │   ├── __init__.py
│   │   ├── token.py                 ✏️ JWT 생성/검증 로직
│   │   └── security.py              ✏️ 보안 유틸 (hash, verify)
│   │
│   ├── middleware/                  # 미들웨어
│   │   ├── __init__.py
│   │   ├── error_handler.py         ✏️ 에러 처리
│   │   ├── rate_limiter.py          ✏️ Rate Limiting
│   │   └── logger.py                ✏️ 로깅
│   │
│   ├── prediction/                  # 예측 모델 (팀원 1이 구현)
│   │   ├── __init__.py
│   │   ├── traffic_forecaster.py    📖 팀원 1이 작성 (너는 API 연동만)
│   │   └── resource_calculator.py   📖 팀원 1이 작성
│   │
│   ├── exceptions/                  # 커스텀 예외
│   │   ├── __init__.py
│   │   └── custom_exceptions.py     ✏️ 비즈니스 로직 예외
│   │
│   └── utils/                       # 유틸 함수
│       ├── __init__.py
│       ├── logger.py                ✏️ 로깅 설정
│       └── constants.py             ✏️ 상수 정의
│
├── data/seeds/                      # 초기 데이터 (너의 책임)
│   ├── events.json                  ✏️ 이벤트 마스터 데이터
│   ├── venues.json                  ✏️ 공연장 정보
│   ├── sections.json                ✏️ 좌석 섹션
│   ├── seats.json                   ✏️ 좌석 상세 (자동 생성)
│   └── README.md                    ✏️ 시드 데이터 가이드
│
├── models/                          # 학습된 모델 (팀원 1이 관리)
│   ├── traffic_model.pkl            📖 팀원 1이 관리
│   └── scaler.pkl                   📖 팀원 1이 관리
│
├── requirements.txt                 ✏️ Python 의존성
├── Dockerfile                       ✏️ 컨테이너 이미지
├── README.md                        ✏️ 개발 가이드
└── alembic.ini                      ✏️ DB 마이그레이션 설정

infra/k8s/base/core-api/            # K8s 배포 (너가 생성 & 관리)
├── deployment.yaml                  ✏️ Pod 배포 정의
└── service.yaml                     ✏️ 서비스 정의

docker-compose.api.yml              ✏️ 단독 소유 (core-api 서비스만)

docs/api-specs/core-api.md          📖 API 명세 (너가 초안, 팀 리뷰)
```

---

## 📅 4주 스케줄 & 작업 목록

### ⏰ Week 1: FastAPI 기본 구조 & DB 설계

**목표:** Core API 프로젝트 스캐폴딩 완성, DB 스키마 정의

#### ⚡ 작업 의존성 순서 (반드시 이 순서로 진행):
> requirements.txt → config.py/db.py → models/ → alembic 마이그레이션 → redis/ → main.py → API → seed

#### 할일 체크리스트:

```
[ ] Docker 설정
    └─ [ ] requirements.txt 확정
         ⚠️ 현재 파일에 누락된 패키지 (반드시 추가):
         ├─ alembic==1.13.0          # DB 마이그레이션 (필수)
         ├─ python-jose[cryptography]==3.3.0  # JWT 토큰 (필수)
         ├─ passlib[bcrypt]==1.7.4   # 비밀번호 해싱 (필수)
         ├─ pydantic-settings==2.1.0 # 환경변수 관리 (필수)
         ├─ httpx==0.25.2            # 테스트용 HTTP 클라이언트
         ├─ pytest-asyncio==0.21.0   # 비동기 테스트
         └─ coverage==7.3.2          # 커버리지 측정
    └─ [ ] Dockerfile 작성
    └─ [ ] docker-compose.api.yml 작성

[ ] FastAPI 프로젝트 초기화
    └─ 위치: apps/core-api/src/
       ├─ [ ] config.py 작성 (환경변수 로드)
       ├─ [ ] dependencies.py 작성 (DB 세션, Redis 클라이언트)
       ├─ [ ] main.py 작성 (FastAPI 앱 생성)
       └─ [ ] 기본 라우터 통합

[ ] 데이터베이스 설계
    └─ 위치: apps/core-api/src/models/
       ├─ [ ] Event 모델 설계
       ├─ [ ] Seat 모델 설계 (index: event_id, seat_id)
       ├─ [ ] Reservation 모델 설계
       ├─ [ ] Payment 모델 설계
       └─ [ ] User 모델 설계
    ⚠️ 인덱스 전략 필수 (성능 영향)

[ ] 데이터베이스 마이그레이션 설정
    └─ 위치: apps/core-api/src/database/
       ├─ [ ] alembic init
       ├─ [ ] 초기 마이그레이션 파일 생성
       └─ [ ] 마이그레이션 테스트

[ ] Redis 클라이언트 설정
    └─ 위치: apps/core-api/src/redis/
       ├─ [ ] client.py 작성 (연결 관리)
       ├─ [ ] constants.py 작성 (key naming convention)
       └─ [ ] 연결 테스트

[ ] Repository 계층 구현
    └─ 위치: apps/core-api/src/repositories/
       ├─ [ ] event_repository.py
       ├─ [ ] seat_repository.py
       ├─ [ ] user_repository.py
       └─ [ ] 기본 CRUD 메서드

[ ] Pydantic 스키마 정의
    └─ 위치: apps/core-api/src/schemas/
       ├─ [ ] event_schema.py
       ├─ [ ] seat_schema.py
       └─ [ ] user_schema.py

[ ] 기본 API 엔드포인트
    └─ 위치: apps/core-api/src/api/v1/
       ├─ [ ] /health (헬스체크)
       ├─ [ ] /events (이벤트 조회)
       └─ [ ] /events/{id}/seats (좌석 조회)

[ ] 초기 데이터 준비
    └─ 위치: apps/core-api/data/seeds/
       ├─ [ ] events.json 작성 (3~5개 이벤트)
       ├─ [ ] venues.json 작성
       ├─ [ ] sections.json 작성
       └─ [ ] seed.py 스크립트 작성

[ ] K8s 배포 설정
    └─ 위치: infra/k8s/base/core-api/
       ├─ [ ] deployment.yaml 작성
       └─ [ ] service.yaml 작성

[ ] CI/CD 파이프라인 설정
    └─ 위치: .github/workflows/
       └─ [ ] ci-core-api.yml 작성 (pytest, flake8)

[ ] 문서 작성
    └─ 위치: apps/core-api/README.md
       ├─ [ ] 프로젝트 구조 설명
       ├─ [ ] DB 스키마 다이어그램
       └─ [ ] 개발 가이드
```

**협업 포인트:**
- 팀원 1과: K8s 리소스 요청값 (CPU, Memory) 공유
- 팀원 3과: 예상 동시 연결 수, 데이터 모델 확인
- API 명세 (docs/api-specs/core-api.md) 팀 검토

---

### ⏰ Week 2: Phase 1 - 대기열 시스템

**목표:** Redis Sorted Set 기반 대기열 + SSE 실시간 업데이트

#### 할일 체크리스트:

```
[ ] Queue Redis 로직
    └─ 위치: apps/core-api/src/redis/queue.py
       ├─ [ ] Redis Sorted Set 구조 정의
       ├─ [ ] ZADD (추가), ZRANK (순번), ZREM (제거) 구현
       └─ [ ] TTL 관리 (1시간 후 자동 삭제)

[ ] JWT 설정
    └─ 위치: apps/core-api/src/auth/token.py
       ├─ [ ] 토큰 인코딩/디코딩
       ├─ [ ] 만료 시간 설정
       └─ [ ] 비밀키 관리

[ ] Queue Service 구현
    └─ 위치: apps/core-api/src/services/queue_service.py
       ├─ [ ] join_queue() - 사용자 대기열 추가
       ├─ [ ] get_position() - 현재 순번 조회
       ├─ [ ] consume_token() - 대기 완료 후 토큰 발급
       └─ [ ] leave_queue() - 대기열 이탈

[ ] Token Service 구현
    └─ 위치: apps/core-api/src/services/token_service.py
       ├─ [ ] queue_token 생성 (대기 단계)
       ├─ [ ] access_token 생성 (대기 완료 후)
       └─ [ ] 토큰 검증 로직

[ ] Queue API 엔드포인트
    └─ 위치: apps/core-api/src/api/v1/queue.py
       ├─ [ ] POST /api/queue/join - 대기열 진입
       ├─ [ ] GET /api/queue/status - 대기 상태 조회
       └─ [ ] SSE /api/queue/sse - 실시간 업데이트

[ ] Rate Limiting
    └─ 위치: apps/core-api/src/middleware/rate_limiter.py
       ├─ [ ] /api/queue/join: 1 req/sec per IP
       ├─ [ ] /api/events/{id}/seats/reserve: 2 req/sec per user  ⚠️ 누락 주의
       ├─ [ ] 그 외 API: 10 req/sec per IP
       └─ [ ] Redis 슬라이딩 윈도우 카운터 기반 구현

[ ] 로깅 설정
    └─ 위치: apps/core-api/src/middleware/logger.py
       ├─ [ ] 요청/응답 로깅
       ├─ [ ] 에러 로깅
       └─ [ ] 성능 메트릭 로깅

[ ] 단위 테스트
    └─ 위치: tests/test_queue.py
       ├─ [ ] Queue 진입/조회/이탈 테스트
       ├─ [ ] Token 발급/검증 테스트
       └─ [ ] SSE 연결 테스트

[ ] 통합 테스트
    └─ [ ] docker-compose up + queue API 테스트

[ ] 팀원 1에게 k6 테스트용 정보 제공
    └─ [ ] Queue API 엔드포인트 URL
    └─ [ ] 필수 파라미터 형식
    └─ [ ] 응답 예시
```

**협업 포인트:**
- 팀원 1과: k6 queue-load-test.js 작성 전 API 스펙 공유
- 팀원 3과: SSE 이벤트 형식 확정 (WebSocket 전 단계)

---

### ⏰ Week 3: Phase 2 & 3 - 좌석 동기화 + 분산 락

**목표:** Redis Distributed Lock (Redlock) + Seat 무중복 예매

#### 할일 체크리스트:

```
[ ] Seat Repository 확장
    └─ 위치: apps/core-api/src/repositories/seat_repository.py
       ├─ [ ] 좌석 일괄 조회 (성능 최적화)
       ├─ [ ] 좌석 상태 업데이트
       └─ [ ] 좌석 인덱스 활용

[ ] Distributed Lock 구현 (핵심🔥)
    └─ 위치: apps/core-api/src/redis/lock.py
       ├─ [ ] Redlock 알고리즘 구현
       │   ├─ [ ] lock_seat(seat_id) - 락 획득
       │   ├─ [ ] unlock_seat(seat_id) - 락 해제
       │   └─ [ ] check_lock(seat_id) - 락 상태 확인
       ├─ [ ] 0.001초 차이의 중복 요청 거절
       ├─ [ ] 5분 TTL 설정 (임시 점유 시간)
       └─ [ ] Deadlock 방지 (watchdog 패턴)

[ ] Reservation Service 구현 (핵심🔥)
    └─ 위치: apps/core-api/src/services/reservation_service.py
       ├─ [ ] reserve_seats() - 좌석 예약
       │   ├─ [ ] Redlock 획득
       │   ├─ [ ] DB 트랜잭션 시작
       │   ├─ [ ] 좌석 상태 확인 (double-check)
       │   ├─ [ ] 좌석 상태 업데이트 (hold)
       │   ├─ [ ] Reservation 생성
       │   ├─ [ ] Redlock 해제
       │   └─ [ ] DB 커밋
       ├─ [ ] cancel_reservation() - 예약 취소
       └─ [ ] complete_reservation() - 결제 완료 후 확정

[ ] Seat API 엔드포인트
    └─ 위치: apps/core-api/src/api/v1/seats.py
       ├─ [ ] GET /api/events/{id}/seats - 좌석 목록 조회
       └─ [ ] POST /api/events/{id}/seats/reserve - 좌석 예약 (Redlock 적용)

[ ] Reservation API 엔드포인트
    └─ 위치: apps/core-api/src/api/v1/reservations.py
       ├─ [ ] GET /api/reservations/{id} - 예약 상태 조회
       └─ [ ] DELETE /api/reservations/{id} - 예약 취소

[ ] Payment Service 구현
    └─ 위치: apps/core-api/src/services/payment_service.py
       ├─ [ ] process_payment() - 결제 처리
       ├─ [ ] refund_payment() - 환불
       └─ [ ] verify_payment() - 결제 검증

[ ] Payment API 엔드포인트
    └─ 위치: apps/core-api/src/api/v1/payments.py
       ├─ [ ] POST /api/reservations/{id}/payment - 결제 요청
       └─ [ ] GET /api/orders/{id} - 주문 조회

[ ] 예측 모델 API 엔드포인트
    └─ 위치: apps/core-api/src/api/v1/prediction.py
       ├─ [ ] POST /api/prediction/forecast - 트래픽 예측 (팀원 1이 구현)
       └─ [ ] GET /api/prediction/resource-plan - 리소스 계획 (팀원 1이 구현)

[ ] 데이터베이스 트랜잭션 최적화
    └─ 위치: apps/core-api/src/services/
       ├─ [ ] 격리 수준 설정 (REPEATABLE READ)
       ├─ [ ] 데드락 처리 로직
       └─ [ ] 쿼리 성능 최적화 (인덱스 활용)

[ ] Redis Pub/Sub 연동 준비
    └─ 위치: apps/core-api/src/redis/
       ├─ [ ] 좌석 변경 이벤트 발행
       └─ [ ] WebSocket 서비스로 메시지 전송

[ ] 고급 테스트
    └─ 위치: tests/
       ├─ [ ] 중복 예매 시나리오 테스트 (0건 달성 검증)
       ├─ [ ] 동시성 테스트 (1000+ concurrent requests)
       ├─ [ ] DB 트랜잭션 테스트
       └─ [ ] Redlock 테스트 (lock timeout 테스트)

[ ] 팀원 1에게 handoff
    └─ [ ] reservation-stress-test.js 작성용 API 스펙 제공
    └─ [ ] 파라미터, URL, 응답 형식 상세 작성
```

**협업 포인트:**
- 팀원 1과: `apps/core-api/src/prediction/` 모듈 임포트 방식 협의
- 팀원 3과: Redis Pub/Sub 채널 및 메시지 형식 확정
    - 채널: `seat_updates:{event_id}`
    - 발행 데이터: `{"seat_id", "status", "held_by", "event_id"}`
- 팀원 1에게: k6 reservation-stress-test 시나리오 handoff

---

### ⏰ Week 4: 부하 테스트 & 성능 최적화

**목표:** 중복 예매 0건 + P95 < 300ms 달성

#### 할일 체크리스트:

```
[ ] 부하 테스트 결과 분석
    └─ [ ] k6 reservation-stress-test 결과 검토 (팀원 1과)
    └─ [ ] 병목 지점 파악 (DB, Redis, Python?)
    └─ [ ] 중복 예매 건수 검증 (목표: 0건)

[ ] 데이터베이스 최적화
    └─ [ ] 쿼리 실행 계획 분석 (EXPLAIN)
    └─ [ ] 인덱스 추가/수정
    └─ [ ] 커넥션 풀 설정 최적화
    └─ [ ] 느린 쿼리 로그 분석

[ ] Redis 성능 최적화
    └─ [ ] 메모리 사용량 분석
    └─ [ ] 배치 명령어 활용 (파이프라인)
    └─ [ ] 키 TTL 정책 최적화

[ ] API 응답 시간 개선
    └─ [ ] 응답 압축 설정 (gzip)
    └─ [ ] 쿼리 횟수 최소화
    └─ [ ] 캐싱 전략 적용
    └─ [ ] P95 < 300ms 달성 확인

[ ] 메모리 누수 점검
    └─ [ ] 메모리 프로파일링
    └─ [ ] Redis 연결 누수 확인
    └─ [ ] DB 커넥션 누수 확인

[ ] 코드 리팩토링
    └─ [ ] 불필요한 코드 제거
    └─ [ ] 함수 길이 최적화 (너무 길면 분리)
    └─ [ ] 상수화 (매직 넘버 제거)

[ ] 최종 검증
    └─ [ ] 모든 API 엔드포인트 테스트
    └─ [ ] 에러 핸들링 검증
    └─ [ ] 로깅 검증
    └─ [ ] 보안 체크 (SQL Injection, XSS 등)

[ ] 발표 자료 준비
    └─ [ ] 핵심 기능 설명 (대기열, Redlock, 트랜잭션)
    └─ [ ] 성능 개선 지표
    └─ [ ] 데이터 무결성 검증 결과
```

**협업 포인트:**
- 팀원 1, 3과: 부하 테스트 결과 공동 회의
- 팀원 3과: 최종 성능 검증

---

## 🎯 주요 작업 영역

### 1️⃣ Phase 1: 대기열 관리 (Week 2)

**파일:**
```
apps/core-api/src/
├── services/queue_service.py
├── redis/queue.py
├── api/v1/queue.py
└── schemas/queue_schema.py
```

**핵심 로직:**
```python
# Redis Sorted Set으로 FIFO 구현
ZADD queue:evt-123 timestamp user_id
ZRANK queue:evt-123 user_id  # 순번 조회
ZREM queue:evt-123 user_id   # 제거
```

---

### 2️⃣ Phase 3: 분산 락 (Week 3 - 핵심🔥)

**파일:**
```
apps/core-api/src/
├── redis/lock.py              # Redlock 구현
├── services/reservation_service.py  # 예약 로직
└── api/v1/reservations.py     # API
```

**핵심 로직:**
```python
# Redlock 패턴
try:
    lock = acquire_lock('lock:seat:A1', timeout=5)  # 5초
    if not lock:
        return Error("이미 선점됨")
    
    # DB 트랜잭션
    with db.transaction():
        seat = query_seat('A1')
        if seat.status != 'available':
            return Error("중복 선점")
        update_seat('A1', 'hold')
        create_reservation(seat_id='A1')
    
    return Success("예약됨")
finally:
    release_lock(lock)
```

**0.001초 차이 처리:**
- Redlock으로 원자성 보장
- Double-check: 락 획득 후 DB에서 재확인
- TTL 5분: 결제 미완료 시 자동 취소

---

### 3️⃣ 데이터베이스 설계

**주요 테이블:**

```sql
-- Events (이벤트)
CREATE TABLE events (
    event_id UUID PRIMARY KEY,
    name VARCHAR(255),
    start_at TIMESTAMP,
    total_seats INT,
    available_seats INT,
    INDEX (start_at)
);

-- Seats (좌석)
CREATE TABLE seats (
    seat_id UUID PRIMARY KEY,
    event_id UUID REFERENCES events,
    section VARCHAR(50),
    row VARCHAR(5),
    seat_number INT,
    status ENUM('available', 'hold', 'sold'),
    held_by UUID,
    held_until TIMESTAMP,
    price DECIMAL(10,2),
    UNIQUE (event_id, section, row, seat_number),
    INDEX (event_id, status),  -- ⭐ 성능 필수
    INDEX (held_until)         -- ⭐ TTL 만료 조회
);

-- Reservations (예약)
CREATE TABLE reservations (
    reservation_id UUID PRIMARY KEY,
    user_id UUID,
    event_id UUID REFERENCES events,
    seat_ids JSON,
    status ENUM('held', 'completed', 'cancelled'),
    created_at TIMESTAMP,
    expires_at TIMESTAMP,
    INDEX (user_id, created_at)
);

-- Payments (결제)
CREATE TABLE payments (
    payment_id UUID PRIMARY KEY,
    reservation_id UUID REFERENCES reservations,
    user_id UUID,
    amount DECIMAL(10,2),
    status ENUM('pending', 'completed', 'failed'),
    created_at TIMESTAMP
);
```

**인덱스 전략:**
- `seats(event_id, status)`: 좌석 조회 성능
- `seats(held_until)`: 자동 만료 처리
- `reservations(user_id, created_at)`: 사용자 예약 조회

---

## 🔗 팀 협업 포인트

| 주차 | 협업 대상 | 협의 내용 |
|------|---------|---------|
| Week 1 | 팀원 1, 3 | 데이터 모델, API 응답 형식 |
| Week 2 | 팀원 1, 3 | SSE 이벤트 형식, k6 시나리오 파라미터 |
| Week 3 | 팀원 1 | prediction/ 모듈 임포트 방식 (팀원 1이 구현, 나는 API 래핑) |
| Week 3 | 팀원 3 | Redis Pub/Sub 채널 `seat_updates:{event_id}` 메시지 형식 확정 |
| Week 4 | 팀원 1, 3 | 부하 테스트 결과 분석 |

---

## 🛠️ 자주 사용할 명령어

```bash
# DB 마이그레이션
alembic init alembic
alembic revision --autogenerate -m "Initial schema"
alembic upgrade head

# 시드 데이터 로드 (apps/core-api/ 디렉토리에서 실행)
python -m src.database.seed

# pytest 실행
pytest -v --cov=src

# 특정 테스트만 실행
pytest tests/test_queue.py::test_join_queue -v

# Docker 로컬 테스트
docker-compose up -d
docker-compose logs -f core-api

# FastAPI 문서
http://localhost:8000/docs
```

---

## 📌 주간 체크리스트

### Week 1 Day 1
- [ ] DB 스키마 설계 문서화
- [ ] API 명세 (core-api.md) 팀 리뷰
- [ ] 인덱스 전략 확정

### Week 1 Day 5
- [ ] FastAPI 프로젝트 구조 완성
- [ ] Repository + ORM 모델 완성
- [ ] docker-compose up 테스트 통과

### Week 2 Day 5
- [ ] Queue Service 완성 + 단위 테스트
- [ ] SSE 엔드포인트 작동 확인
- [ ] 팀원 1에게 k6 정보 제공

### Week 3 Day 5
- [ ] Redlock 구현 완료 + 테스트 (0건 중복 검증)
- [ ] 모든 API 엔드포인트 완성
- [ ] 팀원 1에게 k6 시나리오 handoff

### Week 4 Day 5
- [ ] P95 < 300ms 달성 확인
- [ ] 모든 테스트 통과
- [ ] 발표 자료 준비
