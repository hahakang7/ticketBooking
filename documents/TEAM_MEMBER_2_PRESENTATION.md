# Week 1 & 2 발표 요약
## 팀원 2 — FastAPI 백엔드 Core API

---

## 전체 흐름

```
Week 1                           Week 2
─────────────────────────────    ──────────────────────────────
DB 설계 & 마이그레이션            Redis 대기열 구현
  └─ 5개 테이블 + 인덱스            └─ Sorted Set FIFO
시드 데이터 5,875좌석 로드          └─ 1시간 TTL 자동 만료
API 기반 (events, health)         JWT 토큰 흐름 (queue → access)
Redis 연결 풀링 준비               Rate Limiting (봇 방어)
CI/CD (lint → test → build)      SSE 실시간 순번 push

검증: API 응답 0.5~29ms ✅        검증: 11개 단위 테스트 PASS ✅
```

---

## Week 1 — FastAPI 기초 + DB 설계

**목표:** 빈 프로젝트에서 실제 동작하는 API 서버 + DB까지

### 핵심 작업

**1. 레이어드 아키텍처 구축**
- API → Service → Repository → ORM 전 계층 완성
- PostgreSQL 5개 테이블 설계: User, Event, **Seat**, Reservation, Payment
- 성능 인덱스 전략: `seats(event_id, status)`, `seats(held_until)` — 이후 대량 조회/만료 처리의 기반

**2. Redis 연결 준비**
- Connection Pooling 기반 Redis 클라이언트
- 키 네이밍 규칙 확정 (`queue:evt-123`, `lock:reservation:evt-123`)

**3. CI/CD 파이프라인**
- GitHub Actions 3단계: lint(flake8) → test(pytest) → build(Docker)

### 검증 결과 (2026-05-19)

| 항목 | 결과 |
|------|------|
| DB 마이그레이션 | ✅ 5개 테이블 생성 |
| 시드 데이터 | ✅ 5,875개 좌석 · 5개 이벤트 · 10명 사용자 |
| GET /health | ✅ 200 OK · **0.50ms** |
| GET /api/v1/events | ✅ 200 OK · 29ms · 5개 이벤트 |
| GET /api/v1/events/{id}/seats | ✅ 200 OK · 28ms · **1,175개 좌석** |
| 단위 테스트 | ✅ **11개 PASS** |

---

## Week 2 — Phase 1: 대기열 시스템

**목표:** 트래픽 폭발 상황에서도 순서대로 입장 — Redis Sorted Set 대기열

### 핵심 작업

**1. Redis Sorted Set 대기열**
- `ZADD queue:evt-123 timestamp user_id` → 시간 기반 FIFO 순번
- `ZRANK`로 현재 위치 조회, TTL 1시간 자동 만료
- `consume_token()` — 대기 완료 시 JWT access_token 발급 (Lua 스크립트로 원자성 보장)

**2. JWT 인증 흐름**
- 대기 단계: `queue_token` → 대기 완료 후: `access_token`
- 이후 좌석 예매 API는 access_token 보유자만 접근 가능

**3. Rate Limiting (Redis 슬라이딩 윈도우)**
- `/api/queue/join` : IP당 1 req/sec — 티켓팅 봇 방어
- 일반 API: IP당 10 req/sec

### API 엔드포인트

| 엔드포인트 | 역할 |
|-----------|------|
| `POST /api/queue/join` | 대기열 진입 |
| `GET /api/queue/status` | 현재 순번 조회 |
| `SSE /api/queue/sse` | 실시간 대기 순번 push |

### 코드 품질 개선 (2026-05-25)

- Critical 6건: secret key 기본값 제거, 내부 에러 메시지 클라이언트 노출 차단
- 단위 테스트 11개 PASS 유지

---

## 핵심 수치

| 지표 | 결과 |
|------|------|
| 좌석 데이터 | **5,875개** |
| 헬스체크 응답 | **0.50ms** |
| Rate Limit | **1 req/sec** (대기열 진입) |
| 단위 테스트 | **11개 PASS** |

---

> **1~2주차의 핵심 의미**
> Week 3 Redlock 분산 락이 가능하려면 Redis 연결, DB 트랜잭션, JWT 인증이 모두 준비되어 있어야 했고 — 이 두 주간 그 기반을 완성했습니다.
