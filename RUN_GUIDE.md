# 실행 가이드

## 목차

- [로컬 실행 (Docker Compose)](#1-로컬-실행-docker-compose)
- [EKS 실행 (AWS)](#2-eks-실행-aws)

---

## 1. 로컬 실행 (Docker Compose)

### 사전 요구사항

| 도구 | 버전 |
|------|------|
| Docker Desktop | 4.x 이상 |
| Docker Compose | v2 이상 (`docker compose` 명령 사용) |

### 1-1. 환경 변수 설정

```bash
cp .env.example .env.local
```

`.env.local`을 열어 필요한 값을 수정합니다. 기본값으로도 로컬 실행은 가능합니다.

### 1-2. 서비스 실행

**전체 실행 (Core API + WebSocket + Frontend + PostgreSQL + Redis)**

```bash
docker compose up -d
```

**모니터링 포함 실행 (Prometheus + Redis Exporter + Node Exporter 추가)**

```bash
docker compose --profile monitoring up -d
```

### 1-3. DB 마이그레이션 및 시드 데이터 로드

서비스 기동 후 core-api 컨테이너에서 실행합니다.

```bash
# Alembic 마이그레이션
docker compose exec core-api alembic upgrade head

# 초기 데이터 삽입 (공연장, 이벤트, 좌석)
docker compose exec core-api python -m src.database.seed
```

### 1-4. 접속 URL

| 서비스 | URL |
|--------|-----|
| Frontend | http://localhost:3001 |
| Core API | http://localhost:8000 |
| API 문서 (Swagger) | http://localhost:8000/docs |
| WebSocket Service | http://localhost:3000 |
| Prometheus | http://localhost:9090 (`--profile monitoring` 필요) |

### 1-5. 종료

```bash
docker compose down

# 볼륨(DB 데이터)까지 삭제
docker compose down -v
```

### 1-6. 자주 쓰는 명령어

```bash
# 로그 확인
docker compose logs -f core-api
docker compose logs -f websocket-service

# 컨테이너 상태 확인
docker compose ps

# core-api 컨테이너 접속
docker compose exec core-api bash
```

---

## 2. EKS 실행 (AWS)

### 사전 요구사항

| 도구 | 설치 방법 |
|------|----------|
| AWS CLI v2 | https://aws.amazon.com/ko/cli/ |
| eksctl | https://eksctl.io/installation/ |
| kubectl | https://kubernetes.io/docs/tasks/tools/ |
| helm | https://helm.sh/docs/intro/install/ |
| Docker | https://docs.docker.com/get-docker/ |

AWS CLI 로그인이 완료되어 있어야 합니다.

```bash
aws configure
# 또는 SSO 사용 시
aws sso login --profile <profile>
```

---

### Step 1. ECR 레포지토리 및 GitHub Actions OIDC 설정

ECR 레포지토리(core-api, websocket-service, frontend)와 GitHub Actions 배포 역할을 생성합니다.

```bash
export GITHUB_ORG=<GitHub-유저명-또는-조직명>
export AWS_REGION=ap-northeast-2

bash infra/eks/ecr-setup.sh
```

완료 후 출력된 `AWS_ACCOUNT_ID` 값을 GitHub Repository Secrets에 추가합니다.

**GitHub Secrets 설정 위치:** `Settings → Secrets and variables → Actions`

| Secret 이름 | 값 |
|-------------|-----|
| `AWS_ACCOUNT_ID` | ecr-setup.sh 출력값 |

---

### Step 2. EKS 클러스터 생성 및 Karpenter 설치

클러스터 생성부터 Karpenter 설치, 애플리케이션 배포까지 자동으로 수행합니다.  
**완료까지 약 15~20분 소요됩니다.**

```bash
export AWS_REGION=ap-northeast-2
export CLUSTER_NAME=ticket-booking

bash infra/eks/setup.sh
```

스크립트가 수행하는 작업:
1. `ticket-booking` EKS 클러스터 생성 (ap-northeast-2, k8s 1.31)
2. 서브넷/보안그룹 Karpenter 디스커버리 태그 추가
3. Karpenter IAM 역할 및 노드 역할 생성
4. Spot 인터럽션 SQS 큐 및 EventBridge 규칙 생성
5. Karpenter v1.1.0 Helm 설치
6. `ticket-system` 네임스페이스 및 애플리케이션 매니페스트 배포

---

### Step 3. 이미지 빌드 및 ECR 푸시

ECR에 로그인 후 이미지를 빌드하고 푸시합니다.

```bash
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=ap-northeast-2
export ECR_REGISTRY=${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

# ECR 로그인
aws ecr get-login-password --region ${AWS_REGION} | \
  docker login --username AWS --password-stdin ${ECR_REGISTRY}

# 이미지 빌드 및 푸시
docker build -t ${ECR_REGISTRY}/core-api:latest ./apps/core-api
docker build -t ${ECR_REGISTRY}/websocket-service:latest ./apps/websocket-service
docker build \
  --build-arg VITE_API_BASE_URL=https://api.example.com \
  --build-arg VITE_SOCKET_URL=wss://ws.example.com \
  -t ${ECR_REGISTRY}/frontend:latest ./apps/frontend

docker push ${ECR_REGISTRY}/core-api:latest
docker push ${ECR_REGISTRY}/websocket-service:latest
docker push ${ECR_REGISTRY}/frontend:latest
```

> 이후 `main` 브랜치에 push하면 GitHub Actions(`deploy-eks.yml`)가 자동으로 빌드 및 배포를 수행합니다.

---

### Step 4. DB 마이그레이션 및 시드 데이터 로드

core-api 파드가 Running 상태가 된 후 실행합니다.

```bash
# 파드 상태 확인
kubectl get pods -n ticket-system

# core-api 파드명 확인 후 마이그레이션 실행
kubectl exec -n ticket-system -it deploy/core-api -- \
  alembic upgrade head

# 초기 데이터 삽입 (공연장, 이벤트, 좌석)
kubectl exec -n ticket-system -it deploy/core-api -- \
  python -m src.database.seed
```

---

### Step 5. 배포 상태 확인

```bash
# 노드 상태
kubectl get nodes

# 전체 파드 상태
kubectl get pods -n ticket-system

# 서비스 및 Ingress 확인
kubectl get svc,ingress -n ticket-system

# HPA 상태 확인
kubectl get hpa -n ticket-system

# Karpenter NodePool 확인
kubectl get nodepools
```

---

### Step 6. 모니터링 배포 (선택)

```bash
kubectl apply -f infra/k8s/base/monitoring/ -n ticket-system
kubectl apply -f infra/k8s/base/redis-exporter/ -n ticket-system
```

Prometheus와 Grafana가 `ticket-system` 네임스페이스에 배포됩니다.

```bash
# Grafana 포트 포워딩으로 로컬 접속
kubectl port-forward svc/grafana 3000:3000 -n ticket-system
# → http://localhost:3000 (기본 계정: admin / admin)

# Prometheus 포트 포워딩
kubectl port-forward svc/prometheus 9090:9090 -n ticket-system
# → http://localhost:9090
```

---

### Step 7. 부하 테스트 (선택)

```bash
# k6 Job을 쿠버네티스에서 실행
kubectl apply -f infra/k8s/testing/k6-job.yaml -n ticket-system
kubectl logs -f job/k6-load-test -n ticket-system

# 또는 로컬에서 직접 실행 (k6 설치 필요)
k6 run tests/k6/ticket-open-scenario.js
k6 run tests/k6/reservation-stress-test.js
```

---

### 트러블슈팅

**파드가 Pending 상태에서 멈출 때**

```bash
kubectl describe pod <pod-name> -n ticket-system
# Events 섹션에서 원인 확인

# Karpenter가 노드를 프로비저닝하는지 확인
kubectl logs -n kube-system -l app.kubernetes.io/name=karpenter --tail=50
```

**파드가 재시작을 반복할 때 (CrashLoopBackOff)**

```bash
kubectl logs <pod-name> -n ticket-system --previous
```

**롤링 업데이트가 멈출 때 (파드 교착)**

```bash
# scale to 0 후 재배포
kubectl scale deployment <deployment-name> --replicas=0 -n ticket-system
kubectl scale deployment <deployment-name> --replicas=2 -n ticket-system
```

**kubeconfig 갱신**

```bash
aws eks update-kubeconfig --name ticket-booking --region ap-northeast-2
```
