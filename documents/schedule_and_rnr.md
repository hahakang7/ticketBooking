# K8s 기반 예측형 오토스케일링 티켓 예매 시스템
> **4주 개발 스프린트 스케줄 및 역할 분담(R&R)**
> **Team 6 프로젝트 로드맵**

---

## 1. 팀원 역할 분담 (R&R)
기획서의 3대 핵심 지표(응답 속도/가용성, 데이터 무결성, 자원 효율성)를 달성하기 위해 3 파트로 역할을 나누었습니다. (※ 실제 팀원들의 주력 기술 스택에 따라 조율 가능합니다.)

### 👩‍💻 팀원 1: Infra & 오케스트레이션 (Predictive Scaling Core)
* **주요 역할:** Kubernetes 환경 구축 및 예측형 스케일링, 부하 테스트 주도
* **담당 기술:** Kubernetes, Karpenter, HPA, Prometheus, k6, Docker
* **핵심 미션:** 예매 오픈 전 노드/Pod 사전 확장을 통한 Zero-Downtime 구현 및 A/B 테스트(Reactive vs Predictive) 진행.

### 👩‍💻 팀원 2: Backend Core & 데이터베이스 (Data Integrity Core)
* **주요 역할:** 대기열 로직 구현 및 좌석 동시성 제어(분산 락)
* **담당 기술:** FastAPI, Redis (Sorted Set, Lock), PostgreSQL
* **핵심 미션:** Redis Distributed Lock을 적용해 0.001초 차이의 충돌을 방지하고 중복 예매 0건 달성. Adaptive Admission Control 구현.

### 👨‍💻 팀원 3: Real-time Gateway & Frontend (Real-time Sync Core)
* **주요 역할:** 실시간 상태 동기화 서버 구축 및 UI/UX 연동
* **담당 기술:** Node.js, WebSocket, SSE, Redis Pub/Sub, Frontend 프레임워크
* **핵심 미션:** WebSocket과 Redis Pub/Sub을 활용해 좌석 상태 변화를 0.1초 이내에 전파하고, 대기열/좌석 시각화 UI 구현.

---

## 2. 4주 개발 마스터 스케줄

### [Week 1] 인프라 구축 및 기본 아키텍처 스캐폴딩
* **[팀원 1]** Kubernetes 클러스터 구성, Prometheus 및 Custom Metrics 수집 환경 세팅. Karpenter + HPA 초기 연동.
* **[팀원 2]** PostgreSQL 및 Redis Operator 기반 클러스터 배포. FastAPI 기본 예매 API 프로젝트 구조 생성.
* **[팀원 3]** Node.js 기반 실시간 게이트웨이(WebSocket/SSE) 초기 세팅. Dark Theme 기반 프론트엔드 UI 프레임워크 구축.
* **[공통]** API 명세서 확정 및 더미 데이터 형식 협의.

### [Week 2] Phase 1: 트래픽 제어 및 대기열 시스템
* **[팀원 2]** Redis Sorted Set 활용 대기 순번 발급/관리 로직 개발. 토큰 기반 API 접근 제어 적용.
* **[팀원 3]** SSE(Server-Sent Events) 연동으로 실시간 대기 순번/예상 시간 UI 반영. 모바일 최적화 점검.
* **[팀원 1]** k6를 활용한 대기열 API 단일 부하 테스트 환경 구축 및 기본 Rate Limiting 검증.

### [Week 3] Phase 2 & 3: 실시간 동기화 및 분산 락 구현 (가장 중요한 주차🔥)
* **[팀원 2]** 좌석 단위 Redis Distributed Lock(Redlock) 및 임시 점유(TTL) 로직 완벽 구현. DB 트랜잭션 연동.
* **[팀원 3]** WebSocket 서버 구축 및 Redis Pub/Sub 연동. 좌석 선점/취소 이벤트 발생 시 클라이언트 UI 즉각 반영 로직 개발.
* **[팀원 1]** 분산 환경(다중 Pod)에서 WebSocket 세션 유지를 위한 Ingress 및 밸런싱 설정 점검. 예측 모델(Prophet/LSTM) 기초 데이터 연동 테스트.

### [Week 4] 검증, 부하 테스트 및 시스템 최적화
* **[팀원 1]** k6 Flash Crowd 시뮬레이션 (초당 5k~10k 요청). A/B 테스트(Reactive vs Predictive) 진행 및 지표 추출.
* **[팀원 2]** 대규모 부하 상황에서의 데이터 무결성(중복 예매 0건) 및 DB 병목 현상 점검 및 쿼리 최적화.
* **[팀원 3]** 대규모 트래픽 발생 시 WebSocket 연결 유지율 점검 및 프론트엔드 렌더링 최적화.
* **[공통]** P95 응답 시간 300ms 이하 달성을 위한 전사적 튜닝. 최종 버그 픽스 및 결과 산출물(발표 자료) 완성.