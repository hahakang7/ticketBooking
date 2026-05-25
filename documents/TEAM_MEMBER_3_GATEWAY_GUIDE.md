# 팀원 3 (실시간 게이트웨이 & 프론트엔드) 개발 가이드

> **담당 기술:** Node.js, WebSocket (Socket.IO), SSE, Redis Pub/Sub, React/Vite  
> **핵심 목표:** 0.1초 이내 좌석 상태 전파 + 모바일 최적화 UI

---

## 📂 담당 파일/폴더 구조

```
apps/websocket-service/              # WebSocket 실시간 서버 (단독 소유)
├── src/
│   ├── index.js                     ✏️ 작업 대상 (서버 진입점)
│   ├── server.js                    ✏️ Express + Socket.IO 설정
│   ├── config.js                    ✏️ 환경 설정
│   │
│   ├── services/
│   │   ├── socket-service.js        ✏️ Socket.IO 이벤트 핸들러
│   │   ├── redis-service.js         ✏️ Redis Pub/Sub 관리
│   │   ├── event-service.js         ✏️ 이벤트 룸 관리
│   │   └── seat-service.js          ✏️ 좌석 상태 캐싱
│   │
│   ├── middleware/
│   │   ├── auth.js                  ✏️ 토큰 검증
│   │   ├── error-handler.js         ✏️ 에러 처리
│   │   └── logger.js                ✏️ 로깅
│   │
│   ├── utils/
│   │   ├── redis-client.js          ✏️ Redis 클라이언트
│   │   ├── logger.js                ✏️ 로깅 설정
│   │   ├── constants.js             ✏️ 상수 정의
│   │   └── validators.js            ✏️ 입력 검증
│   │
│   ├── events/
│   │   ├── subscription.js          ✏️ 구독 이벤트
│   │   ├── seat-events.js           ✏️ 좌석 이벤트
│   │   └── connection.js            ✏️ 연결 이벤트
│   │
│   └── test/
│       └── socket.test.js           ✏️ Socket.IO 테스트
│
├── package.json                     ✏️ Node.js 의존성
├── Dockerfile                       ✏️ 컨테이너 이미지
├── README.md                        ✏️ 개발 가이드
└── .eslintrc.json                  ✏️ 린트 설정

apps/frontend/                       # React 프론트엔드 (단독 소유)
├── src/
│   ├── App.jsx                      ✏️ 메인 앱 컴포넌트
│   ├── main.jsx                     ✏️ Vite 진입점
│   │
│   ├── pages/
│   │   ├── QueuePage.jsx            ✏️ 대기 화면 (Phase 1)
│   │   ├── SeatSelectionPage.jsx    ✏️ 좌석 선택 화면 (Phase 2)
│   │   ├── PaymentPage.jsx          ✏️ 결제 화면
│   │   └── ConfirmationPage.jsx     ✏️ 확인 화면
│   │
│   ├── components/
│   │   ├── QueueStatus/
│   │   │   ├── QueueStatus.jsx      ✏️ 대기 상태 표시 (SSE 연동)
│   │   │   ├── WaitTimeGauge.jsx    ✏️ 예상 시간 게이지
│   │   │   └── QueueStatus.css      ✏️ 스타일
│   │   │
│   │   ├── SeatMap/
│   │   │   ├── SeatMap.jsx          ✏️ 좌석 맵 시각화 (WebSocket 연동)
│   │   │   ├── SeatRow.jsx          ✏️ 좌석 행
│   │   │   ├── Seat.jsx             ✏️ 개별 좌석
│   │   │   └── SeatMap.css          ✏️ 스타일
│   │   │
│   │   ├── PaymentForm/
│   │   │   ├── PaymentForm.jsx      ✏️ 결제 폼
│   │   │   ├── PaymentForm.css      ✏️ 스타일
│   │   │   └── validation.js        ✏️ 결제 검증
│   │   │
│   │   └── shared/
│   │       ├── Button.jsx           ✏️ 버튼
│   │       ├── Modal.jsx            ✏️ 모달
│   │       ├── Toast.jsx            ✏️ 알림
│   │       └── Loading.jsx          ✏️ 로딩
│   │
│   ├── hooks/
│   │   ├── useQueue.js              ✏️ 대기열 상태 관리 (SSE)
│   │   ├── useWebSocket.js          ✏️ WebSocket 연결 관리
│   │   ├── useSSE.js                ✏️ SSE 연결 관리
│   │   └── useSeatSelection.js      ✏️ 좌석 선택 상태
│   │
│   ├── services/
│   │   ├── api.js                   ✏️ REST API 클라이언트 (axios)
│   │   ├── socket.js                ✏️ WebSocket 클라이언트
│   │   ├── sse.js                   ✏️ SSE 클라이언트
│   │   └── storage.js               ✏️ localStorage 관리
│   │
│   ├── styles/
│   │   ├── index.css                ✏️ 전역 스타일
│   │   ├── theme.css                ✏️ 색상 팔레트 (Dark Theme)
│   │   └── responsive.css           ✏️ 반응형 설정
│   │
│   └── utils/
│       ├── constants.js             ✏️ 상수
│       ├── formatters.js            ✏️ 데이터 포매팅
│       └── validators.js            ✏️ 입력 검증
│
├── public/
│   ├── index.html                   ✏️ HTML 템플릿
│   └── favicon.ico                  ✏️ 파비콘
│
├── package.json                     ✏️ Node.js 의존성
├── vite.config.js                   ✏️ Vite 설정
├── Dockerfile                       ✏️ 컨테이너 이미지
├── README.md                        ✏️ 개발 가이드
└── .eslintrc.json                  ✏️ 린트 설정

infra/k8s/base/websocket-service/   # K8s 배포 (너가 생성 & 관리)
├── deployment.yaml                  ✏️ Pod 배포 정의
└── service.yaml                     ✏️ 서비스 정의

infra/k8s/base/frontend/            # K8s 배포 (너가 생성 & 관리)
├── deployment.yaml                  ✏️ Pod 배포 정의
└── service.yaml                     ✏️ 서비스 정의

docker-compose.gateway.yml          ✏️ 단독 소유 (websocket + frontend)

docs/api-specs/websocket-api.md     📖 WebSocket 명세 (너가 초안, 팀 리뷰)
```

---

## 📅 4주 스케줄 & 작업 목록

### ⏰ Week 1: WebSocket + Frontend 기본 구조

**목표:** 프로젝트 스캐폴딩, 디자인 시스템 완성

#### 할일 체크리스트:

```
[x] WebSocket 서버 초기화
    └─ 위치: apps/websocket-service/src/
       ├─ [x] package.json 작성 (socket.io, express, redis)
       ├─ [x] index.js 작성 (서버 진입점)
       ├─ [x] server.js 작성 (Express + Socket.IO 설정)
       ├─ [x] config.js 작성 (환경변수 로드)
       └─ [x] 기본 라우터 설정 (health, stats 엔드포인트)

[x] Redis 클라이언트 설정
    └─ 위치: apps/websocket-service/src/utils/
       ├─ [x] redis-client.js 작성 (연결 관리)
       ├─ [x] constants.js 작성 (key naming)
       └─ [ ] Redis 연결 테스트 (통합 테스트 별도 필요)

[x] Socket.IO 이벤트 기초
    └─ 위치: apps/websocket-service/src/
       ├─ [x] connection 이벤트 구현
       ├─ [x] disconnect 이벤트 구현
       └─ [x] error 핸들러 구현

[x] Frontend 프로젝트 초기화
    └─ 위치: apps/frontend/
       ├─ [x] npm create vite@latest
       ├─ [x] React 기본 구조 설정
       ├─ [x] Tailwind CSS 설정
       └─ [x] ESLint + Prettier 설정

[x] Dark Theme 디자인 시스템
    └─ 위치: apps/frontend/src/styles/
       ├─ [x] theme.css 작성
       │   └─ Color: Navy (#0F2942), Black (#1A1A1A), Cyan (#00D9FF)
       ├─ [x] responsive.css 작성 (모바일 최적화)
       └─ [x] 컴포넌트 기본 스타일 정의

[x] 공유 컴포넌트 라이브러리
    └─ 위치: apps/frontend/src/components/shared/
       ├─ [x] Button.jsx (primary, secondary, danger)
       ├─ [x] Modal.jsx (기본 모달)
       ├─ [x] Toast.jsx (알림)
       └─ [x] Loading.jsx (로딩 상태)

[x] API 클라이언트 설정
    └─ 위치: apps/frontend/src/services/
       ├─ [x] api.js 작성 (axios 인스턴스, 토큰 인터셉터)
       ├─ [x] socket.js 작성 (Socket.IO 클라이언트)
       └─ [x] sse.js 작성 (SSE 클라이언트)

[x] Docker 설정
    └─ [x] Dockerfile 작성 (websocket)
    └─ [x] Dockerfile 작성 (frontend)
    └─ [x] docker-compose.gateway.yml 작성

[x] K8s 배포 설정
    └─ 위치: infra/k8s/base/
       ├─ [x] websocket-service/deployment.yaml
       ├─ [x] websocket-service/service.yaml
       ├─ [x] frontend/deployment.yaml
       └─ [x] frontend/service.yaml

[x] CI/CD 파이프라인
    └─ 위치: .github/workflows/
       ├─ [x] ci-websocket.yml 작성 (npm test, eslint)
       └─ [x] ci-frontend.yml 작성 (vite build, eslint)

[x] 문서 작성
    └─ 위치: apps/websocket-service/README.md
       ├─ [x] 구조 설명
       ├─ [x] 개발 가이드
       └─ [x] Socket.IO 이벤트 정리
    └─ 위치: apps/frontend/README.md
       ├─ [x] 구조 설명
       ├─ [x] 디자인 시스템 문서
       └─ [x] 개발 가이드
```

**협업 포인트:**
- 팀원 2와: API 응답 형식 확정
- 팀원 1과: K8s 리소스 요청값 (CPU, Memory) 공유
- 팀원 2, 3: SSE 이벤트 형식 확정

---

### ⏰ Week 2: Phase 1 - 대기 화면 + SSE 연동

**목표:** 실시간 대기 상태 표시 완성

#### 할일 체크리스트:

```
[x] QueuePage 컴포넌트
    └─ 위치: apps/frontend/src/pages/QueuePage.jsx
       ├─ [x] 대기 상태 표시 (위치, 예상 시간)
       ├─ [x] 실시간 업데이트 (SSE 연동)
       └─ [x] 로딩 상태 처리 (idle/joining/waiting/ready/error 분기)

[x] QueueStatus 컴포넌트
    └─ 위치: apps/frontend/src/components/QueueStatus/
       ├─ [x] QueueStatus.jsx (현재 위치 + 예상 대기 시간 카드)
       ├─ [x] WaitTimeGauge.jsx (실시간 경과 시간 게이지)
       └─ [x] QueueStatus.css (라이트 테마: #3B82F6, #F9FAFB)

[x] useQueue Hook
    └─ 위치: apps/frontend/src/hooks/useQueue.js
       ├─ [x] SSE 연결 관리 (sseService 통합)
       ├─ [x] 위치 업데이트 처리 (queue_update 이벤트)
       ├─ [x] 대기 시간 계산 (estimated_wait_time)
       └─ [x] 에러 처리 (joinQueue 실패, SSE 연결 오류)

[x] SSE 클라이언트
    └─ 위치: apps/frontend/src/services/sse.js
       ├─ [x] EventSource 연결 (GET /api/queue/sse?token=...)
       ├─ [x] 이벤트 리스너 등록 (queue_update, queue_token_ready)
       ├─ [x] 자동 재연결 로직 (지수 백오프, 최대 5회)
       └─ [ ] 토큰 갱신 처리 (미구현 - Week 3 이후)

[x] 토큰 관리
    └─ 위치: apps/frontend/src/services/storage.js
       ├─ [x] queue_token 저장/조회
       ├─ [x] access_token 저장/조회
       └─ [ ] 토큰 만료 처리 (만료 시간 비교 로직 미구현)

[x] WebSocket 기초 준비
    └─ 위치: apps/websocket-service/src/
       ├─ [x] subscribe_event 이벤트 구현 (event_id snake_case)
       ├─ [x] subscription_confirmed 이벤트 구현 (event_id, room, clients_in_room)
       └─ [x] connection_info 이벤트 구현 (socket_id, server_time, version)

[ ] WebSocket 테스트
    └─ [ ] Socket.IO 클라이언트 테스트
    └─ [ ] 기본 이벤트 송수신 테스트

[ ] 단위 테스트
    └─ 위치: apps/frontend/src/hooks/
       ├─ [ ] useQueue Hook 테스트
       ├─ [ ] SSE 연결 테스트
       └─ [ ] 토큰 관리 테스트

[ ] 팀원 1에게 정보 제공
    └─ [ ] Queue API 응답 형식 확인
    └─ [ ] k6 queue-load-test 상황 공유
```

**협업 포인트:**
- 팀원 2와: SSE 이벤트 형식 최종 확정
- 팀원 1과: k6 대기열 부하 테스트 결과 공유

---

### ⏰ Week 3: Phase 2 - 좌석 선택 화면 + WebSocket 실시간 동기화

**목표:** 좌석 맵 시각화 + 0.1초 이내 상태 업데이트

#### 할일 체크리스트:

```
[ ] SeatSelectionPage 컴포넌트
    └─ 위치: apps/frontend/src/pages/SeatSelectionPage.jsx
       ├─ [ ] 좌석 맵 렌더링
       ├─ [ ] 좌석 클릭 처리
       ├─ [ ] 선택 좌석 표시
       └─ [ ] 가격 계산

[ ] SeatMap 컴포넌트 (핵심🔥)
    └─ 위치: apps/frontend/src/components/SeatMap/
       ├─ [ ] SeatMap.jsx (좌석 맵 컨테이너, WebSocket 연동)
       ├─ [ ] SeatRow.jsx (좌석 행)
       ├─ [ ] Seat.jsx (개별 좌석, 상태 표시)
       └─ [ ] SeatMap.css (반응형 그리드, 다크 테마)

[ ] Seat 상태 표시
    └─ 색상 정의:
       ├─ [ ] Available: Cyan (#00D9FF)
       ├─ [ ] Hold (임시 점유): Yellow (#FCD34D)
       ├─ [ ] Sold: Gray (#6B7280)
       └─ [ ] Selected (사용자 선택): Bright Cyan

[x] useWebSocket Hook (핵심🔥)
    └─ 위치: apps/frontend/src/hooks/useWebSocket.js
       ├─ [x] WebSocket 연결 관리 (accessToken 포함)
       ├─ [x] subscribe_event 발송 (eventId 기반)
       ├─ [x] seat_status_updated 수신 처리 (seatUpdates 맵 반환)
       ├─ [x] seat_hold_expired 처리 (available로 복원)
       ├─ [x] 자동 재연결 로직 (Socket.IO 내장 exponential backoff)
       └─ [x] heartbeat 체크 (25초)

[x] WebSocket 클라이언트
    └─ 위치: apps/frontend/src/services/socket.js
       ├─ [x] Socket.IO 클라이언트 인스턴스 (accessToken auth 포함)
       ├─ [x] 이벤트 리스너 등록 함수
       ├─ [x] 이벤트 발송 함수 (subscribeToEvent 포함)
       └─ [x] 연결 상태 관리

[x] 좌석 상태 전역 상태 관리
    └─ 위치: apps/frontend/src/components/pages/SeatDetailModal.jsx
       ├─ [x] 좌석별 상태 저장 (backendSeatId 기반 WebSocket 매핑)
       ├─ [x] 사용자 선택 상태 저장
       ├─ [x] 상태 업데이트 함수 (실시간 WebSocket 반영)
       └─ [x] 중복 선택 방지 + 선점 시 자동 해제

[x] WebSocket 서버 좌석 이벤트
    └─ 위치: apps/websocket-service/src/
       ├─ [x] seat_status_updated 이벤트 구현 (subscription.js + seat-events.js)
       ├─ [ ] seat_reserved 이벤트 구현 (팀원 2 예약 API 연동 후 구현)
       ├─ [x] seat_hold_expired 처리 (seat_unhold → available 브로드캐스트)
       └─ [x] seat_availability_summary 이벤트 구현 (request_seat_summary 요청 시)

[x] Redis Pub/Sub 연동 (인프라)
    └─ 위치: apps/websocket-service/src/
       ├─ [x] Redis Pub/Sub 구독 설정 (seat-events.js: seat_updates:{event_id})
       ├─ [ ] 이벤트 발행 처리 (팀원 2 Week 3에서 Core API → Redis publish 구현 예정)
       └─ [x] 메시지 브로드캐스트 (seatService.broadcastSeatUpdate)

[ ] 성능 최적화
    └─ [ ] 좌석 렌더링 최적화 (useMemo, useCallback)
       └─ 목표: 500개 좌석도 60 FPS 유지
    └─ [ ] WebSocket 메시지 배치 처리
       └─ 동일 이벤트 여러 좌석 한 번에 전송

[ ] 모바일 최적화
    └─ [ ] 터치 이벤트 처리 (클릭과 구분)
    └─ [ ] 화면 크기별 좌석 맵 반응형 레이아웃
    └─ [ ] 모바일 성능 테스트 (Lighthouse)

[ ] 고급 테스트
    └─ 위치: apps/websocket-service/src/test/ + apps/frontend/
       ├─ [ ] WebSocket 연결 테스트
       ├─ [ ] 메시지 전송/수신 테스트
       ├─ [ ] 0.1초 이내 업데이트 성능 테스트
       ├─ [ ] 재연결 테스트
       └─ [ ] 동시 100+ 연결 테스트

[ ] Ingress WebSocket sticky session 설정
    └─ [ ] 팀원 1과 협의하여 설정 (페어 작업)
       └─ 같은 클라이언트는 항상 같은 서버로 라우팅
```

**협약 포인트:**
- 팀원 1, 3: WebSocket sticky session 페어 작업
- 팀원 2, 3: Redis Pub/Sub 메시지 형식 확정
- 팀원 1, 2, 3: 실시간 동기화 성능 측정 (목표: 0.1초)

---

### ⏰ Week 4: 결제 화면 + 부하 테스트 & 성능 최적화

**목표:** 전체 사용자 여정 완성, 모바일 Lighthouse > 85

#### 할일 체크리스트:

```
[x] PaymentPage 컴포넌트
    └─ 위치: apps/frontend/src/pages/PaymentPage.jsx
       ├─ [x] 결제 폼 렌더링 (PaymentForm 컴포넌트 포함)
       ├─ [x] 결제 정보 표시 (이벤트, 선택 좌석, 총 금액)
       └─ [x] 결제 진행 상태 표시 (로딩 스피너, 에러 배너)

[x] PaymentForm 컴포넌트
    └─ 위치: apps/frontend/src/components/PaymentForm/
       ├─ [x] 카드 정보 입력 (카드번호 자동 포맷, 만료일 MM/YY, CVV 마스킹)
       ├─ [x] 결제 버튼 (로딩 상태 + 총 금액 표시)
       ├─ [x] 오류 메시지 (필드별 + API 에러 배너)
       └─ [x] PaymentForm.css (라이트 테마)
       ※ 실제 결제: 팀원 2 결제 API 연동 시 mock → 실API로 교체

[x] ConfirmationPage 컴포넌트
    └─ 위치: apps/frontend/src/pages/ConfirmationPage.jsx
       ├─ [x] 주문 정보 표시 (예약번호, 이벤트, 좌석, 금액, 결제시각)
       ├─ [x] 티켓 다운로드 (txt 파일 생성)
       └─ [x] 공유 버튼 (Web Share API / 클립보드 복사 fallback)

[ ] 부하 테스트 결과 분석
    └─ [ ] k6 websocket-load-test 결과 검토 (팀원 1과)
    └─ [ ] WebSocket 연결 안정성 확인
    └─ [ ] 메시지 처리 지연 측정

[ ] 성능 최적화 (핵심🔥)
    └─ [ ] Code splitting (페이지별 청크)
    └─ [ ] 번들 크기 분석 (< 150KB 목표)
    └─ [ ] 이미지 최적화 (WebP, lazy loading)
    └─ [ ] CSS 최소화 (Tailwind purge)
    └─ [ ] JavaScript 최소화

[ ] 모바일 성능 측정
    └─ [ ] Lighthouse 점수 측정 (> 85 목표)
    └─ [ ] 모바일 네트워크 테스트 (3G, 4G)
    └─ [ ] 브라우저 호환성 테스트 (Safari, Chrome, Firefox)

[ ] 오프라인 모드 준비 (선택)
    └─ [ ] localStorage에 대기 토큰 캐싱
    └─ [ ] 인터넷 연결 상태 감지
    └─ [ ] 오프라인 상태 UI 표시

[ ] 최종 검증
    └─ [ ] 전체 사용자 여정 테스트 (대기 → 좌석 선택 → 결제)
    └─ [ ] 에러 처리 검증 (404, 500, 타임아웃)
    └─ [ ] 보안 체크 (CORS, XSS, CSRF)
    └─ [ ] 접근성 체크 (WCAG 2.1 AA)

[ ] WebSocket 서버 최적화
    └─ 위치: apps/websocket-service/src/
       ├─ [ ] 메모리 누수 확인
       ├─ [ ] 연결 타임아웃 처리
       ├─ [ ] 에러 로깅 개선

[ ] 발표 자료 준비
    └─ [ ] 사용자 여정 시연 (대기 → 좌석 선택 → 결제)
    └─ [ ] 실시간 동기화 성능 지표
    └─ [ ] 모바일 최적화 결과
    └─ [ ] 0.1초 이내 전파 달성 검증
```

**협업 포인트:**
- 팀원 1, 2, 3: 전체 시스템 통합 테스트
- 팀원 1: 부하 테스트 (WebSocket 50k+ msg/sec) 결과 분석

---

## 🎯 주요 작업 영역

### 1️⃣ WebSocket 실시간 동기화 (핵심🔥)

**아키텍처:**
```
Core API (좌석 변경)
    ↓
Redis Pub/Sub (발행)
    ↓
WebSocket Service (구독 & 브로드캐스트)
    ↓
모든 클라이언트 (0.1초 이내 수신)
```

**구현 파일:**
```
apps/websocket-service/src/
├── services/redis-service.js    # Redis Pub/Sub 관리
├── services/socket-service.js   # Socket.IO 브로드캐스트
└── events/seat-events.js        # 좌석 이벤트 핸들러

apps/frontend/src/
├── hooks/useWebSocket.js         # WebSocket 연결
└── components/SeatMap/SeatMap.jsx # 실시간 업데이트
```

**성능 목표:**
```
- 메시지 지연: < 100ms (P95)
- 처리량: 50,000+ msg/sec
- 동시 연결: 10,000+
```

---

### 2️⃣ 좌석 맵 시각화 (UI/UX)

**파일:**
```
apps/frontend/src/components/SeatMap/
├── SeatMap.jsx      # 맵 컨테이너, WebSocket 연동
├── SeatRow.jsx      # 좌석 행
├── Seat.jsx         # 개별 좌석 (상태 표시)
└── SeatMap.css      # 반응형 그리드 레이아웃
```

**상태 색상:**
```css
/* Dark Theme 기준 */
.seat.available {
  background: #00D9FF;  /* Cyan - 구매 가능 */
}

.seat.hold {
  background: #FCD34D;  /* Yellow - 임시 점유 */
}

.seat.sold {
  background: #6B7280;  /* Gray - 판매 완료 */
}

.seat.selected {
  background: #06B6D4;  /* Bright Cyan - 사용자 선택 */
  border: 3px solid #0891B2;
}
```

**반응형 레이아웃:**
```
Desktop: 20 seats/row
Tablet:  15 seats/row
Mobile:  10 seats/row
```

---

### 3️⃣ 대기 화면 (SSE)

**파일:**
```
apps/frontend/src/
├── pages/QueuePage.jsx                    # 대기 화면
├── components/QueueStatus/QueueStatus.jsx # 대기 정보
├── components/QueueStatus/WaitTimeGauge.jsx # 시간 게이지
└── hooks/useQueue.js                      # SSE 관리
```

**UI 요소:**
```
┌─────────────────────────────┐
│  🕐 예상 대기 시간: 15분     │
├─────────────────────────────┤
│  📍 현재 위치: 150번        │
├─────────────────────────────┤
│  ████████░░░░░░░░░░░░░░░░░░  50%
├─────────────────────────────┤
│  "이제 대기 중입니다..."      │
│  "자리가 나면 알려드릴게요" │
└─────────────────────────────┘
```

---

## 🔗 팀 협업 포인트

| 주차 | 협업 대상 | 협의 내용 |
|------|---------|---------|
| Week 1 | 팀원 2 | API 응답 형식, SSE 이벤트 |
| Week 1 | 팀원 1 | K8s 리소스 (CPU, Memory) |
| Week 2 | 팀원 1 | Queue API 부하 테스트 결과 |
| Week 3 | 팀원 1, 3 | WebSocket sticky session 설정 |
| Week 3 | 팀원 2, 3 | Redis Pub/Sub 메시지 형식 |
| Week 4 | 팀원 1, 2, 3 | 부하 테스트 결과 분석 |

---

## 🛠️ 자주 사용할 명령어

```bash
# WebSocket 서버 시작
cd apps/websocket-service
npm install
npm run dev

# Frontend 개발 서버
cd apps/frontend
npm install
npm run dev  # http://localhost:5173

# Docker 로컬 테스트
docker-compose -f docker-compose.gateway.yml up

# 성능 테스트
npm run build && npm run preview

# Lighthouse 측정
npx lighthouse http://localhost:3001

# Socket.IO 디버깅
# 브라우저 콘솔에서
socket.emit('subscribe_event', {
  event_id: 'evt-123',
  access_token: 'token-abc'
});
```

---

## 📌 주간 체크리스트

### Week 1 Day 1
- [ ] 프로젝트 구조 스캐폴딩 완료
- [ ] Dark Theme 색상 팔레트 확정
- [ ] API/WebSocket 명세 팀 리뷰

### Week 1 Day 5
- [ ] WebSocket + Frontend 개발 환경 완성
- [ ] docker-compose gateway 정상 기동
- [ ] 기본 이벤트 송수신 테스트 완료

### Week 2 Day 5
- [ ] QueuePage + SSE 연동 완성
- [ ] useQueue Hook 동작 확인
- [ ] 팀원 2 API 응답 형식 확정

### Week 3 Day 5
- [ ] SeatMap 컴포넌트 완성
- [ ] WebSocket 좌석 실시간 업데이트 확인 (< 0.1초)
- [ ] 모바일 반응형 레이아웃 테스트

### Week 4 Day 5
- [ ] 전체 사용자 여정 테스트 (대기 → 좌석 → 결제)
- [ ] Lighthouse 점수 > 85 달성
- [ ] 부하 테스트 결과 정리
