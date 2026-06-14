# k8s 통합 마이그레이션 변경사항

> 기준 커밋: `d675b05` (docs: Week 4 완료 상태 체크 및 계획서 업데이트)
> 브랜치: `develop`

## 배경

Docker Compose와 Kubernetes를 혼용하면서 발생한 환경 불일치(401 Unauthorized, 서비스명 오류, 시크릿 불일치 등)를 해결하기 위해 **모든 서비스를 Kubernetes(Docker Desktop)로 통일**하였다.

---

## 1. 애플리케이션 코드

### `apps/core-api/Dockerfile`

```dockerfile
# 추가된 줄
COPY alembic/ ./alembic/
COPY alembic.ini .
COPY data/ ./data/
```

- **이유**: 기존 이미지에 `alembic/`, `alembic.ini`, `data/seeds/` 가 누락되어 k8s 파드 안에서 `alembic upgrade head` 및 시드 스크립트 실행이 불가능했음

---

### `apps/core-api/src/main.py`

- **중복 코드 제거**: `lifespan` 함수가 2개 정의되어 첫 번째가 두 번째에 완전히 덮어씌워지는 버그 수정
- `logging.basicConfig()` 중복 호출 제거
- `settings = get_settings()` 중복 호출 제거
- 미사용 `from prometheus_client import Counter as PromCounter` import 제거

---

### `apps/core-api/src/database/seed.py`

```python
# 추가된 사용자
{
    "user_id": "00000000-0000-0000-0000-000000000001",
    "email": "devuser@test.com",
    "name": "Dev User",
    "phone": "010-0000-0001",
}
```

- **이유**: 프론트엔드 `QueuePage.jsx`가 `DEV_USER_ID = '00000000-0000-0000-0000-000000000001'`를 하드코딩하고 있으며, 예약 테이블에 `user_id` FK 제약이 있어 해당 UUID가 DB에 없으면 예약 시 500 오류 발생

---

### `apps/websocket-service/src/server.js`

```js
// Express HTTP 라우트에 CORS 미들웨어 추가
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', config.CORS_ORIGIN)
  res.header('Access-Control-Allow-Credentials', 'true')
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
```

- **이유**: Socket.IO는 자체 CORS 설정이 있으나, Express HTTP 라우트(`/health`, `/stats`, `/metrics`)에는 CORS 헤더가 없어 브라우저에서 직접 호출 불가

---

## 2. Kubernetes 매니페스트

### 공통 변경사항 (전체 Deployment/Service)

| 항목 | 이전 | 이후 | 이유 |
|------|------|------|------|
| `namespace` | `ticket-system` | `default` | `ticket-system` 네임스페이스가 로컬에 존재하지 않음 |
| 컨테이너 이미지 | ECR URL (`076812850421.dkr.ecr...`) | 로컬 이미지명 | 로컬 Docker Desktop 환경; ECR 접근 불가 |
| `imagePullPolicy` | `IfNotPresent` | `Never` | 로컬 빌드 이미지를 반드시 사용하도록 강제 |

---

### `infra/k8s/base/core-api/deployment.yaml`

| 항목 | 이전 | 이후 |
|------|------|------|
| `replicas` | 3 | 2 |
| `resources.requests.cpu` | 250m | 100m |
| `resources.requests.memory` | 256Mi | 128Mi |

- **이유**: Docker Desktop 단일 노드의 메모리 제약(약 4GB)으로 3개 파드 기동 시 OOM 및 스케줄링 실패 발생

---

### `infra/k8s/base/core-api/service.yaml`

| 항목 | 이전 | 이후 |
|------|------|------|
| `type` | `ClusterIP` | `LoadBalancer` |
| `port` | 80 | 8000 |

- **이유**: ClusterIP는 클러스터 외부에서 접근 불가. Docker Desktop은 LoadBalancer를 네이티브 지원하여 `localhost:8000`으로 직접 접근 가능 (포트포워드 불필요)
- port를 80→8000으로 변경하여 외부 포트와 컨테이너 포트를 일치시킴

---

### `infra/k8s/base/frontend/deployment.yaml`

- 빌드 시점 환경변수(`VITE_API_BASE_URL`, `VITE_SOCKET_URL`) 제거
  - **이유**: Vite SPA는 빌드 시점에 환경변수가 번들에 내장됨. 런타임 env는 무시되므로 해당 설정은 효과 없음
  - 기본값 `http://localhost:8000/api`, `http://localhost:3000`으로 동작
- `replicas`: 2 → 1

---

### `infra/k8s/base/frontend/service.yaml`

- `type`: `ClusterIP` → `LoadBalancer` (localhost:3001 직접 접근)

---

### `infra/k8s/base/websocket-service/deployment.yaml`

| 환경변수 | 이전 | 이후 | 이유 |
|----------|------|------|------|
| `REDIS_HOST` | `redis-service` | `redis` | 실제 k8s Service 이름과 불일치 |
| `REDIS_PASSWORD` | Secret 참조 | `""` (빈 값) | Redis에 패스워드 미설정 |
| `CORS_ORIGIN` | `https://example.com` | `http://localhost:3001` | 프론트엔드 실제 주소 |
| `API_BASE_URL` | `http://core-api-service:8000` | `http://core-api:8000` | Service 이름 불일치 + 포트 변경 반영 |
| `NODE_ENV` | `production` | `development` | 로컬 개발 환경 |
| `JWT_SECRET` | 미설정 | Secret에서 주입 | 큐 토큰 검증에 필요 |
| `INTERNAL_SECRET` | 미설정 | Secret에서 주입 | 서비스 간 내부 통신 인증 |

---

### `infra/k8s/base/websocket-service/service.yaml`

- `type`: `ClusterIP` → `LoadBalancer` (localhost:3000 직접 접근)

---

### `infra/k8s/base/shared/configmap.yaml`

| 항목 | 이전 | 이후 |
|------|------|------|
| `WEBSOCKET_ORIGIN` | `https://example.com` | `http://localhost:3001` |
| `VITE_API_URL` | `https://api.example.com` | 삭제 |
| `VITE_WS_URL` | `wss://ws.example.com` | 삭제 |
| `VITE_ENV` | `production` | 삭제 |

- VITE 관련 키 삭제: core-api 컨테이너에 주입되나 core-api는 이를 사용하지 않음. 프론트엔드 SPA는 k8s ConfigMap을 런타임에 읽을 수 없음

---

### `infra/k8s/base/shared/secret.yaml`

| 항목 | 이전 | 이후 |
|------|------|------|
| `SECRET_KEY` | `your-secret-key-for-local-development-change-in-production` | `dev-secret-key-ticket-booking-2026` |
| `INTERNAL_SECRET` | 미존재 | `dev-internal-secret-2026` 추가 |
| `redis-secret` 블록 | 존재 (`password: "redis-password-change-in-prod"`) | 삭제 |

- **이유**: Docker Compose와 k8s가 서로 다른 SECRET_KEY를 사용하여 JWT 토큰 검증 실패 발생. 통일된 값으로 고정

---

### `infra/k8s/autoscaling/core-api-hpa.yaml`

| 항목 | 이전 | 이후 |
|------|------|------|
| `namespace` | 없음 | `default` |
| `minReplicas` | 3 | 2 |
| `maxReplicas` | 30 | 10 |

---

### `infra/k8s/autoscaling/websocket-hpa.yaml`

| 항목 | 이전 | 이후 |
|------|------|------|
| `namespace` | 없음 | `default` |
| `minReplicas` | 5 | 2 |
| `maxReplicas` | 50 | 10 |
| scaleUp `Pods` value | 10 | 5 |

- **이유**: 로컬 단일 노드에서 최소 5~8개 파드 유지 시 메모리 부족으로 신규 파드 Pending → 데드락 발생

---

## 3. 신규 파일

### `infra/k8s/base/shared/postgres.yaml`

기존 프로젝트에 PostgreSQL k8s 매니페스트가 없었음. 신규 생성.

```yaml
# PersistentVolumeClaim (2Gi) - 파드 재시작 시 데이터 유지
# Deployment - postgres:15-alpine, readinessProbe 포함
# Service - ClusterIP, port 5432
```

- **이유**: `emptyDir` 사용 시 파드 재시작마다 모든 데이터 유실. PVC로 전환하여 영속성 확보

---

### `infra/k8s/base/redis-exporter/deployment.yaml`

Redis 메트릭을 Prometheus가 수집할 수 있도록 `oliver006/redis_exporter` 배포.

- `REDIS_ADDR: redis://redis:6379`
- `REDIS_EXPORTER_CHECK_KEYS: queue:*` (대기열 크기 모니터링)
- ClusterIP Service, port 9121

---

### `infra/k8s/base/monitoring/prometheus.yaml`

Prometheus v2.51.0 배포.

- **scrape targets**: core-api(:8000), websocket-service(:3000), redis-exporter(:9121), prediction-service(:8001)
- **alert rules 5개 그룹 내장**:
  - `latency_alerts`: P95 > 300ms (warning), > 1s (critical)
  - `availability_alerts`: 서비스 다운, 에러율 1% 초과
  - `queue_alerts`: 대기열 10,000명 초과, 중복 예매 발생
  - `resource_alerts`: CPU 80%, 메모리 85% 초과, Redis 다운
  - `websocket_alerts`: 메시지 지연 100ms 초과, 연결 해제 급증
- Service: `LoadBalancer`, port 9090 → **http://localhost:9090**

---

### `infra/k8s/base/monitoring/grafana.yaml`

Grafana 10.4.0 배포.

- **자동 프로비저닝** (ConfigMap 마운트):
  - Datasource: Prometheus (`http://prometheus:9090`, uid: `ticket-booking-prometheus`)
  - Dashboard: KPI 모니터링 대시보드 (Queue 대기자 수, P95 응답시간, 에러율, WebSocket 연결 수, Pod CPU/메모리)
- 관리자 계정: `admin` / `1q2w3e`
- Service: `LoadBalancer`, port 3030 → **http://localhost:3030**

---

## 4. 삭제된 파일/디렉터리

| 경로 | 이유 |
|------|------|
| `infra/prometheus/` | Docker Compose + `namespace: monitoring` 기반 구버전 매니페스트. `infra/k8s/base/monitoring/prometheus.yaml`로 대체 |
| `infra/monitoring/` | Docker Compose 볼륨 마운트용 Grafana 설정 파일. `infra/k8s/base/monitoring/grafana.yaml` ConfigMap으로 대체 |

---

## 5. 현재 서비스 접근 주소

| 서비스 | 주소 | 비고 |
|--------|------|------|
| 프론트엔드 | http://localhost:3001 | LoadBalancer |
| core-api | http://localhost:8000 | LoadBalancer |
| websocket | http://localhost:3000 | LoadBalancer |
| Prometheus | http://localhost:9090 | LoadBalancer |
| Grafana | http://localhost:3030 | LoadBalancer, admin/1q2w3e |

## 6. 초기 설정 절차 (DB 초기화 시)

```bash
# 1. 마이그레이션
kubectl exec -n default <core-api-pod> -- sh -c "cd /app && alembic upgrade head"

# 2. 시드 데이터 (이벤트 5개, 좌석 1175개/이벤트, 개발용 사용자 포함)
kubectl exec -n default <core-api-pod> -- sh -c "cd /app && python -m src.database.seed"
```

## 7. 주의사항

- **롤링 재시작 금지**: 단일 노드 메모리 제약으로 `kubectl rollout restart` 사용 시 신규 파드 Pending → 데드락. 반드시 `scale 0 → N` 방식 사용
- **이미지 빌드**: 코드 변경 후 `docker build -t <image>:latest <path>` 로 로컬 빌드 후 파드 재시작 필요
- **HPA**: 현재 비활성화 상태. 안정화 후 `kubectl apply -f infra/k8s/autoscaling/` 로 활성화
