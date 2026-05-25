import React, { useState } from 'react';

export default function ConfirmationPage({ bookingInfo, onDone }) {
  const [copied, setCopied] = useState(false);

  const {
    bookingId = '',
    eventName = '',
    eventDate = '',
    eventVenue = '',
    seats = [],
    totalPrice = 0,
    paidAt = '',
  } = bookingInfo || {};

  const paidAtFormatted = paidAt
    ? new Date(paidAt).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';

  const handleCopyBookingId = () => {
    navigator.clipboard.writeText(bookingId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleShare = () => {
    const text = `[티켓링크 예매 완료]\n${eventName}\n${eventDate}\n${eventVenue}\n예약번호: ${bookingId}`;
    if (navigator.share) {
      navigator.share({ title: '예매 완료', text });
    } else {
      navigator.clipboard.writeText(text).then(() => alert('예매 정보가 복사되었습니다.'));
    }
  };

  const handleDownload = () => {
    // 실제 환경에서는 PDF 티켓 다운로드 API 호출
    const content = [
      '===== 티켓링크 전자 티켓 =====',
      `예약번호: ${bookingId}`,
      `이벤트: ${eventName}`,
      `일시: ${eventDate}`,
      `장소: ${eventVenue}`,
      '',
      '선택 좌석:',
      ...seats.map((s) => `  - ${s.sectionId}구역 ${s.seatNum} (₩${(s.price || 0).toLocaleString()})`),
      '',
      `총 결제금액: ₩${totalPrice.toLocaleString()}`,
      `결제 시각: ${paidAtFormatted}`,
      '================================',
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ticket_${bookingId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#F9FAFB', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: 560, width: '100%' }}>
        {/* 성공 헤더 */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ width: 72, height: 72, background: 'rgba(16, 185, 129, 0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', fontSize: '2rem' }}>
            ✅
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#111827', marginBottom: '0.5rem' }}>예매 완료!</h1>
          <p style={{ color: '#6B7280', fontSize: '0.95rem' }}>예매가 성공적으로 완료되었습니다.</p>
        </div>

        {/* 예약번호 카드 */}
        <div style={{ background: '#fff', border: '1.5px solid #3B82F6', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>예약 번호</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.5rem', fontWeight: 700, color: '#3B82F6', letterSpacing: '0.1em', fontFamily: 'monospace' }}>
              {bookingId}
            </span>
            <button
              onClick={handleCopyBookingId}
              style={{ padding: '0.3rem 0.6rem', background: copied ? '#D1FAE5' : '#F3F4F6', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontSize: '0.75rem', color: copied ? '#065F46' : '#374151', transition: 'background 0.2s' }}
            >
              {copied ? '복사됨!' : '복사'}
            </button>
          </div>
        </div>

        {/* 예매 상세 */}
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: '0.75rem', padding: '1.5rem', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#374151', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid #E5E7EB' }}>
            예매 상세
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1rem' }}>
            <InfoRow label="이벤트" value={eventName} />
            <InfoRow label="일시" value={eventDate} />
            <InfoRow label="장소" value={eventVenue} />
            <InfoRow label="결제 시각" value={paidAtFormatted} />
          </div>

          <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: '0.75rem' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#6B7280', marginBottom: '0.5rem' }}>선택 좌석</div>
            {seats.map((seat) => (
              <div key={seat.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', fontSize: '0.875rem', borderBottom: '1px solid #F3F4F6' }}>
                <span style={{ color: '#374151' }}>{seat.sectionId}구역 {seat.seatNum}</span>
                <span style={{ fontWeight: 600, color: '#111827' }}>₩{(seat.price || 0).toLocaleString()}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.75rem', fontWeight: 700, fontSize: '0.95rem' }}>
              <span style={{ color: '#111827' }}>총 결제금액</span>
              <span style={{ color: '#3B82F6' }}>₩{totalPrice.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* 액션 버튼 */}
        <div style={{ display: 'flex', gap: '0.75rem', flexDirection: 'column' }}>
          <button
            onClick={handleDownload}
            style={{ width: '100%', padding: '0.875rem', background: '#3B82F6', color: '#fff', border: 'none', borderRadius: '0.5rem', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', transition: 'background 0.2s' }}
            onMouseOver={(e) => e.target.style.background = '#2563EB'}
            onMouseOut={(e) => e.target.style.background = '#3B82F6'}
          >
            📄 티켓 다운로드
          </button>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <button
              onClick={handleShare}
              style={{ padding: '0.75rem', background: '#fff', color: '#374151', border: '1px solid #E5E7EB', borderRadius: '0.5rem', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' }}
            >
              공유하기
            </button>
            <button
              onClick={onDone}
              style={{ padding: '0.75rem', background: '#F3F4F6', color: '#374151', border: 'none', borderRadius: '0.5rem', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' }}
            >
              홈으로
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
      <span style={{ color: '#6B7280' }}>{label}</span>
      <span style={{ color: '#111827', fontWeight: 500, textAlign: 'right', maxWidth: '60%' }}>{value}</span>
    </div>
  );
}
