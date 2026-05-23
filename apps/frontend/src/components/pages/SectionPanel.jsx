import React, { useState } from 'react';
import { STADIUM_GRADES, GRADE_SUB_SECTIONS } from '../../data/stadium-data';
import '../../styles/components/section-panel.css';

export default function SectionPanel({ selectedGrade, onGradeSelect, onSubSectionClick }) {
  const handleGradeClick = (grade) => {
    // 같은 등급 클릭 시 접기
    onGradeSelect(selectedGrade?.id === grade.id ? null : grade);
  };

  const handleSubClick = (sub, grade) => {
    if (sub.available === 0) return;
    onSubSectionClick({
      id: sub.id,
      name: `${sub.id}구역`,
      gradeId: grade.id,
      gradeName: grade.name,
      color: grade.color,
    });
  };

  return (
    <div className="section-panel">
      {/* 패널 헤더 */}
      <div className="panel-header">
        <span className="panel-title">등급 선택</span>
        <button className="refresh-btn" onClick={() => onGradeSelect(null)}>
          새로고침
        </button>
      </div>

      {/* 등급 목록 */}
      <div className="grades-list">
        {STADIUM_GRADES.map(grade => {
          const isSelected = selectedGrade?.id === grade.id;
          const subs = GRADE_SUB_SECTIONS[grade.id] ?? [];

          return (
            <div key={grade.id} className="grade-item">
              {/* 등급 행 */}
              <div
                className={`grade-row${isSelected ? ' active' : ''}`}
                onClick={() => handleGradeClick(grade)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && handleGradeClick(grade)}
              >
                <div className="grade-dot" style={{ backgroundColor: grade.color }} />
                <span className="grade-name">{grade.name}</span>
                <span className={`grade-count${grade.available > 0 ? ' has-seats' : ''}`}>
                  {grade.available > 0 ? `${grade.available} 석` : '0 석'}
                </span>
              </div>

              {/* 하위 구역 (펼쳤을 때) */}
              {isSelected && (
                <div className="sub-list">
                  {subs.map(sub => (
                    <div
                      key={sub.id}
                      className={`sub-row${sub.available > 0 ? ' clickable' : ''}`}
                      onClick={() => handleSubClick(sub, grade)}
                      role={sub.available > 0 ? 'button' : undefined}
                      tabIndex={sub.available > 0 ? 0 : undefined}
                      onKeyDown={e => e.key === 'Enter' && handleSubClick(sub, grade)}
                    >
                      <span className="sub-id">{sub.id}구역</span>
                      <span className={`sub-count${sub.available > 0 ? ' has-seats' : ''}`}>
                        {sub.available > 0 ? `${sub.available} 석` : '0 석'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 하단 버튼 */}
      <div className="panel-footer">
        <button className="next-btn">다음단계</button>
        <p className="guide-link">① 좌석선점 및 자동배정 안내</p>
      </div>
    </div>
  );
}