# 예측형 오토스케일링 티켓 예매 시스템

Kubernetes 기반의 **예측형 인프라 자동확장** 및 **실시간 좌석 동기화** 시스템입니다.

## 🎯 핵심 목표

| 목표 | 설명 |
|------|------|
| **Zero-Downtime 확장** | 트래픽 발생 후 대응이 아닌, **이벤트 오픈 전 사전 확장** |
| **데이터 무결성** | **Redis Distributed Lock**으로 0.001초 차이의 중복 선점 방지 |
| **실시간 동기화** | WebSocket + Redis Pub/Sub으로 **0.1초 이내** 좌석 상태 전파 |

## 📊 프로젝트 구조

```
root/
├── .github/                     # CI/CD 자동화 (GitHub Actions)
├── apps/                        # 애플리케이션 서비스
│   ├── core-api/                # FastAPI 예매 API (Python 3.11+)
│   │   ├── src/                # 비즈니스 로직
│   │   ├── requirements.txt     # 의존성
│   │   └── Dockerfile          # 컨테이너 이미지
│   ├── websocket-service/       # Socket.IO 실시간 서비스 (Node.js 18+)
│   │   ├── src/                # 실시간 핸들러
│   │   ├── package.json        # 의존성
│   │   └── Dockerfile          # 컨테이너 이미지
│   └── frontend/                # React 프론트엔드 (3001)
│       ├── src/                # React 컴포넌트
│       ├── package.json        # 의존성
│       └── Dockerfile          # 컨테이너 이미지
├── infra/                       # 인프라 및 쿠버네티스
│   ├── k8s/
│   │   ├── base/               # 기본 리소스 (Deployment, Service, Ingress)
│   │   └── autoscaling/        # 자동 확장 (Karpenter NodePool, HPA)
│   ├── prometheus/             # 모니터링 및 알림 규칙
│   ├── redis/                  # Redis Operator 설정
│   └── monitoring/             # 모니터링 대시보드
├── docs/                        # 문서
│   ├── api-specs/
│   │   ├── core-api.md         # REST API 명세
│   │   └── websocket-api.md    # WebSocket API 명세
│   └── README.md               # 전체 문서
├── data/                        # 데이터
│   └── seeds/                  # 더미 데이터 (초기화 스크립트)
├── ml/                          # 머신러닝 (예측 모델)
│   ├── prediction/             # 트래픽 예측 (Prophet/LSTM)
│   └── models/                 # 학습된 모델
├── tests/                       # 테스트
│   └── k6/                     # 부하 테스트 (k6 시나리오)
├── docker-compose.yml          # 로컬 개발 환경
└── README.md                   # 이 파일
```

## 🚀 빠른 시작

### 요구사항
- **Docker & Docker Compose** (로컬 개발)
- **Kubernetes** 1.24+ (프로덕션)
- **Python** 3.11+
- **Node.js** 18+
- **Redis** 7.0+
- **PostgreSQL** 15+

### 로컬 개발 (Docker Compose)

```bash
# 모든 서비스 시작 (postgres, redis, core-api, websocket, frontend)
docker-compose up -d

# 확인
# - Frontend: http://localhost:3001
# - Core API (Swagger): http://localhost:8000/docs
# - WebSocket: ws://localhost:3000
# - Redis: localhost:6379
```

### 로컬 개발 (직접 실행)

```bash
# 1. Core API
cd apps/core-api
pip install -r requirements.txt
python -m uvicorn src.main:app --reload
# 포트 8000

# 2. WebSocket Service
cd apps/websocket-service
npm install
npm run dev
# 포트 3000

# 3. Frontend
cd apps/frontend
npm install
npm run dev
# 포트 5173 (Vite)
```

## 📚 서비스 상세

### Core API (FastAPI)
| 항목 | 값 |
|------|-----|
| 포트 | 8000 |
| 역할 | 대기열, 좌석 조회/예약, 결제, 토큰 발급 |
| 데이터 | PostgreSQL (영속성), Redis (캐시/락) |
| 주요 기능 | Redis Distributed Lock, Admission Control, SSE |
| 명세 | `docs/api-specs/core-api.md` |

**Phase별 기능:**
- **Phase 1:** 대기열 (Redis Sorted Set), 토큰 기반 접근 제어
- **Phase 2:** 실시간 좌석 동기화 (Redis Hash + Pub/Sub)
- **Phase 3:** 분산 락 (Redlock), 무중복 예약

### WebSocket Service (Node.js + Socket.IO)
| 항목 | 값 |
|------|-----|
| 포트 | 3000 |
| 역할 | 실시간 좌석 상태 브로드캐스트 |
| 프로토콜 | WebSocket (Socket.IO v4.x) |
| 주요 기능 | Redis Pub/Sub 어댑터, 메시지 배치, 자동 재연결 |
| 명세 | `docs/api-specs/websocket-api.md` |

**성능 목표:**
- 메시지 지연: < 100ms (P95)
- 동시 연결: 10,000+
- 처리량: 50,000+ msg/sec

### Frontend (React + Vite)
| 항목 | 값 |
|------|-----|
| 포트 | 3001 (로컬 5173) |
| 역할 | 사용자 UI (대기열, 좌석 시각화, 결제) |
| 디자인 | Dark Theme (Navy + Cyan) |
| 최적화 | 모바일 우선, 반응형, 번들 크기 < 150KB |

## 🏗️ 아키텍처

### 3단계 시스템

**Phase 1: 트래픽 제어 및 대기열**
```
사용자 → Core API (Admission Control) → Redis Queue (FIFO) → 토큰 발급
```

**Phase 2: 실시간 좌석 동기화**
```
Core API (좌석 변경) 
  → Redis Pub/Sub (발행)
  → WebSocket Service (수신)
  → 모든 클라이언트 (0.1초 이내)
```

**Phase 3: 분산 락을 통한 무결성**
```
사용자 (좌석 선택)
  → Core API
  → Redis Distributed Lock (Redlock)
  → 중복 선점 방지 (0.001초 차이)
  → 예약 확정
```

### 데이터 흐름

| 계층 | 기술 | 책임 |
|------|------|------|
| **캐시/큐** | Redis | 대기열, 좌석 상태, 분산 락 |
| **실시간** | WebSocket + Pub/Sub | 0.1초 이내 메시지 브로드캐스트 |
| **영속성** | PostgreSQL | 주문, 결제, 사용자 데이터 |
| **오케스트레이션** | Kubernetes | Pod 자동 확장 (HPA), 노드 자동 확장 (Karpenter) |
| **모니터링** | Prometheus | 메트릭 수집, 알림 |
| **ML** | Prophet/LSTM | 트래픽 예측 → 사전 자원 할당 |

## 🔄 개발 워크플로우

### 로컬 개발
```bash
# 1. 저장소 클론
git clone <repo>
cd distributeSys

# 2. Docker Compose 시작
docker-compose up -d

# 3. 개발
# - Core API: apps/core-api/src/
# - WebSocket: apps/websocket-service/src/
# - Frontend: apps/frontend/src/

# 4. 데이터베이스 마이그레이션 (필요 시)
docker-compose exec core-api alembic upgrade head

# 5. 초기 데이터 로드
docker-compose exec core-api python -m src.database.seed
```

### 배포 (Kubernetes)
```bash
# 1. 이미지 빌드 및 푸시
docker build -t myregistry/core-api:v1 apps/core-api/
docker push myregistry/core-api:v1

# 2. 쿠버네티스 배포
kubectl apply -f infra/k8s/base/
kubectl apply -f infra/k8s/autoscaling/

# 3. 모니터링
kubectl apply -f infra/prometheus/
```

## 🧪 테스트

### 단위 테스트
```bash
cd apps/core-api
pytest

cd apps/websocket-service
npm test
```

### 부하 테스트 (k6)
```bash
# 대기열 부하 테스트
k6 run tests/k6/queue-load-test.js

# 예약 부하 테스트 (5,000 RPS)
k6 run tests/k6/reservation-stress-test.js

# WebSocket 연결 테스트
k6 run tests/k6/websocket-load-test.js
```

## 📈 성능 지표 (KPIs)

| 지표 | 목표 | 검증 방법 |
|------|------|---------|
| 가용성 (Availability) | 99.9% | K8s 자동 재시작, 다중 복제본 |
| 응답 속도 (P95 Latency) | < 300ms | k6 부하 테스트 |
| 데이터 무결성 | 0건 중복 예매 | 결제 완료 건수 검증 |
| 좌석 동기화 | < 100ms | WebSocket 메시지 지연 측정 |

## 📖 문서

- **API 명세**
  - REST: `docs/api-specs/core-api.md`
  - WebSocket: `docs/api-specs/websocket-api.md`
- **배포 가이드**: `infra/README.md`
- **더미 데이터**: `data/seeds/README.md`
- **ML 모델**: `ml/README.md`

## 🏃 팀 역할 분담 (R&R)

| 팀원 | 담당 | 핵심 미션 |
|------|------|---------|
| **인프라팀** | K8s, Karpenter, HPA, Prometheus, k6 | 예측형 오토스케일링 (Zero-Downtime) |
| **백엔드팀** | FastAPI, Redis, PostgreSQL | 분산 락 및 데이터 무결성 (0건 중복 예매) |
| **실시간팀** | Node.js, WebSocket, Socket.IO | 0.1초 이내 좌석 동기화 |

자세한 스케줄은 `documents/schedule_and_rnr.md` 참고.

## 🛠️ 기술 스택

- **언어**: Python 3.11, JavaScript (Node.js 18, React)
- **백엔드**: FastAPI, SQLAlchemy, Pydantic
- **실시간**: Socket.IO, Redis Pub/Sub
- **프론트엔드**: React 18, Vite, Tailwind CSS, Socket.IO Client
- **데이터**: PostgreSQL 15, Redis 7
- **인프라**: Kubernetes, Karpenter, HPA, Prometheus
- **테스트**: pytest, Jest, k6
- **컨테이너**: Docker, Docker Compose

## 🐛 트러블슈팅

### Docker Compose 문제
```bash
# 로그 확인
docker-compose logs core-api

# 서비스 재시작
docker-compose restart core-api

# 완전히 초기화
docker-compose down -v
docker-compose up
```

### 데이터베이스 초기화
```bash
# PostgreSQL 리셋
docker-compose exec postgres psql -U user -d booking_system -c "DROP SCHEMA public CASCADE;"
docker-compose exec postgres psql -U user -d booking_system -c "CREATE SCHEMA public;"

# 마이그레이션 재실행
docker-compose exec core-api alembic upgrade head
docker-compose exec core-api python -m src.database.seed
```

## 📝 라이선스

[라이선스 정보]

## 📞 문의

- 기술 관련: team@example.com
- 버그 리포트: GitHub Issues
