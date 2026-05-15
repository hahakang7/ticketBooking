# Frontend - 실시간 예매 시스템 UI

React + Vite 기반의 모바일 최적화 프론트엔드입니다.

## 기능

### Phase 1: 대기열 시스템
- **Real-time Queue Status**: SSE를 통한 실시간 대기 순번 표시
- **Wait Time Estimation**: 예상 대기 시간 표시 (갱신 주기: 1초)
- **Progress Visualization**: 게이지 차트로 대기 진행 상황 시각화

### Phase 2: 좌석 예매
- **Seat Visualization**: 좌석 맵 시각화 (Available/Hold/Sold)
- **Real-time Updates**: WebSocket을 통한 0.1초 이내 좌석 상태 동기화
- **Instant Feedback**: 좌석 클릭 시 즉각적인 색상 변경 피드백

### Phase 3: 결제
- **Payment Flow**: 안전한 결제 처리 프로세스
- **Order Confirmation**: 최종 예매 확인 및 티켓 다운로드

## 디자인 가이드라인

### 색상 팔레트 (Dark Theme)
```
배경: Navy (#0F2942) / Black (#1A1A1A)
강조색: Cyan (#00D9FF)
성공: Green (#10B981)
오류: Red (#EF4444)
중립: Gray (#6B7280)
```

### UI 상태
| 상태 | 색상 | 설명 |
|------|------|------|
| Available | Cyan | 구매 가능 좌석 |
| Hold | Yellow | 임시 점유 (5분 TTL) |
| Sold | Gray | 판매 완료 |
| Waiting | Cyan | 대기 중 |

## 구조

```
src/
├── components/          # React 컴포넌트
│   ├── QueueStatus/    # 대기 상태 표시
│   ├── SeatMap/        # 좌석 맵 시각화
│   ├── PaymentForm/    # 결제 폼
│   └── shared/         # 공유 컴포넌트
├── hooks/              # Custom Hooks
│   ├── useQueue.js     # 대기열 관리
│   ├── useWebSocket.js # WebSocket 연결
│   └── useSSE.js       # SSE 연결
├── services/           # API 클라이언트
│   ├── api.js          # REST API
│   └── socket.js       # WebSocket 클라이언트
├── pages/              # 페이지 컴포넌트
├── styles/             # 전역 스타일
└── App.jsx             # 앱 진입점
```

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

## 모바일 최적화

- 반응형 디자인 (모바일 우선)
- 터치 이벤트 최적화
- 낮은 대역폭 환경 대응 (이미지 최적화, 번들 크기 최소화)
- 오프라인 모드 (대기열 토큰 캐싱)

## 성능 목표

- **First Contentful Paint (FCP):** < 1.5s
- **Time to Interactive (TTI):** < 3s
- **Bundle Size:** < 150KB (gzipped)
- **Mobile Lighthouse Score:** > 85

## API 연동

### WebSocket (Socket.IO)
```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  transports: ['websocket'],
  reconnection: true
});

socket.on('seat_status_updated', (data) => {
  // 좌석 상태 업데이트
});
```

### SSE (Queue Status)
```javascript
const eventSource = new EventSource('/api/queue/sse?token=...');

eventSource.addEventListener('queue_update', (e) => {
  const { position, waitTime } = JSON.parse(e.data);
});
```

## 브라우저 지원

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+
- Mobile: iOS Safari 14+, Chrome for Android 90+
