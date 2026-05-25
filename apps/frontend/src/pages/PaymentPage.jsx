import React from 'react';
import PaymentForm from '../components/PaymentForm/PaymentForm';

const MOCK_EVENT = {
  name: 'SSG랜더스 vs 한화이글스',
  date: '2026.05.29(금) 18:30',
  venue: '대전 한화생명 볼파크',
};

export default function PaymentPage({ selectedSeats = [], onSuccess, onBack }) {
  const totalPrice = selectedSeats.reduce((sum, s) => sum + (s.price || 0), 0);

  const handlePaymentSuccess = (paymentResult) => {
    onSuccess({
      bookingId: paymentResult.paymentId || `TL-${Date.now().toString(36).toUpperCase()}`,
      eventName: MOCK_EVENT.name,
      eventDate: MOCK_EVENT.date,
      eventVenue: MOCK_EVENT.venue,
      seats: selectedSeats,
      totalPrice,
      paidAt: paymentResult.paidAt || new Date().toISOString(),
    });
  };

  return (
    <div style={{ minHeight: '100vh', background: '#F9FAFB', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        {/* 헤더 */}
        <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={onBack}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: '#6B7280', padding: '0.25rem' }}
            aria-label="뒤로가기"
          >
            ←
          </button>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#111827', margin: 0 }}>결제</h1>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: '1.5rem', alignItems: 'start' }}>
          {/* 주문 요약 */}
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: '0.75rem', padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#374151', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid #E5E7EB' }}>
              예매 정보
            </h2>

            {/* 이벤트 정보 */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontWeight: 700, color: '#111827', marginBottom: '0.25rem' }}>{MOCK_EVENT.name}</div>
              <div style={{ fontSize: '0.875rem', color: '#6B7280' }}>{MOCK_EVENT.date}</div>
              <div style={{ fontSize: '0.875rem', color: '#6B7280' }}>{MOCK_EVENT.venue}</div>
            </div>

            {/* 선택 좌석 */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#6B7280', marginBottom: '0.5rem' }}>선택 좌석</div>
              {selectedSeats.length === 0 ? (
                <div style={{ fontSize: '0.875rem', color: '#9CA3AF' }}>선택된 좌석이 없습니다.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {selectedSeats.map((seat) => (
                    <div
                      key={seat.id}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.75rem', background: '#F9FAFB', borderRadius: '0.5rem', fontSize: '0.875rem' }}
                    >
                      <span style={{ fontWeight: 600, color: '#374151' }}>
                        {seat.sectionId}구역 {seat.seatNum}
                      </span>
                      <span style={{ color: '#3B82F6', fontWeight: 700 }}>
                        ₩{(seat.price || 0).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 결제 금액 */}
            <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, color: '#111827' }}>총 결제 금액</span>
              <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#3B82F6' }}>
                ₩{totalPrice.toLocaleString()}
              </span>
            </div>

            {/* 유의사항 */}
            <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#FEF9C3', borderRadius: '0.5rem', fontSize: '0.75rem', color: '#78350F' }}>
              ⚠️ 예매 완료 후 취소 시 수수료가 발생할 수 있습니다.
            </div>
          </div>

          {/* 결제 폼 */}
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: '0.75rem', padding: '1.5rem' }}>
            <PaymentForm
              totalPrice={totalPrice}
              selectedSeats={selectedSeats}
              onSuccess={handlePaymentSuccess}
            />
          </div>
        </div>
      </div>

      {/* 반응형 모바일 스타일 */}
      <style>{`
        @media (max-width: 768px) {
          div[style*="grid-template-columns"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
