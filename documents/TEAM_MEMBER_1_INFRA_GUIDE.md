# 팀원 1 (인프라 & 오케스트레이션) 개발 가이드

> **담당 기술:** Kubernetes, Karpenter, HPA, Prometheus, k6, Docker  
> **핵심 목표:** Zero-Downtime 예측형 오토스케일링 구현

---

## 📂 담당 파일/폴더 구조

```
infra/                                # 전체 인프라 영역 (단독 소유)
├── k8s/
│   ├── base/
│   │   ├── shared/                   # ← Ingress, ConfigMap, Secret
│   │   │   ├── ingress.yaml          ✏️ 작업 대상
│   │   │   ├── configmap.yaml        ✏️ 작업 대상
│   │   │   └── secret.yaml           ✏️ 작업 대상
│   │   ├── core-api/                 # 팀원 2가 생성, 너는 리뷰
│   │   ├── websocket-service/        # 팀원 3이 생성, 너는 리뷰
│   │   └── frontend/                 # 팀원 3이 생성, 너는 리뷰
│   ├── autoscaling/                  # 전체 소유
│   │   ├── karpenter-nodepool.yaml   ✏️ 작업 대상
│   │   ├── core-api-hpa.yaml         ✏️ 작업 대상 (팀원 2 리뷰 필수)
│   │   └── websocket-hpa.yaml        ✏️ 작업 대상 (팀원 3 리뷰 필수)
│   └── README.md                     ✏️ 작업 대상
├── prometheus/                        # 전체 소유
│   ├── prometheus.yml                ✏️ 작업 대상
│   ├── alert-rules.yaml              ✏️ 작업 대상
│   └── service-monitor.yaml          ✏️ 작업 대상
├── redis/                            # 전체 소유
│   ├── redis-operator-setup.yaml     ✏️ 작업 대상
│   └── redis-cluster.yaml            ✏️ 작업 대상
├── monitoring/                       # 전체 소유 (선택사항)
└── README.md                         ✏️ 작업 대상

tests/k6/                             # 전체 소유
├── queue-load-test.js                ✏️ Week 2 작업 대상
├── reservation-stress-test.js        ✏️ Week 3 작업 대상
├── websocket-load-test.js            ✏️ Week 3 작업 대상
└── README.md                         ✏️ 작업 대상

.github/
├── CODEOWNERS                        ✏️ 단독 관리
├── workflows/
│   ├── ci-infra.yml                  ✏️ 작업 대상
│   └── load-test.yml                 ✏️ 작업 대상
└── workflows/ (타팀)                 # 리뷰만

docker-compose.yml                    ✏️ 단독 소유 (infra 서비스만)

docs/
├── redis-config-guide.md             📖 전원 공동 (변경 시 협의)
├── env-variables.md                  📖 전원 공동 (변경 시 협의)
└── branching-strategy.md             📖 전원 공동 (변경 시 협의)
```

---

## 📅 4주 스케줄 & 작업 목록

### ⏰ Week 1: 인프라 기본 구축

**목표:** K8s 환경 완성, 모니터링 기초 구축

#### 할일 체크리스트:

```
[x] K8s base 구조 생성
    └─ 위치: infra/k8s/base/shared/
       ├─ [x] ingress.yaml 작성 (core-api, websocket, frontend 라우팅)
       ├─ [x] configmap.yaml 작성 (공통 환경변수)
       └─ [x] secret.yaml 작성 (민감 정보)

[x] K8s autoscaling 설정
    └─ 위치: infra/k8s/autoscaling/
       ├─ [x] karpenter-nodepool.yaml 작성
       ├─ [x] core-api-hpa.yaml 작성
       └─ [x] websocket-hpa.yaml 작성

[x] Prometheus 기초 설정 (service-monitor.yaml 미완)
    └─ 위치: infra/prometheus/
       ├─ [x] prometheus.yml 작성
       ├─ [x] alert-rules.yaml 작성
       └─ [ ] service-monitor.yaml 작성

[x] Redis Operator 설정
    └─ 위치: infra/redis/
       ├─ [x] redis-operator-setup.yaml
       └─ [x] redis-cluster.yaml

[x] Docker Compose 기본 설정
    └─ 위치: docker-compose.yml
       ├─ [x] PostgreSQL 서비스 설정
       ├─ [x] Redis 서비스 설정
       └─ [x] Prometheus 서비스 설정

[x] CI/CD 워크플로우 설정
    └─ 위치: .github/workflows/
       ├─ [x] ci-infra.yml 작성 (yamllint, kubernetes validate)
       └─ [x] CODEOWNERS 파일 관리

[~] 문서 작성 (infra/README.md는 완료, infra/k8s/README.md 미완)
    └─ 위치: infra/README.md
       ├─ [x] K8s 배포 방법
       ├─ [x] 구조 설명
       └─ [x] 트러블슈팅 가이드
```

**협업 포인트:**
- 팀원 2, 3과 K8s/ConfigMap/Secret 구조 협의
- 팀원 2: core-api CPU/Memory 요청값 공유 받기
- 팀원 3: websocket CPU/Memory 요청값 공유 받기

---

### ⏰ Week 2: 대기열 부하 테스트

**목표:** k6로 대기열 API 부하 테스트 구축

#### 할일 체크리스트:

```
[x] k6 기본 환경 설정
    └─ 위치: tests/k6/
       └─ [x] README.md 작성 (k6 설치, 실행 방법)

[x] Queue Load Test 작성
    └─ 위치: tests/k6/queue-load-test.js
       ├─ [x] 대기열 진입 API 테스트
       ├─ [x] RPS 측정 (목표: 100+ concurrent users)
       └─ [x] 메트릭 수집 (응답 시간, 에러율)

[x] CI/CD 파이프라인 테스트
    └─ 위치: .github/workflows/
       └─ [x] ci-infra.yml 동작 확인

[ ] Prometheus 메트릭 수집 확인 (런타임 검증 필요)
    └─ 위치: infra/prometheus/
       ├─ [ ] Pod CPU/Memory 메트릭 수집 확인
       └─ [ ] k6 테스트 결과 시각화

[ ] Docker Compose 검증 (런타임 검증 필요)
    └─ [ ] docker-compose up 정상 기동 확인
    └─ [ ] 모든 서비스 헬스체크 통과
```

**협업 포인트:**
- 팀원 2에게 queue API 엔드포인트, 필수 파라미터 요청
- 팀원 2와 함께 k6 테스트 초안 리뷰

---

### ⏰ Week 3: 분산 락 & 예측 모델 기초

**목표:** 고급 오토스케일링, WebSocket 부하 테스트

#### 할일 체크리스트:

```
[ ] 예측 모델 기초 데이터 연동 준비
    └─ 위치: infra/k8s/ (간접 지원)
       ├─ [ ] ML 모델 저장소 경로 준비
       ├─ [ ] K8s Volume 설정 (모델 파일 마운트)
       └─ [ ] ConfigMap에 모델 경로 추가

[x] Reservation Stress Test 작성
    └─ 위치: tests/k6/reservation-stress-test.js
       ├─ [x] 좌석 예약 API 테스트
       ├─ [x] 분산 락 동시성 테스트 (RPS 5k~10k)
       ├─ [x] 중복 예매 검증
       └─ [x] DB 병목 현상 측정

[x] WebSocket Load Test 작성
    └─ 위치: tests/k6/websocket-load-test.js
       ├─ [x] 웹소켓 연결 부하 테스트
       ├─ [x] 메시지 처리량 측정 (목표: 50k+ msg/sec)
       └─ [x] 연결 안정성 확인

[x] Karpenter 예측형 스케일링 설정
    └─ 위치: infra/k8s/autoscaling/
       ├─ [x] NodePool consolidation 정책 설정
       ├─ [x] 비용 최적화 전략 추가
       └─ [x] 예측 모델과 연동 준비

[x] Ingress WebSocket sticky session 설정
    └─ 위치: infra/k8s/base/shared/ingress.yaml
       ├─ [x] WebSocket persistence 설정
       └─ [x] Session affinity 구성
       ⚠️ 팀원 3과 페어 작업 필수

[ ] 모니터링 대시보드 준비
    └─ 위치: infra/prometheus/
       ├─ [ ] 예약 시스템 메트릭 정의
       ├─ [ ] 알람 규칙 추가
       └─ [ ] Grafana 대시보드 템플릿 준비
```

**협업 포인트:**
- 팀원 1, 2: `apps/core-api/src/` 수정 스케줄 조율
- 팀원 1, 3: Ingress WebSocket 설정을 Pair로 진행
- 팀원 2: 예측 모델 학습 데이터 포맷 협의

---

### ⏰ Week 4: 부하 테스트 & 최종 최적화

**목표:** 부하 테스트 자동화, KPI 달성

#### 할일 체크리스트:

```
[ ] k6 Flash Crowd 시뮬레이션
    └─ 위치: tests/k6/
       ├─ [ ] 5k~10k RPS 부하 생성
       ├─ [ ] Reactive vs Predictive A/B 테스트
       ├─ [ ] 응답 시간 P95 < 300ms 달성 확인
       └─ [ ] 결과 리포트 작성

[ ] CI/CD 자동화 완성
    └─ 위치: .github/workflows/
       ├─ [ ] load-test.yml 자동 실행 활성화
       └─ [ ] 부하 테스트 결과 수집 자동화

[ ] 성능 최적화
    └─ 위치: infra/k8s/autoscaling/ + infra/prometheus/
       ├─ [ ] HPA 임계값 조정 (CPU, Memory)
       ├─ [ ] Karpenter 노드 프로비저닝 최적화
       ├─ [ ] Redis 클러스터 성능 튜닝
       └─ [ ] 메모리 누수 모니터링

[ ] 최종 검증
    └─ 위치: 전체 infra/
       ├─ [ ] 가용성 99.9% 달성 확인
       ├─ [ ] 데이터 무결성 검증 (팀원 2와)
       ├─ [ ] 자동 장애 복구 테스트
       └─ [ ] 보안 체크리스트 완료

[ ] 발표 자료 준비
    └─ [ ] 인프라 아키텍처 다이어그램
    └─ [ ] A/B 테스트 결과 분석
    └─ [ ] 성능 개선 지표 정리
```

**협업 포인트:**
- 팀원 2: Week 3 완료 시 k6 시나리오 handoff 받기
- 팀원 2, 3: 부하 테스트 결과 해석 공동 회의

---

## 🎯 주요 작업 영역

### K8s Manifest 관리

**파일 저장 위치:**
```
infra/k8s/
├── base/shared/              (Ingress, ConfigMap, Secret)
├── base/core-api/            (팀원 2 리뷰)
├── base/websocket-service/   (팀원 3 리뷰)
├── base/frontend/            (팀원 3 리뷰)
└── autoscaling/              (HPA, Karpenter)
```

**작업 규칙:**
- `shared/` 수정 시: 팀원 2, 3 동의 필수
- `autoscaling/` 수정 시: 해당 팀원 리뷰 필수
- 모든 YAML: `kubectl apply --dry-run` 검증 필수

### 부하 테스트 스크립트

**파일 저장 위치:**
```
tests/k6/
├── queue-load-test.js           (Week 2)
├── reservation-stress-test.js   (Week 3)
└── websocket-load-test.js       (Week 3)
```

**작업 규칙:**
- 팀원 2에게 API 스펙 받은 후 작성
- 매주 수요일: k6 테스트 결과 리포트

### 모니터링 설정

**파일 저장 위치:**
```
infra/prometheus/
├── prometheus.yml
├── alert-rules.yaml
└── service-monitor.yaml
```

**작업 규칙:**
- 매주 팀 전체 메트릭 대시보드 공유
- Week 4: Grafana 대시보드 템플릿 완성

---

## 🔗 팀 협업 포인트

### 필수 협의 사항

| 주차 | 협업 대상 | 협의 내용 |
|------|---------|---------|
| Week 1 | 팀원 2, 3 | K8s 리소스 요청값 (CPU, Memory) |
| Week 1 | 팀원 2, 3 | Docker Compose 환경변수 통일 |
| Week 2 | 팀원 2 | Queue API 엔드포인트, 파라미터 |
| Week 2 | 팀원 1, 2, 3 | CI/CD 파이프라인 통합 테스트 |
| Week 3 | 팀원 2, 3 | 예측 모델과 K8s 연동 방식 |
| Week 3 | 팀원 1, 3 | WebSocket Sticky Session 설정 |
| Week 4 | 팀원 2 | k6 시나리오 Handoff |
| Week 4 | 팀원 1, 2, 3 | 최종 부하 테스트 결과 검증 |

### Slack 보고 규칙

```
매일 오전 10시:
  - 어제 완료: ✅ (2-3개 항목)
  - 오늘 계획: 📋 (2-3개 항목)
  - 블로커: 🚨 (있으면 명시)

매주 금요일 오후:
  - 주간 완료 항목 정리
  - 다음주 계획
  - 리소스 요청사항
```

---

## 🛠️ 자주 사용할 명령어

```bash
# K8s 매니페스트 검증
kubectl apply --dry-run=client -f infra/k8s/base/core-api/

# 현재 배포 상태 확인
kubectl get deployments -w

# Pod 로그 확인
kubectl logs -f deployment/core-api

# 메트릭 확인
kubectl top pods

# k6 테스트 실행
cd tests/k6
k6 run queue-load-test.js

# Docker Compose 상태
docker-compose ps
docker-compose logs -f

# Prometheus UI
http://localhost:9090
```

---

## 📌 체크리스트

### Week 1 Day 1 (30분)
- [x] 팀원 2, 3과 첫 킥오프 미팅 (30분)
  - K8s 리소스 요청값 수집
  - Docker Compose 환경변수 확정

### Week 1 Day 2-5
- [x] K8s base/shared/ 3개 파일 완성
- [x] K8s autoscaling/ 3개 파일 완성
- [x] Prometheus 기본 설정 완성 (service-monitor.yaml 미완)
- [x] 로컬 docker-compose up 테스트 (런타임 검증 필요)

### Week 2
- [x] k6 queue-load-test.js 완성
- [x] 부하 테스트 자동화 파이프라인 구축
- [x] 팀 전체 공유

### Week 3
- [x] k6 reservation-stress-test.js, websocket-load-test.js 완성
- [x] Ingress WebSocket 설정 (팀원 3과)
- [ ] 예측 모델 기초 데이터 연동 준비

### Week 4
- [ ] Flash Crowd 시뮬레이션 (5k~10k RPS)
- [ ] A/B 테스트 결과 분석
- [ ] 발표 자료 준비
