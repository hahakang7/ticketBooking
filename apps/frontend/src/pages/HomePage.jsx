import React, { useState, useEffect } from 'react';
import SeatMap from '../components/pages/SeatMap';
import SectionPanel from '../components/pages/SectionPanel';
import SeatDetailModal from '../components/pages/SeatDetailModal';
import { GRADE_SUB_SECTIONS } from '../data/stadium-data';
import api from '../services/api';
import '../styles/pages/home-page.css';

const SEATS_PER_SECTION = 20;
const GRADE_TO_BACKEND = { 1:'B',2:'B',3:'C',4:'C',5:'A',6:'A',7:'B',8:'C',9:'C' };

function sectionOffset(sectionId, totalSeats) {
  const hash = String(sectionId).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
  const buckets = Math.max(1, Math.floor(totalSeats / SEATS_PER_SECTION));
  return ((hash % buckets) + buckets) % buckets * SEATS_PER_SECTION;
}

export default function HomePage({ onProceedToPayment }) {
  const [selectedGrade, setSelectedGrade] = useState(null);
  const [selectedSection, setSelectedSection] = useState(null);
  const [showSeatDetail, setShowSeatDetail] = useState(false);
  const [liveCounts, setLiveCounts] = useState(null);

  useEffect(() => {
    api.get('/v1/events')
      .then(async eventsRes => {
        const events = eventsRes?.data?.items ?? eventsRes?.items ?? [];
        if (!events.length) return;
        const seatsRes = await api.get(`/v1/events/${events[0].event_id}/seats`);
        const allSeats = seatsRes?.data?.items ?? seatsRes?.items ?? [];
        const bySection = { A: [], B: [], C: [] };
        allSeats.forEach(s => { if (bySection[s.section]) bySection[s.section].push(s); });
        const counts = {};
        Object.entries(GRADE_SUB_SECTIONS).forEach(([gradeId, subs]) => {
          const apiSeats = bySection[GRADE_TO_BACKEND[parseInt(gradeId)] || 'C'] || [];
          subs.forEach(sub => {
            const offset = sectionOffset(sub.id, apiSeats.length);
            counts[sub.id] = apiSeats.slice(offset, offset + SEATS_PER_SECTION).filter(s => s.status === 'available').length;
          });
        });
        setLiveCounts(counts);
      })
      .catch(() => {});
  }, []);

  // 등급 선택/해제
  const handleGradeSelect = (grade) => {
    setSelectedGrade(grade);
  };

  // 패널의 하위 구역 클릭 → 좌석 상세 모달 열기
  const handleSubSectionClick = (sectionObj) => {
    setSelectedSection(sectionObj);
    setShowSeatDetail(true);
  };

  // 지도의 구역 클릭 → 등급 선택 + 해당 구역 모달 바로 열기
  const handleGradeClick = (grade, sectionId) => {
    setSelectedGrade(prev => (prev?.id === grade?.id && !sectionId ? null : grade));

    if (!sectionId) return;
    const subs = GRADE_SUB_SECTIONS[grade.id] || [];
    const sub = subs.find(s => s.id === sectionId)
              || subs.find(s => s.available > 0)
              || subs[0];
    if (sub) {
      setSelectedSection({
        id: sub.id,
        name: `${sub.id}구역`,
        gradeId: grade.id,
        gradeName: grade.name,
        color: grade.color,
      });
      setShowSeatDetail(true);
    }
  };

  const handleCloseSeatDetail = () => {
    setShowSeatDetail(false);
    setSelectedSection(null);
  };

  return (
    <div className="home-page">
      <div className="stadium-container">
        {/* 좌측: 야구장 지도 */}
        <div className="seat-map-section">
          <SeatMap
            selectedGrade={selectedGrade}
            onGradeClick={handleGradeClick}
          />
        </div>

        {/* 우측: 등급/구역 패널 */}
        <div className="section-panel-section">
          <SectionPanel
            selectedGrade={selectedGrade}
            onGradeSelect={handleGradeSelect}
            onSubSectionClick={handleSubSectionClick}
            liveCounts={liveCounts}
          />
        </div>
      </div>

      {/* 좌석 선택 모달 */}
      {showSeatDetail && selectedSection && (
        <SeatDetailModal
          section={selectedSection}
          onClose={handleCloseSeatDetail}
          onProceedToPayment={onProceedToPayment}
        />
      )}
    </div>
  );
}