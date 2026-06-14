import React, { useState, useEffect, lazy, Suspense } from 'react';
import './styles/theme.css';
import './styles/responsive.css';
import './styles/app-override.css';
import QueuePage from './pages/QueuePage';          // 첫 화면 — 즉시 로드
import { Loading } from './components/shared';
import storageService from './services/storage';

// 대기열 통과 후에만 필요한 페이지 — 초기 번들에서 제외
const HomePage         = lazy(() => import('./pages/HomePage'));
const PaymentPage      = lazy(() => import('./pages/PaymentPage'));
const ConfirmationPage = lazy(() => import('./pages/ConfirmationPage'));

function App() {
  const [phase, setPhase] = useState('queue');
  const [timer, setTimer] = useState(5 * 60);
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [bookingInfo, setBookingInfo] = useState(null);

  useEffect(() => {
    const accessToken = storageService.getAccessToken();
    if (accessToken) setPhase('seat_selection');
  }, []);

  useEffect(() => {
    if (phase !== 'seat_selection' || timer <= 0) return;
    const id = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [phase, timer]);

  const handleQueueReady    = () => setPhase('seat_selection');
  const handleProceedToPayment = (seats) => { setSelectedSeats(seats); setPhase('payment'); };
  const handlePaymentSuccess   = (info) => {
    setBookingInfo(info);
    storageService.removeAccessToken();
    storageService.removeQueueToken();
    storageService.removeQueueUser();
    setPhase('confirmation');
  };
  const handleDone = () => {
    setSelectedSeats([]); setBookingInfo(null); setTimer(5 * 60); setPhase('queue');
  };

  if (phase === 'queue') return <QueuePage onReady={handleQueueReady} />;

  if (phase === 'payment') return (
    <Suspense fallback={<Loading text="결제 페이지 로딩 중..." />}>
      <PaymentPage selectedSeats={selectedSeats} onSuccess={handlePaymentSuccess} onBack={() => setPhase('seat_selection')} />
    </Suspense>
  );

  if (phase === 'confirmation') return (
    <Suspense fallback={<Loading text="완료 페이지 로딩 중..." />}>
      <ConfirmationPage bookingInfo={bookingInfo} onDone={handleDone} />
    </Suspense>
  );

  const mm = String(Math.floor(timer / 60)).padStart(2, '0');
  const ss = String(timer % 60).padStart(2, '0');

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="app-logo">
          <span className="logo-ticket">ticket</span>
          <span className="logo-link">TEAM6</span>
          <span className="logo-sub">예매</span>
        </div>
        <div className="app-timer">
          <span className="timer-label">좌석 선택 가능 시간</span>
          <span className="timer-value">{mm}:{ss}</span>
          <button className="help-circle" aria-label="도움말">?</button>
        </div>
      </header>

      <div className="game-info-bar">
        <div className="game-teams">
          <span>SSG랜더스</span>
          <span className="vs-sep">vs</span>
          <span>🦅 한화이글스</span>
        </div>
        <div className="game-meta">
          대전 한화생명 볼파크&nbsp;&nbsp;|&nbsp;&nbsp;2026.05.29(금) 18:30
        </div>
      </div>

      <main className="app-main">
        <Suspense fallback={<Loading text="좌석 페이지 로딩 중..." />}>
          <HomePage onProceedToPayment={handleProceedToPayment} />
        </Suspense>
      </main>

      <div className="status-bar-bottom">
        <span className="status-icon">▲</span>
        직접선택으로 예매 진행이 가능합니다. 좌석을 선택해 주세요.
      </div>
    </div>
  );
}

export default App;
