# Infrastructure

쿠버네티스 및 인프라 관련 설정 파일들입니다.

## 구조

```
infra/
├── k8s/
│   ├── base/              # 기본 Deployment, Service, Ingress
│   └── autoscaling/       # Karpenter NodePool, HPA 설정
├── prometheus/            # 모니터링 설정
└── redis/                 # Redis Operator 설정
```

## 배포 방법

### 1. 기본 리소스 배포
```bash
kubectl apply -f k8s/base/
```

### 2. 자동 스케일링 설정
```bash
kubectl apply -f k8s/autoscaling/
```

### 3. 모니터링 설정
```bash
kubectl apply -f prometheus/
```

### 4. Redis 설정
```bash
kubectl apply -f redis/
```

## 쿠버네티스 리소스

### k8s/base/
- `deployment.yaml`: Core API, WebSocket Service 배포
- `service.yaml`: 서비스 정의
- `ingress.yaml`: 외부 트래픽 라우팅
- `configmap.yaml`: 설정 파일
- `secret.yaml`: 민감한 정보 (암호화)

### k8s/autoscaling/
- `karpenter-nodepool.yaml`: 노드 풀 자동 관리
- `hpa.yaml`: Pod 자동 스케일링 설정

### prometheus/
- `prometheus-deployment.yaml`: Prometheus 배포
- `alert-rules.yaml`: 알람 규칙
- `service-monitor.yaml`: 메트릭 수집 설정

### redis/
- `redis-operator-setup.yaml`: Redis Operator 설치
- `redis-cluster.yaml`: Redis 클러스터 설정

## 주요 설정값

### Core API
- Replicas: 3 (최소)
- Max Replicas: 10 (HPA)
- CPU Limit: 500m
- Memory Limit: 512Mi

### WebSocket Service
- Replicas: 5 (최소)
- Max Replicas: 20 (HPA)
- CPU Limit: 1000m
- Memory Limit: 1Gi

## 모니터링

### Prometheus
- 포트: 9090
- 메트릭 스크레이핑: 15초 간격

### 주요 메트릭
- `request_duration_seconds`: 요청 응답 시간
- `seat_reservation_total`: 총 예약 수
- `websocket_connections_active`: 활성 WebSocket 연결 수
- `redis_operations_total`: Redis 작업 수

## 문제 해결

### Pod이 Pending 상태
```bash
kubectl describe pod <pod-name>
kubectl logs <pod-name>
```

### 리소스 부족
```bash
# Karpenter NodePool 설정 확인
kubectl get nodepools
```

### 메트릭 수집 안 됨
```bash
# ServiceMonitor 확인
kubectl get servicemonitor
```
