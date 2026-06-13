# 로컬 실행 가이드 (Docker Desktop + k8s)

> 전제: Docker Desktop이 설치되어 있고, Kubernetes가 활성화되어 있어야 합니다.  
> Settings → Kubernetes → Enable Kubernetes ✅

---

## 1. Docker Desktop 재시작 후 (일반적인 경우)

k8s 클러스터가 자동으로 재시작되고 파드도 자동 복구됩니다.  
**보통 아무것도 안 해도 됩니다.** 아래 명령어로 상태만 확인하세요.

```powershell
kubectl get pods -n ticket-system
```

모든 파드가 `Running` + `READY 1/1` 이면 바로 접속 가능합니다.

| 서비스 | 주소 |
|--------|------|
| 프론트엔드 | http://localhost:3001 |
| core-api | http://localhost:8000 |
| WebSocket | http://localhost:3000 |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3030 (admin / 1q2w3e) |

---

## 2. 파드가 안 뜰 때 (이미지가 없는 경우)

`ErrImagePull` 또는 `ImagePullBackOff` 상태이면 로컬 이미지를 다시 빌드해야 합니다.

### 2-1. 이미지 빌드

```powershell
# core-api (LSTM 모델 빌드 포함, 2~3분 소요)
docker build -t core-api:latest apps/core-api/

# websocket-service
docker build -t ticketbooking-websocket-service:latest apps/websocket-service/

# frontend
docker build -t ticketbooking-frontend:latest apps/frontend/
```

### 2-2. 파드 재시작

```powershell
kubectl rollout restart deployment/core-api -n ticket-system
kubectl rollout restart deployment/websocket-service -n ticket-system
kubectl rollout restart deployment/frontend -n ticket-system
```

> ⚠️ **주의**: 단일 노드 메모리 제약으로 `rollout restart`가 deadlock될 수 있습니다.  
> 파드가 `Pending` 상태로 멈추면 아래 방식을 사용하세요.
>
> ```powershell
> kubectl scale deployment/core-api --replicas=0 -n ticket-system
> kubectl scale deployment/core-api --replicas=2 -n ticket-system
> ```

---

## 3. 완전 초기화 (처음부터 다시 올리는 경우)

### 3-1. 네임스페이스 생성

```powershell
kubectl create namespace ticket-system
```

### 3-2. 이미지 빌드

```powershell
docker build -t core-api:latest apps/core-api/
docker build -t ticketbooking-websocket-service:latest apps/websocket-service/
docker build -t ticketbooking-frontend:latest apps/frontend/
```

### 3-3. k8s 리소스 배포

```powershell
# 공통 리소스 (ConfigMap, Secret, PostgreSQL, Redis, Ingress)
kubectl apply -f infra/k8s/base/shared/ -n ticket-system

# 애플리케이션
kubectl apply -f infra/k8s/base/core-api/ -n ticket-system
kubectl apply -f infra/k8s/base/websocket-service/ -n ticket-system
kubectl apply -f infra/k8s/base/frontend/ -n ticket-system

# 모니터링
kubectl apply -f infra/k8s/base/monitoring/ -n ticket-system
kubectl apply -f infra/k8s/base/redis-exporter/ -n ticket-system
```

### 3-4. DB 초기화 (최초 1회 또는 데이터 날아갔을 때)

core-api 파드가 Running이 된 후 실행하세요.

```powershell
# 파드 이름 확인
kubectl get pods -n ticket-system -l app=core-api

# 마이그레이션 (테이블 생성)
kubectl exec -n ticket-system <core-api-pod명> -- sh -c "cd /app && alembic upgrade head"

# 시드 데이터 (이벤트 5개, 좌석 1175개/이벤트, 개발용 유저)
kubectl exec -n ticket-system <core-api-pod명> -- sh -c "cd /app && python -m src.database.seed"
```

**예시:**
```powershell
kubectl exec -n ticket-system core-api-55c546fdbb-pztsp -- sh -c "cd /app && alembic upgrade head"
kubectl exec -n ticket-system core-api-55c546fdbb-pztsp -- sh -c "cd /app && python -m src.database.seed"
```

---

## 4. 코드 수정 후 반영

수정한 서비스만 빌드 → 재시작하면 됩니다.

```powershell
# 예: core-api 수정 후
docker build -t core-api:latest apps/core-api/
kubectl scale deployment/core-api --replicas=0 -n ticket-system
kubectl scale deployment/core-api --replicas=2 -n ticket-system
```

---

## 5. 전체 상태 확인 명령어

```powershell
# 파드 상태
kubectl get pods -n ticket-system

# 서비스 포트 확인
kubectl get svc -n ticket-system

# 특정 파드 로그
kubectl logs -n ticket-system deployment/core-api --tail=50
kubectl logs -n ticket-system deployment/websocket-service --tail=50
```
