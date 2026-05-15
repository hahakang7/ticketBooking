# 환경변수 가이드

각 서비스별 환경변수 목록 및 기본값입니다.

## Core API (FastAPI)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `DATABASE_URL` | `postgresql://user:password@postgres:5432/booking_system` | PostgreSQL 연결 문자열 |
| `REDIS_URL` | `redis://redis:6379` | Redis 연결 문자열 |
| `DEBUG` | `false` | 디버그 모드 |
| `LOG_LEVEL` | `info` | 로깅 수준 (debug, info, warning, error) |
| `SECRET_KEY` | (필수) | JWT 서명용 비밀키 |
| `JWT_ALGORITHM` | `HS256` | JWT 알고리즘 |
| `JWT_EXPIRATION_HOURS` | `24` | JWT 토큰 유효 기간 (시간) |
| `CORS_ORIGINS` | `["http://localhost:3001"]` | CORS 허용 도메인 |

## WebSocket Service (Node.js)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `3000` | 서버 포트 |
| `NODE_ENV` | `development` | 환경 (development, production) |
| `REDIS_URL` | `redis://redis:6379` | Redis 연결 문자열 |
| `CORE_API_URL` | `http://core-api:8000` | Core API 주소 |
| `LOG_LEVEL` | `info` | 로깅 수준 |
| `SOCKET_IO_HEARTBEAT` | `25000` | Heartbeat 간격 (밀리초) |
| `SOCKET_IO_TIMEOUT` | `60000` | 연결 타임아웃 (밀리초) |

## Frontend (React + Vite)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `VITE_API_URL` | `http://localhost:8000` | Core API 주소 (브라우저에서 접근) |
| `VITE_WS_URL` | `ws://localhost:3000` | WebSocket 서버 주소 |
| `VITE_ENV` | `development` | 환경 (development, production) |

## 로컬 개발 설정

### .env.example (루트 디렉토리)

```bash
# Database
POSTGRES_USER=user
POSTGRES_PASSWORD=password
POSTGRES_DB=booking_system

# Redis
REDIS_URL=redis://redis:6379

# Core API
DATABASE_URL=postgresql://user:password@postgres:5432/booking_system
DEBUG=true
LOG_LEVEL=debug
SECRET_KEY=your-secret-key-for-local-dev
JWT_ALGORITHM=HS256
JWT_EXPIRATION_HOURS=24
CORS_ORIGINS=["http://localhost:3001","http://localhost:5173"]

# WebSocket Service
PORT=3000
NODE_ENV=development
CORE_API_URL=http://core-api:8000
SOCKET_IO_HEARTBEAT=25000
SOCKET_IO_TIMEOUT=60000

# Frontend
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:3000
VITE_ENV=development
```

## Docker Compose 환경

docker-compose.yml의 `environment:` 섹션에서 이미 설정됩니다:

```yaml
core-api:
  environment:
    DATABASE_URL: postgresql://user:password@postgres:5432/booking_system
    REDIS_URL: redis://redis:6379
    DEBUG: "true"
    LOG_LEVEL: "info"
```

## Kubernetes 환경

`infra/k8s/base/shared/configmap.yaml` 및 `secret.yaml`에서 관리합니다.

**ConfigMap (공개 설정):**
```yaml
REDIS_URL: "redis://redis-cluster:6379"
CORE_API_URL: "http://core-api:80"
```

**Secret (민감 정보):**
```yaml
DATABASE_URL: "postgresql://user:password@postgres:5432/booking_system"
SECRET_KEY: "production-secret-key"
```

## 환경별 설정값

### 개발 (Development)
```
DEBUG=true
LOG_LEVEL=debug
JWT_EXPIRATION_HOURS=24
```

### 스테이징 (Staging)
```
DEBUG=false
LOG_LEVEL=info
JWT_EXPIRATION_HOURS=24
```

### 프로덕션 (Production)
```
DEBUG=false
LOG_LEVEL=warning
JWT_EXPIRATION_HOURS=1
CORS_ORIGINS=["https://example.com"]
```

## 주의사항

1. **SECRET_KEY는 절대 공개하지 말 것**
   - `.env` 파일은 `.gitignore`에 포함
   - Kubernetes Secret으로 관리

2. **DATABASE_URL 형식 주의**
   ```
   postgresql://user:password@host:port/dbname
   ```

3. **CORS_ORIGINS 설정**
   - 개발: localhost 모두 허용
   - 프로덕션: 명시적으로 지정

4. **로깅 레벨**
   - 개발: `debug` (상세 로그)
   - 프로덕션: `warning` (주요 이벤트만)
