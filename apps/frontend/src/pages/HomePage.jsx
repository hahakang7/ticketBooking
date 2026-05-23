import React, { useState } from 'react';
import SeatMap from '../components/pages/SeatMap';
import SectionPanel from '../components/pages/SectionPanel';
import SeatDetailModal from '../components/pages/SeatDetailModal';
import '../styles/pages/home-page.css';

export default function HomePage({ onProceedToPayment }) {
  // 선택된 등급 (지도 하이라이트용)
  const [selectedGrade, setSelectedGrade] = useState(null);
  // 모달에 전달할 구역 객체 { id, name, gradeId, gradeName, color }
  const [selectedSection, setSelectedSection] = useState(null);
  const [showSeatDetail, setShowSeatDetail] = useState(false);

  // 등급 선택/해제
  const handleGradeSelect = (grade) => {
    setSelectedGrade(grade);
  };

  // 패널의 하위 구역 클릭 → 좌석 상세 모달 열기
  const handleSubSectionClick = (sectionObj) => {
    setSelectedSection(sectionObj);
    setShowSeatDetail(true);
  };

  // 지도의 구역 클릭 → 해당 등급 선택
  const handleGradeClick = (grade) => {
    setSelectedGrade(prev => (prev?.id === grade?.id ? null : grade));
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