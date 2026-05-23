import React, { useState, useEffect } from 'react';
import { getSectionSeats } from '../../data/stadium-data';
import api from '../../services/api';
import { useWebSocket } from '../../hooks/useWebSocket';
import Button from '../shared/Button';
import Modal from '../shared/Modal';
import '../../styles/components/seat-detail-modal.css';

const ROWS = 4;
const COLS = 5;
const SEATS_PER_SECTION = ROWS * COLS; // 20

// 프론트 등급 → 백엔드 섹션 매핑
const GRADE_TO_BACKEND_SECTION = {
  1: 'A', 2: 'A',
  3: 'B', 4: 'B',
  5: 'C', 6: 'C', 7: 'C', 8: 'C', 9: 'C', 10: 'C',
};

// 섹션 ID 기반 오프셋 (구역마다 다른 좌석 구간 표시)
function sectionOffset(sectionId, totalSeats) {
  const hash = String(sectionId).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
  const buckets = Math.max(1, Math.floor(totalSeats / SEATS_PER_SECTION));
  return ((hash % buckets) + buckets) % buckets * SEATS_PER_SECTION;
}

// 백엔드 좌석 배열 → 프론트 형식 변환 (20석 슬라이스)
// backendSeatId를 함께 저장해서 WebSocket 업데이트에 매핑
function mapToFrontendSeats(apiSeats, sectionId, price) {
  const offset = sectionOffset(sectionId, apiSeats.length);
  const rotated = [...apiSeats.slice(offset), ...apiSeats.slice(0, offset)];
  return rotated.slice(0, SEATS_PER_SECTION).map((s, i) => ({
    id: `${sectionId}-${i}`,
    backendSeatId: String(s.seat_id),
    sectionId,
    seatNum: `${s.row}-${s.seat_number}`,
    row: Math.floor(i / COLS),
    col: i % COLS,
    status: s.status,
    price: Number(s.price) || price || 50000,
  }));
}

let cachedSeatsMap = null; // { eventId, bySection: { A: [], B: [], C: [] } }

async function fetchSeatsBySection() {
  if (cachedSeatsMap) return cachedSeatsMap;

  const eventsRes = await api.get('/v1/events');
  const events = eventsRes?.data?.items ?? eventsRes?.items ?? [];
  if (!events.length) throw new Error('이벤트 없음');

  const eventId = events[0].event_id;
  const seatsRes = await api.get(`/v1/events/${eventId}/seats`);
  const allSeats = seatsRes?.data?.items ?? seatsRes?.items ?? [];

  const bySection = { A: [], B: [], C: [] };
  allSeats.forEach(s => { if (bySection[s.section]) bySection[s.section].push(s); });

  cachedSeatsMap = { eventId, bySection };
  return cachedSeatsMap;
}

export default function SeatDetailModal({ section, onClose, onProceedToPayment }) {
  const [seats, setSeats] = useState([]);
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentEventId, setCurrentEventId] = useState(null);

  const { isConnected: wsConnected, seatUpdates } = useWebSocket(currentEventId);

  // WebSocket에서 좌석 상태 업데이트 수신 시 seats 반영
  useEffect(() => {
    if (!Object.keys(seatUpdates).length || !seats.length) return;
    setSeats((prev) =>
      prev.map((seat) => {
        const updatedStatus = seatUpdates[seat.backendSeatId];
        if (!updatedStatus || updatedStatus === seat.status) return seat;
        // 이미 선택한 좌석이 hold/sold로 바뀌면 선택 해제
        if (updatedStatus !== 'available') {
          setSelectedSeats((sel) => sel.filter((s) => s.id !== seat.id));
        }
        return { ...seat, status: updatedStatus };
      })
    );
  }, [seatUpdates]);

  useEffect(() => {
    if (!section) return;
    setSelectedSeats([]);

    const backendSection = GRADE_TO_BACKEND_SECTION[section.gradeId] || 'C';

    const load = async () => {
      setLoading(true);
      try {
        const { eventId, bySection } = await fetchSeatsBySection();
        setCurrentEventId(eventId);
        const apiSeats = bySection[backendSection] || [];
        if (apiSeats.length > 0) {
          setSeats(mapToFrontendSeats(apiSeats, section.id, null));
        } else {
          setSeats(getSectionSeats(section.id));
        }
      } catch {
        setSeats(getSectionSeats(section.id));
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [section]);

  if (!section) return null;

  if (loading) {
    return (
      <Modal isOpen={true} onClose={onClose} title={`${section.id}구역 — 좌석 선택`} size="md">
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6B7280' }}>좌석 정보를 불러오는 중...</div>
      </Modal>
    );
  }

  const handleSeatClick = (seat) => {
    if (seat.status !== 'available') return;
    const already = selectedSeats.some(s => s.id === seat.id);
    if (already) {
      setSelectedSeats(prev => prev.filter(s => s.id !== seat.id));
    } else if (selectedSeats.length < 4) {
      setSelectedSeats(prev => [...prev, seat]);
    }
  };

  const totalPrice = selectedSeats.reduce((sum, s) => sum + s.price, 0);

  // 행별로 그룹핑
  const rowMap = {};
  seats.forEach(seat => {
    if (!rowMap[seat.row]) rowMap[seat.row] = [];
    rowMap[seat.row].push(seat);
  });

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`${section.id}구역 — 좌석 선택${wsConnected ? ' 🟢' : ''}`}
      size="md"
    >
      <div className="seat-detail-modal">
        {/* 등급 배지 */}
        <div className="grade-badge" style={{ backgroundColor: section.color }}>
          {section.gradeName}
        </div>

        {/* 경기장 방향 표시 */}
        <div className="direction-label">↑ 경기장 / 무대 방향</div>

        {/* 좌석 그리드 */}
        <div className="seats-grid">
          {Array.from({ length: ROWS }, (_, rowIdx) => (
            <div key={rowIdx} className="seat-row">
              <span className="row-label">{String.fromCharCode(65 + rowIdx)}</span>
              <div className="seat-cells">
                {(rowMap[rowIdx] ?? []).map(seat => {
                  const isSelected = selectedSeats.some(s => s.id === seat.id);
                  const cls = isSelected ? 'selected' : seat.status;
                  return (
                    <button
                      key={seat.id}
                      className={`seat-cell ${cls}`}
                      onClick={() => handleSeatClick(seat)}
                      disabled={seat.status !== 'available'}
                      title={`${seat.seatNum} — ${
                        seat.status === 'available' ? '선택가능' :
                        seat.status === 'hold'      ? '점유중' : '판매완료'
                      }`}
                    >
                      {seat.col + 1}
                    </button>
                  );
                })}
              </div>
              <span className="row-label row-label-right">{String.fromCharCode(65 + rowIdx)}</span>
            </div>
          ))}
        </div>

        {/* 범례 */}
        <div className="seat-legend">
          {[
            { cls: 'available', label: '선택가능' },
            { cls: 'hold',      label: '점유중'  },
            { cls: 'sold',      label: '판매완료' },
            { cls: 'selected',  label: '선택됨'  },
          ].map(({ cls, label }) => (
            <div key={cls} className="legend-item">
              <div className={`seat-sample ${cls}`} />
              <span>{label}</span>
            </div>
          ))}
        </div>

        {/* 선택 요약 */}
        <div className="selection-summary">
          <div className="summary-row">
            <span>선택 좌석</span>
            <span className="summary-val">{selectedSeats.length} / 4 석</span>
          </div>
          {selectedSeats.length > 0 && (
            <>
              <div className="selected-tags">
                {selectedSeats.map(seat => (
                  <span key={seat.id} className="seat-tag">
                    {seat.seatNum}
                    <button
                      className="tag-remove"
                      onClick={() => handleSeatClick(seat)}
                      aria-label={`${seat.seatNum} 선택 해제`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="summary-row total-row">
                <span>총 금액</span>
                <span className="price-val">₩{totalPrice.toLocaleString()}</span>
              </div>
            </>
          )}
        </div>

        {/* 액션 버튼 */}
        <div className="modal-actions">
          {selectedSeats.length > 0 && (
            <Button variant="secondary" onClick={() => setSelectedSeats([])}>
              초기화
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => {
              if (selectedSeats.length > 0 && onProceedToPayment) {
                onProceedToPayment(selectedSeats);
              }
            }}
            disabled={selectedSeats.length === 0}
          >
            {selectedSeats.length > 0 ? '결제하기' : '좌석을 선택해 주세요'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}