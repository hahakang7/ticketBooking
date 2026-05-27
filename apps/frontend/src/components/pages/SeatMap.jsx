import React, { useCallback, useMemo } from 'react';
import {
  MAP_SECTIONS,
  STADIUM_GRADES,
  STADIUM_CX,
  STADIUM_CY,
  sectorD,
  sectorMid,
} from '../../data/stadium-data';
import '../../styles/components/seat-map.css';

const toRad = d => d * Math.PI / 180;

export default function SeatMap({ selectedGrade, onGradeClick }) {
  const CX = STADIUM_CX;
  const CY = STADIUM_CY;

  const getColor = useCallback((gradeId, colorOverride) => {
    if (colorOverride) return colorOverride;
    return STADIUM_GRADES.find(g => g.id === gradeId)?.color ?? '#555';
  }, []);

  const getOpacity = useCallback((gradeId) => {
    if (!selectedGrade) return 0.88;
    return gradeId === selectedGrade.id ? 1 : 0.22;
  }, [selectedGrade]);

  const handleClick = useCallback((id, gradeId) => {
    if (!gradeId) return;
    const grade = STADIUM_GRADES.find(g => g.id === gradeId);
    if (grade) onGradeClick(grade, id);
  }, [onGradeClick]);

  // 외야 잔디 경계 아크 (8° ~ 172°, large-arc=1, sweep=0)
  const fieldR = 87;
  const fp1 = [CX + fieldR * Math.cos(toRad(8)),  CY + fieldR * Math.sin(toRad(8))];
  const fp2 = [CX + fieldR * Math.cos(toRad(172)), CY + fieldR * Math.sin(toRad(172))];
  const fieldPath = [
    `M${fp1[0].toFixed(1)},${fp1[1].toFixed(1)}`,
    `A${fieldR},${fieldR},0,1,0,${fp2[0].toFixed(1)},${fp2[1].toFixed(1)}`,
    `L${CX},${CY + 90}`,
    'Z',
  ].join(' ');

  // 내야 다이아몬드 꼭짓점
  const hp = [CX,      CY + 90]; // 홈플레이트
  const b1 = [CX + 62, CY + 28]; // 1루
  const b2 = [CX,      CY - 34]; // 2루
  const b3 = [CX - 62, CY + 28]; // 3루

  // 내야 잔디 (다이아몬드 0.68 스케일)
  const fc = [CX, (hp[1] + b2[1]) / 2];
  const scale = 0.68;
  const grassPts = [b1, b2, b3, hp]
    .map(([x, y]) => `${(fc[0] + (x - fc[0]) * scale).toFixed(1)},${(fc[1] + (y - fc[1]) * scale).toFixed(1)}`)
    .join(' ');

  return (
    <div className="seat-map">
      {/* 상단 툴바 */}
      <div className="map-toolbar">
        <button className="hint-btn">⊙ 원하는 좌석이 없다면? ›</button>
      </div>

      {/* 야구장 SVG */}
      <svg viewBox="0 0 620 540" className="stadium-svg">
        {/* 배경 */}
        <rect width="620" height="540" fill="#F0F2F5" />
        <ellipse cx={CX} cy={CY} rx="282" ry="263" fill="#E2E6EA" stroke="#C8CDD4" strokeWidth="1" />

        {/* 구역 섹션들 */}
        {MAP_SECTIONS.map(([id, gradeId, colorOverride, r1, r2, a1, a2], idx) => {
          const fill    = getColor(gradeId, colorOverride);
          const opacity = getOpacity(gradeId);
          const canClick = Boolean(id && gradeId);
          const [mx, my] = sectorMid(r1, r2, a1, a2);
          const normalA2 = a2 < a1 ? a2 + 360 : a2;
          const midA = (a1 + normalA2) / 2;
          const showLabel = id && /^\d/.test(id) && (!selectedGrade || gradeId === selectedGrade?.id);
          const fontSize  = (r2 - r1) < 55 ? 7 : 8;

          return (
            <g key={idx}>
              <path
                d={sectorD(r1, r2, a1, a2)}
                fill={fill}
                opacity={opacity}
                stroke="rgba(0,0,0,0.35)"
                strokeWidth="0.5"
                style={canClick ? { cursor: 'pointer' } : undefined}
                onClick={canClick ? () => handleClick(id, gradeId) : undefined}
              />
              {showLabel && (
                <text
                  x={mx.toFixed(1)}
                  y={my.toFixed(1)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={fontSize}
                  fill="rgba(255,255,255,0.95)"
                  fontWeight="700"
                  pointerEvents="none"
                  transform={`rotate(${midA + 90},${mx.toFixed(1)},${my.toFixed(1)})`}
                >
                  {id}
                </text>
              )}
            </g>
          );
        })}

        {/* 외야 잔디 */}
        <path d={fieldPath} fill="#2E7D32" />

        {/* 내야 흙 */}
        <polygon
          points={`${b1[0]},${b1[1]} ${b2[0]},${b2[1]} ${b3[0]},${b3[1]} ${hp[0]},${hp[1]}`}
          fill="#C9996A"
        />

        {/* 내야 잔디 */}
        <polygon points={grassPts} fill="#388E3C" />

        {/* 투수 마운드 */}
        <circle cx={CX} cy={CY + 28} r="8" fill="#C9996A" stroke="#B88855" strokeWidth="0.5" />

        {/* 3루/1루 레이블 */}
        <text x={CX - 50} y={CY + 53} textAnchor="middle" fontSize="9"  fill="#fff" fontWeight="800" stroke="#1a1a1a" strokeWidth="0.4" paintOrder="stroke">3루</text>
        <text x={CX - 50} y={CY + 65} textAnchor="middle" fontSize="7"  fill="#fff" fontWeight="600" stroke="#1a1a1a" strokeWidth="0.3" paintOrder="stroke">(AWAY)</text>
        <text x={CX + 50} y={CY + 53} textAnchor="middle" fontSize="9"  fill="#fff" fontWeight="800" stroke="#1a1a1a" strokeWidth="0.4" paintOrder="stroke">1루</text>
        <text x={CX + 50} y={CY + 65} textAnchor="middle" fontSize="7"  fill="#fff" fontWeight="600" stroke="#1a1a1a" strokeWidth="0.3" paintOrder="stroke">(HOME)</text>
        <text x={CX - 26} y={CY + 83} textAnchor="middle" fontSize="6"  fill="#fff" fontWeight="600" stroke="#1a1a1a" strokeWidth="0.3" paintOrder="stroke">DUGOUT</text>
        <text x={CX + 26} y={CY + 83} textAnchor="middle" fontSize="6"  fill="#fff" fontWeight="600" stroke="#1a1a1a" strokeWidth="0.3" paintOrder="stroke">DUGOUT</text>

        {/* Eagles 로고 */}
        <text
          x={CX} y={CY + 8}
          textAnchor="middle"
          fontSize="14"
          fontWeight="900"
          fill="white"
          fontStyle="italic"
          fontFamily="Georgia,serif"
        >
          Eagles
        </text>
        <text x={CX} y={CY + 22} textAnchor="middle" fontSize="6" fill="rgba(255,255,255,0.6)">
          Hanwha Life Eagles Park
        </text>
      </svg>
    </div>
  );
}