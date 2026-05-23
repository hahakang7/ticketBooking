# Frontend 개발 가이드

> React + Vite 기반의 티켓 예매 프론트엔드입니다.  
> 처음 보는 사람도 이 문서 하나로 구조를 파악하고 실행할 수 있도록 작성했습니다.

---

## 목차

1. [실행 방법](#1-실행-방법)
2. [전체 파일 구조](#2-전체-파일-구조)
3. [화면 흐름 (사용자 여정)](#3-화면-흐름-사용자-여정)
4. [각 파일 설명](#4-각-파일-설명)
5. [서버와의 통신 방식](#5-서버와의-통신-방식)
6. [환경 변수](#6-환경-변수)
7. [자주 하는 실수](#7-자주-하는-실수)

---

## 1. 실행 방법

### 로컬에서 바로 실행

```bash
# 1. 이 폴더로 이동
cd apps/frontend

# 2. 패키지 설치 (처음 한 번만)
npm install

# 3. 개발 서버 시작
npm run dev
```

브라우저에서 **http://localhost:5173** 접속

> **주의:** Core API(`http://localhost:8000`)와 WebSocket 서버(`http://localhost:3000`)가 함께 켜져 있어야 제대로 동작합니다.  
> 혼자 프론트엔드만 실행하면 대기열 API 요청이 실패하지만, UI 구조 확인은 가능합니다.

---

### Docker로 전체 실행 (권장)

```bash
# 프로젝트 루트에서
docker-compose -f docker-compose.gateway.yml up
```

| 서비스 | 주소 |
|--------|------|
| 프론트엔드 | http://localhost:5173 |
| WebSocket 서버 | http://localhost:3000 |
| Core API | http://localhost:8000 |

---

### 빌드 (배포용)

```bash
npm run build      # dist/ 폴더에 빌드 결과물 생성
npm run preview    # 빌드된 결과물 로컬 미리보기
npm run lint       # 코드 스타일 검사
```

---

## 2. 전체 파일 구조

```
apps/frontend/
│
├── index.html               ← HTML 진입점 (Vite가 이걸 기준으로 빌드)
├── vite.config.js           ← Vite 설정 (포트, 프록시, 빌드 옵션)
├── package.json             ← 의존성 목록 & npm 스크립트
├── .eslintrc.json           ← 코드 스타일 규칙
│
└── src/
    │
    ├── main.jsx             ← React 앱 시작점 (App.jsx를 HTML에 마운트)
    ├── App.jsx              ← 최상위 컴포넌트 (화면 전환 관리)
    │
    ├── pages/               ← 화면 단위 컴포넌트
    │   ├── QueuePage.jsx    ← 대기열 화면 (Phase 1) ✅ 구현됨
    │   └── HomePage.jsx     ← 좌석 선택 화면 (Phase 2) ✅ 구현됨
    │
    ├── components/          ← 재사용 UI 조각
    │   ├── QueueStatus/     ← 대기 화면 전용 컴포넌트
    │   │   ├── QueueStatus.jsx      ← 현재 순번 + 예상 시간 표시
    │   │   ├── WaitTimeGauge.jsx    ← 대기 진행률 게이지
    │   │   └── QueueStatus.css      ← 위 두 컴포넌트 스타일
    │   │
    │   ├── pages/           ← 좌석 선택 화면 전용 컴포넌트
    │   │   ├── SeatMap.jsx          ← 야구장 SVG 지도
    │   │   ├── SectionPanel.jsx     ← 등급/구역 선택 패널
    │   │   └── SeatDetailModal.jsx  ← 좌석 상세 선택 모달
    │   │
    │   └── shared/          ← 여러 화면에서 공통으로 쓰는 컴포넌트
    │       ├── Button.jsx
    │       ├── Modal.jsx
    │       ├── Toast.jsx    ← 화면 우하단 알림
    │       ├── Loading.jsx  ← 로딩 스피너
    │       └── index.js     ← 위 컴포넌트들 한 번에 export
    │
    ├── hooks/               ← 상태 로직을 컴포넌트에서 분리한 Custom Hook
    │   ├── useQueue.js      ← 대기열 상태 관리 (SSE 연결 포함) ✅
    │   ├── useSSE.js        ← SSE 연결 범용 훅
    │   ├── useWebSocket.js  ← WebSocket 연결 범용 훅
    │   ├── useSeatSelection.js ← 좌석 선택 상태 (미구현)
    │   └── index.js
    │
    ├── services/            ← 외부 서버와 통신하는 코드
    │   ├── api.js           ← REST API 클라이언트 (axios)
    │   ├── sse.js           ← SSE 클라이언트 (대기열 실시간 업데이트)
    │   ├── socket.js        ← WebSocket 클라이언트 (좌석 실시간 동기화)
    │   ├── storage.js       ← localStorage 토큰 저장/조회
    │   └── index.js         ← 위 서비스들 한 번에 export
    │
    ├── styles/              ← 전역 CSS
    │   ├── index.css        ← 기본 색상 변수, 타이포그래피, 레이아웃
    │   ├── theme.css        ← 좌석 상태 색상, 버튼, 카드 스타일
    │   ├── responsive.css   ← 반응형 breakpoint
    │   └── app-override.css ← 앱 헤더, 네비게이션, 게임 정보 바 스타일
    │
    ├── utils/               ← 순수 함수 유틸리티
    │   ├── constants.js     ← 상수 (SEAT_STATUS, SOCKET_EVENTS 등)
    │   ├── formatters.js    ← 날짜, 금액 포맷 함수
    │   ├── validators.js    ← 입력값 검증 함수
    │   └── index.js
    │
    └── data/
        └── stadium-data.js  ← 야구장 구역/등급 정적 데이터
```

---

## 3. 화면 흐름 (사용자 여정)

```
앱 열기 (App.jsx)
     │
     ├─── localStorage에 access_token 있음?
     │         YES → 좌석 선택 화면으로 바로 이동
     │         NO  ↓
     │
  대기열 화면 (QueuePage.jsx)
     │
     ├─ [대기열 입장] 버튼 클릭
     │       ↓
     │   POST /api/queue/join
     │       ↓ 응답: { queue_token, position, estimated_wait_time }
     │       ↓ queue_token을 localStorage에 저장
     │
     ├─ SSE 연결 시작: GET /api/queue/sse?token=<queue_token>
     │       ↓
     │   queue_update 이벤트 수신 → 순번/예상시간 실시간 갱신
     │       ↓
     │   queue_token_ready 이벤트 수신
     │       ↓ access_token을 localStorage에 저장
     │       ↓ SSE 연결 종료
     │
     └─ 좌석 선택 화면 (HomePage.jsx)
             │
             ├─ 야구장 지도에서 구역 클릭 → 등급 패널 하이라이트
             ├─ 등급 패널에서 세부 구역 클릭 → 좌석 상세 모달 열림
             └─ 좌석 선택 → 예매 진행
```

---

## 4. 각 파일 설명

### `App.jsx` — 화면 전환 담당

```jsx
const [phase, setPhase] = useState('queue')  // 'queue' | 'seat_selection'

// access_token 있으면 대기열 건너뜀
useEffect(() => {
  if (storageService.getAccessToken()) setPhase('seat_selection')
}, [])

// phase에 따라 다른 화면 렌더
if (phase === 'queue') return <QueuePage onReady={() => setPhase('seat_selection')} />
return <좌석선택화면 />
```

---

### `pages/QueuePage.jsx` — 대기열 화면

`useQueue` 훅에서 상태를 받아 상황에 맞는 UI를 보여줌

| status 값 | 보여주는 화면 |
|-----------|-------------|
| `idle` | "대기열 입장" 버튼 |
| `joining` | 로딩 스피너 |
| `waiting` | 순번 + 예상 시간 + 게이지 |
| `ready` | "입장 준비 완료" 메시지 (자동 전환) |
| `error` | 에러 메시지 + "다시 시도" 버튼 |

---

### `hooks/useQueue.js` — 대기열 상태 로직

```
이 훅이 하는 일:
  1. joinQueue(eventId, userId) 함수 제공
       → POST /api/queue/join 호출
       → 성공 시 queue_token 저장하고 SSE 연결

  2. SSE 이벤트 수신
       → queue_update    : 순번/예상시간 업데이트
       → queue_token_ready : access_token 저장 → status = 'ready'

  3. 반환값
       position          : 현재 대기 순번 (숫자)
       estimatedWaitTime : 예상 대기 시간 (초 단위)
       status            : 현재 상태 (idle/joining/waiting/ready/error)
       isConnected       : SSE 연결 여부 (boolean)
       error             : 에러 메시지 문자열
       joinQueue         : 대기열 진입 함수
```

---

### `services/sse.js` — SSE 클라이언트

SSE(Server-Sent Events)는 서버 → 클라이언트 단방향 실시간 통신입니다.

```
연결 URL: /api/queue/sse?token=<queue_token>

수신하는 이벤트:
  queue_update      → { position, estimated_wait_time, status }
  queue_token_ready → { access_token, expires_at }

자동 재연결:
  연결이 끊기면 1초 후 재시도, 그 다음엔 2초, 4초... (최대 30초, 5회)
```

---

### `services/socket.js` — WebSocket 클라이언트

WebSocket은 서버 ↔ 클라이언트 양방향 실시간 통신입니다.  
좌석 선택 화면에서 다른 사람이 좌석을 선택하면 내 화면에도 바로 반영됩니다.

```
연결 주소: http://localhost:3000 (WebSocket 서버)

보내는 이벤트 (클라이언트 → 서버):
  subscribe_event  → 특정 경기 실시간 구독 시작
  seat_hold        → 내가 좌석 선택했음을 알림
  seat_unhold      → 내가 좌석 선택 취소했음을 알림

받는 이벤트 (서버 → 클라이언트):
  seat_status_updated     → 좌석 상태 변경 (available/hold/sold)
  seat_hold_expired       → 임시 점유 시간 만료
  seat_availability_summary → 전체 가용 좌석 수 요약 (30초마다)
  connection_info         → 연결 직후 서버가 보내주는 정보
  subscription_confirmed  → 구독 성공 확인
```

---

### `services/api.js` — REST API 클라이언트

axios를 감싼 인스턴스입니다. 자동으로 토큰을 헤더에 넣어줍니다.

```javascript
// 사용 예시
import { api } from '../services'

const data = await api.post('/queue/join', { event_id: '...', user_id: '...' })
const seats = await api.get('/events/evt-123/seats')
```

> `localhost:5173/api/...` 요청은 vite.config.js의 proxy 설정으로  
> 자동으로 `localhost:8000/...`으로 전달됩니다.

---

### `services/storage.js` — 토큰 저장소

브라우저 localStorage에 토큰을 저장/불러옵니다.

```javascript
import storageService from '../services/storage'

storageService.setQueueToken(token)   // 대기열 토큰 저장
storageService.getQueueToken()        // 대기열 토큰 불러오기
storageService.setAccessToken(token)  // 입장 토큰 저장
storageService.getAccessToken()       // 입장 토큰 불러오기
storageService.clear()                // 전체 삭제 (로그아웃)
```

---

### `utils/constants.js` — 상수 모음

코드에서 문자열을 직접 쓰는 대신 이 상수를 씁니다.

```javascript
import { SEAT_STATUS, SOCKET_EVENTS } from '../utils/constants'

// 좌석 상태
SEAT_STATUS.AVAILABLE  // 'available'
SEAT_STATUS.HOLD       // 'hold'
SEAT_STATUS.SOLD       // 'sold'

// WebSocket 이벤트 이름
SOCKET_EVENTS.SEAT_STATUS_UPDATED  // 'seat_status_updated'
SOCKET_EVENTS.SUBSCRIBE_EVENT      // 'subscribe_event'
```

---

## 5. 서버와의 통신 방식

총 3가지 방식으로 서버와 통신합니다.

```
┌─────────────────────────────────────────────────────┐
│                   브라우저 (프론트엔드)               │
│                                                     │
│  REST API ────────────────→ Core API (8000)         │
│    api.js (axios)            대기열 진입, 좌석 조회   │
│                                                     │
│  SSE ←────────────────────  Core API (8000)         │
│    sse.js (EventSource)      대기 순번 실시간 업데이트 │
│                                                     │
│  WebSocket ←──────────────→ WebSocket 서버 (3000)   │
│    socket.js (Socket.IO)     좌석 상태 실시간 동기화  │
└─────────────────────────────────────────────────────┘
```

| 방식 | 방향 | 쓰는 곳 | 파일 |
|------|------|---------|------|
| REST API | 클라이언트 → 서버 | 대기열 진입, 좌석 예약, 결제 | `services/api.js` |
| SSE | 서버 → 클라이언트 | 대기 순번 실시간 업데이트 | `services/sse.js` |
| WebSocket | 양방향 | 좌석 상태 실시간 동기화 | `services/socket.js` |

---

## 6. 환경 변수

`.env` 파일을 `apps/frontend/` 폴더에 만들어 사용합니다.

```env
# Core API 주소 (REST + SSE)
VITE_API_BASE_URL=http://localhost:8000/api

# WebSocket 서버 주소
VITE_SOCKET_URL=http://localhost:3000

# 테스트용 기본값 (실제 서비스에서는 로그인 정보로 대체)
VITE_EVENT_ID=evt-default
VITE_USER_ID=user-default
```

> 변수 이름은 반드시 `VITE_`로 시작해야 합니다. 그래야 Vite가 브라우저 코드에서 읽을 수 있습니다.

코드에서 읽는 방법:
```javascript
const url = import.meta.env.VITE_API_BASE_URL
```

---

## 7. 자주 하는 실수

### Q. `npm run dev` 했는데 API 요청이 실패해요

Core API 서버(`localhost:8000`)가 꺼져 있을 가능성이 높습니다.  
`docker-compose -f docker-compose.gateway.yml up`으로 전체를 함께 띄우세요.

---

### Q. 대기열 화면이 뜨지 않고 바로 좌석 선택 화면으로 넘어가요

localStorage에 `access_token`이 남아 있어서입니다.  
브라우저 개발자 도구 → Application → Local Storage → 전체 삭제 후 새로고침.

---

### Q. 좌석 클릭해도 실시간으로 다른 사람 화면에 반영이 안 돼요

WebSocket 서버(`localhost:3000`)가 꺼져 있거나, `subscribe_event`를 아직 보내지 않은 상태입니다.  
브라우저 콘솔에서 확인:
```javascript
// 콘솔에서 직접 구독 테스트
socket.emit('subscribe_event', { event_id: 'evt-123', access_token: '...' })
```

---

### Q. 환경 변수를 바꿨는데 적용이 안 돼요

`npm run dev`를 완전히 종료하고 다시 실행해야 합니다.  
Vite는 시작할 때만 환경 변수를 읽습니다.
