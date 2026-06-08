import React, { useState, useEffect } from 'react';
import './styles/theme.css';
import './styles/responsive.css';
import './styles/app-override.css';
import HomePage from './pages/HomePage';
import QueuePage from './pages/QueuePage';
import PaymentPage from './pages/PaymentPage';
import ConfirmationPage from './pages/ConfirmationPage';
import storageService from './services/storage';

function App() {
  // 'queue' | 'seat_selection' | 'payment' | 'confirmation'
  const [phase, setPhase] = useState('queue');
  const [timer, setTimer] = useState(5 * 60);
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [bookingInfo, setBookingInfo] = useState(null);

  useEffect(() => {
    // access_token이 이미 있으면 대기열 건너뜀
    const accessToken = storageService.getAccessToken();
    if (accessToken) {
      setPhase('seat_selection');
    }
  }, []);

  useEffect(() => {
    if (phase !== 'seat_selection' || timer <= 0) return;
    const id = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [phase, timer]);

  const handleQueueReady = () => setPhase('seat_selection');

  const handleProceedToPayment = (seats) => {
    setSelectedSeats(seats);
    setPhase('payment');
  };

  const handlePaymentSuccess = (info) => {
    setBookingInfo(info);
    storageService.removeAccessToken();
    storageService.removeQueueToken();
    storageService.removeQueueUser();
    setPhase('confirmation');
  };

  const handleDone = () => {
    setSelectedSeats([]);
    setBookingInfo(null);
    setTimer(5 * 60);
    setPhase('queue');
  };

  if (phase === 'queue') {
    return <QueuePage onReady={handleQueueReady} />;
  }

  if (phase === 'payment') {
    return (
      <PaymentPage
        selectedSeats={selectedSeats}
        onSuccess={handlePaymentSuccess}
        onBack={() => setPhase('seat_selection')}
      />
    );
  }

  if (phase === 'confirmation') {
    return <ConfirmationPage bookingInfo={bookingInfo} onDone={handleDone} />;
  }

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
        <HomePage onProceedToPayment={handleProceedToPayment} />
      </main>

      <div className="status-bar-bottom">
        <span className="status-icon">▲</span>
        직접선택으로 예매 진행이 가능합니다. 좌석을 선택해 주세요.
      </div>
    </div>
  );
}

export default App;
