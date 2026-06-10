# Week 4 진행 상태 업데이트

WEEK4_IMPLEMENTATION_PLAN.md의 각 Step 완료 시 여기에 기록합니다.  
계획 원본은 건드리지 않고, 실제 구현 내용·차이점·검증 결과를 남깁니다.

---

## Phase 1

### ✅ Step 1-1. Ingress WebSocket Sticky Session 설정
**완료일:** 2026-06-10  
**파일:** `infra/k8s/base/shared/ingress.yaml`

단일 Ingress를 두 개로 분리:
- `ticket-system-ingress` — api.example.com + example.com (sticky session 없음)
- `ticket-ws-ingress` — ws.example.com 전용, sticky session 어노테이션 7개 적용

TLS: ws 전용 `ticket-ws-tls` secret 분리. YAML 문법 검증 완료.

---

### ✅ Step 1-2. Prometheus ServiceMonitor 생성
**완료일:** 2026-06-10  
**파일:** `infra/prometheus/service-monitor.yaml` (신규)

#### 생성 리소스 (4개)

| 리소스 | kind | namespace | 비고 |
|--------|------|-----------|------|
| `redis-exporter` | Service | default | OpsTree 오퍼레이터가 9121 미노출, 별도 생성 |
| `core-api` | ServiceMonitor | monitoring | port: http (80→pod:8000) |
| `websocket-service` | ServiceMonitor | monitoring | port: http (3000→pod:3000) |
| `redis-exporter` | ServiceMonitor | monitoring | port: metrics (9121) |

#### 계획과 다른 포트

계획서는 각 서비스에 독립적인 `metrics` 포트(8001, 9090)를 추가하는 방식을 상정했으나,
실제 앱은 API와 `/metrics`를 같은 포트에서 서빙하므로 기존 `http` 포트를 재활용했습니다.

| 서비스 | 계획 포트 | 실제 구현 |
|--------|----------|----------|
| core-api | metrics:8001 | http 포트(pod:8000) 재활용 — FastAPI Instrumentator가 동일 포트 서빙 |
| websocket-service | metrics:9090 | http 포트(pod:3000) 재활용 — Express GET /metrics 동일 포트 |
| redis-exporter | metrics:9121 | 동일 ✅ — 전용 Service 신규 생성 |

#### 전제 조건
Prometheus Operator 설치 필요 (ServiceMonitor는 `monitoring.coreos.com/v1` CRD):
```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus prometheus-community/kube-prometheus-stack -n monitoring --create-namespace
```

#### prometheus-config.yaml 정리
`infra/prometheus/prometheus-config.yaml`의 `core-api`, `websocket-service` pod annotation 방식 scrape job 제거.  
ServiceMonitor로 완전 이관. 남은 job: `prometheus`(self), `kubernetes-nodes`.

#### 검증
```bash
# YAML 문법 — 완료 (Python yaml.safe_load_all 4개 문서 파싱 성공)
kubectl apply --dry-run=client -f infra/prometheus/service-monitor.yaml

# 로컬 동작 확인 (Docker Compose)
docker-compose --profile monitoring up -d
# → http://localhost:9090 접속 > Status > Targets 에서 UP 확인
```

---

## Phase 2 — 팀원 1

### ❌ Step 2-1. 예측 모델 Mock API 엔드포인트
미착수

### ❌ Step 2-2. Grafana 대시보드 템플릿
미착수 (`infra/monitoring/` 디렉터리 없음)

### ❌ Step 2-3. Flash Crowd 시나리오
미착수 (`tests/k6/queue-load-test.js`에 `ramping-arrival-rate` 없음)

---

## Phase 2 — 팀원 3

### ✅ Step 2-8. SeatMap 실시간 좌석 색상
완료 (기확인) — `useWebSocket.js`, `SeatDetailModal.jsx`

### ✅ Step 2-9. 전체 플로우 라우팅 연결
완료 (기확인) — App.jsx phase 상태머신

### ⚠️ Step 2-10. 프론트엔드 번들 최적화
부분 완료 — manualChunks 분리 완료, rollup-plugin-visualizer 미설치

---

## 미해결 사항 (팀원 1+2 공동)

### namespace 불일치
`infra/k8s/base/core-api/` 하위 파일에 `namespace: ticket-system` 누락.  
현재 websocket-service, frontend는 있고 core-api만 없음.  
그대로 apply 시 core-api가 `default` 네임스페이스에 배포됨.

수정 필요 파일:
- `infra/k8s/base/core-api/deployment.yaml`
- `infra/k8s/base/core-api/service.yaml`
