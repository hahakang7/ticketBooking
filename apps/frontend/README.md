# Frontend - 실시간 예매 시스템 UI

React + Vite 기반의 모바일 최적화 프론트엔드입니다.

## 구현 현황

| Phase | 기능 | 상태 |
|-------|------|------|
| Phase 1 | 대기열 화면 (SSE) | ✅ Week 2 완료 |
| Phase 2 | 좌석 선택 화면 (WebSocket) | 🔜 Week 3 예정 |
| Phase 3 | 결제 화면 | 🔜 Week 4 예정 |

---

## 사용자 흐름

```
앱 시작
  │
  ├─ access_token 있음 → 좌석 선택 화면 (바로 이동)
  │
  └─ access_token 없음 → 대기열 화면
       │
       ├─ "대기열 입장" 버튼 → POST /api/queue/join
       │                        → queue_token 발급
       │
       ├─ SSE 연결: GET /api/queue/sse?token=<queue_token>
       │   ├─ queue_update → 위치/예상 시간 실시간 갱신
       │   └─ queue_token_ready → access_token 저장 후 자동 전환
       │
       └─ 좌석 선택 화면
```

---

## 디렉토리 구조

```
src/
├── App.jsx                          # phase: 'queue' | 'seat_selection'
│
├── pages/
│   ├── QueuePage.jsx                # ✅ 대기열 화면 (Phase 1)
│   ├── HomePage.jsx                 # ✅ 좌석 선택 화면 (Phase 2 UI)
│   ├── PaymentPage.jsx              # 🔜 결제 화면
│   └── ConfirmationPage.jsx         # 🔜 확인 화면
│
├── components/
│   ├── QueueStatus/                 # ✅ Week 2
│   │   ├── QueueStatus.jsx          #   현재 위치 + 예상 대기 시간 카드
│   │   ├── WaitTimeGauge.jsx        #   실시간 경과/잔여 시간 게이지
│   │   └── QueueStatus.css          #   다크 테마 스타일
│   │
│   ├── pages/                       # ✅ Week 1 (좌석 UI)
│   │   ├── SeatMap.jsx              #   야구장 SVG 지도
│   │   ├── SectionPanel.jsx         #   등급/구역 패널
│   │   └── SeatDetailModal.jsx      #   좌석 선택 모달
│   │
│   └── shared/                      # ✅ Week 1
│       ├── Button.jsx
│       ├── Modal.jsx
│       ├── Toast.jsx
│       └── Loading.jsx
│
├── hooks/
│   ├── useQueue.js                  # ✅ SSE + REST API 통합 대기열 관리
│   ├── useSSE.js                    # ✅ SSE 연결 범용 훅
│   ├── useWebSocket.js              # ✅ WebSocket 연결 범용 훅
│   └── useSeatSelection.js          # 🔜 좌석 선택 상태 관리
│
├── services/
│   ├── api.js                       # ✅ axios (토큰 인터셉터 포함)
│   ├── sse.js                       # ✅ SSEService (자동 재연결)
│   ├── socket.js                    # ✅ SocketService (Socket.IO)
│   └── storage.js                   # ✅ localStorage (queue/access token)
│
├── styles/
│   ├── theme.css                    # ✅ Dark Theme 변수
│   ├── responsive.css               # ✅ 반응형 breakpoint
│   └── index.css                    # ✅ 전역 스타일
│
└── utils/
    ├── constants.js
    ├── formatters.js
    └── validators.js
```

---

## 핵심 모듈 상세

### SSE 클라이언트 (`services/sse.js`)

```
엔드포인트: GET /api/queue/sse?token=<queue_token>

수신 이벤트:
  queue_update       → { position, estimated_wait_time, status }
  queue_token_ready  → { access_token, expires_at }

재연결: 지수 백오프 (1s → 2s → 4s → ... 최대 30s, 5회)
```

### useQueue Hook (`hooks/useQueue.js`)

```
상태:
  idle      → 초기 (대기열 미진입)
  joining   → POST /api/queue/join 호출 중
  waiting   → SSE 연결, queue_update 수신 중
  ready     → queue_token_ready 수신, access_token 저장 완료
  error     → 네트워크 오류 등

반환값:
  position, estimatedWaitTime  → QueueStatus 컴포넌트에 전달
  isConnected                  → SSE 연결 상태 표시
  joinQueue(eventId, userId)   → 대기열 진입 함수
```

### App.jsx 페이즈 관리

```javascript
// localStorage에 access_token 있으면 대기열 건너뜀
useEffect(() => {
  if (storageService.getAccessToken()) setPhase('seat_selection')
}, [])

// QueuePage에서 access_token 수신 시 자동 전환
<QueuePage onReady={() => setPhase('seat_selection')} />
```

---

## 환경 변수

```env
VITE_API_BASE_URL=http://localhost:8000/api   # Core API (SSE, REST)
VITE_SOCKET_URL=http://localhost:3000          # WebSocket 서버
VITE_EVENT_ID=evt-default                      # 기본 이벤트 ID
VITE_USER_ID=user-default                      # 기본 사용자 ID
```

---

## 디자인 시스템 (Dark Theme)

```css
배경:   #0F2942 (Navy), #1A1A1A (Black)
강조:   #00D9FF (Cyan)
성공:   #10B981 (Green)
경고:   #FCD34D (Yellow)
오류:   #EF4444 (Red)
중립:   #6B7280 (Gray)
```

### 좌석 상태 색상 (Week 3 예정)

| 상태 | 색상 | 코드 |
|------|------|------|
| Available | Cyan | `#00D9FF` |
| Hold | Yellow | `#FCD34D` |
| Sold | Gray | `#6B7280` |
| Selected | Bright Cyan | `#06B6D4` |

---

## 개발

```bash
# 의존성 설치
npm install

# 개발 서버 (포트 5173)
npm run dev

# 프로덕션 빌드
npm run build

# 빌드 결과 미리보기
npm run preview
```

---

## 성능 목표

| 지표 | 목표 |
|------|------|
| First Contentful Paint | < 1.5s |
| Time to Interactive | < 3s |
| Bundle Size (gzip) | < 150KB |
| Mobile Lighthouse | > 85 |
| WebSocket 메시지 지연 | < 100ms (P95) |

---

## 브라우저 지원

- Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- iOS Safari 14+, Chrome for Android 90+
