# Predictive Ticket Reservation System
> Kubernetes 기반 예측형 오토스케일링 및 실시간 동기화 시스템 구현 가이드라인
> **[Team 6] 프로젝트 로드맵 & 기술 스택**

---

## 1. The Scaling Gap
**기존 티켓 예매 시스템의 한계와 도전 과제**
기존 시스템은 트래픽 폭주 시 서버 다운, 대기열 무한 루프, 좌석 중복 결제 등의 문제를 겪습니다. 우리는 이 프로젝트를 통해 예측형 인프라로 이러한 한계를 돌파해야 합니다.

---

## 2. 핵심 기술 목표 (Key Objectives)
* **Zero-Downtime 확장:** 트래픽이 발생한 후 대응하는 Reactive 방식이 아닌, 이벤트 오픈 전 자원을 선점하는 Predictive 아키텍처 구현.
* **실시간 데이터 정합성:** 분산 환경에서 수만 명의 동시 요청이 발생해도 Redis Distributed Lock을 통해 좌석 중복 선점을 완벽히 차단.

---

## 3. 기술 스택 (Technical Stack)
* **Orchestration:** Kubernetes, Karpenter, HPA, Prometheus
* **Application:** FastAPI (Python), Node.js, WebSocket
* **Data & Sync:** Redis (Pub/Sub, Lock), PostgreSQL, k6

---

## 4. 예측형 vs 반응형 트래픽 대응
* **Predictive Capacity:** 예매 오픈 시점(T) 이전에 Karpenter가 노드를 미리 웜업하여 Latency Spike를 제거합니다.
* 자원 스케줄링을 통해 트래픽 정점 도달 시 딜레이 없이 요청을 처리하는 것이 이번 아키텍처의 핵심입니다.

---

## 5. 단계별 구현 가이드라인

### Phase 1: 트래픽 제어 및 대기열
* **Redis Sorted Set** 기반 순번 관리
* **Admission Control:** 시스템 부하에 따른 유입 조절
* **SSE (Server-Sent Events):** 실시간 대기 순번 업데이트
* **Token 인증:** 대기열 통과자만 예매 API 접근 허용

### Phase 2: 실시간 좌석 동기화
* **WebSocket & Redis Pub/Sub**
* 좌석 상태 변화를 모든 클라이언트에게 **0.1초 이내**로 전파.
* Redis Pub/Sub을 메시지 브로커로 활용하여 개별 WebSocket 서버 간의 상태 불일치를 해결하고 수평 확장을 지원.

### Phase 3: 분산 락을 통한 무결성
* **Redis Distributed Lock (Redlock 알고리즘)**
* 단일 DB 트랜잭션만으로는 부족한 초고주파 동시성 제어 수행.
* 0.001초 차이로 유입되는 중복 선점 요청을 메모리 수준에서 즉각 거절 처리.

---

## 6. 데이터 아키텍처 및 상태 관리
| Component | Technology | Responsibility |
| :--- | :--- | :--- |
| **Waiting Queue** | Redis Sorted Set | FIFO 순서 보장 및 대기열 토큰 발행 |
| **Seat Status** | Redis Hash | 좌석별 실시간 상태(Available/Hold/Sold) |
| **Concurrency** | Redis Lock | Atomic 선점 보장 (Distributed Lock) |
| **Persistence** | PostgreSQL | 최종 결제 내역 및 예매 확정 데이터 저장 |

---

## 7. 성공 판정 지표 (KPIs)
* **가용성 (Availability):** 99.9% (Zero-Downtime)
* **응답 속도 (P95 Latency):** Under 300ms
* **데이터 무결성:** 0건 중복 예매
* **리소스 효율성:** 20% 비용 절감

---

## 8. UI/UX 구현 가이드라인
프론트엔드 팀은 아래 디자인 큐를 따라 주시기 바랍니다.
* **Dark Theme:** 신뢰감 있는 Navy/Black 배경에 Cyan 강조색 사용.
* **Visual Feedback:** 좌석 클릭 시 즉시 '임시 점유' 상태 색상 변경.
* **Real-time Progress:** 대기열 화면에서 실시간 게이지와 예상 대기시간 표시.
* **Mobile First:** k6 부하 테스트 시 모바일 환경의 낮은 대역폭 고려.

---
*팀원 여러분, 위 가이드라인을 바탕으로 개발을 진행해 주시기 바랍니다. 인프라 세팅이나 구체적인 로직 구현 시 더 필요한 정보(예: Redis Lock 상세 구현 코드, Karpenter 설정 파일 등)가 있다면 언제든지 PM에게 요청해 주세요.*
