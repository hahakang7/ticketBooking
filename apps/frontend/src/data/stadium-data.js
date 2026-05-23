// 야구장 SVG 좌표 중심점
export const STADIUM_CX = 310;
export const STADIUM_CY = 280;

const toRad = d => d * Math.PI / 180;

// 섹션 SVG arc path 생성 (도넛 슬라이스)
export function sectorD(r1, r2, a1, a2) {
  if (a2 < a1) a2 += 360;
  const s = toRad(a1), e = toRad(a2);
  const CX = STADIUM_CX, CY = STADIUM_CY;
  const n = v => v.toFixed(1);
  const x1 = CX + r1 * Math.cos(s), y1 = CY + r1 * Math.sin(s);
  const x2 = CX + r2 * Math.cos(s), y2 = CY + r2 * Math.sin(s);
  const x3 = CX + r2 * Math.cos(e), y3 = CY + r2 * Math.sin(e);
  const x4 = CX + r1 * Math.cos(e), y4 = CY + r1 * Math.sin(e);
  const lg = (a2 - a1 > 180) ? 1 : 0;
  return `M${n(x1)},${n(y1)} L${n(x2)},${n(y2)} A${r2},${r2},0,${lg},1,${n(x3)},${n(y3)} L${n(x4)},${n(y4)} A${r1},${r1},0,${lg},0,${n(x1)},${n(y1)}Z`;
}

// 섹션 중심 좌표
export function sectorMid(r1, r2, a1, a2) {
  if (a2 < a1) a2 += 360;
  const r = (r1 + r2) / 2;
  const a = toRad((a1 + a2) / 2);
  return [STADIUM_CX + r * Math.cos(a), STADIUM_CY + r * Math.sin(a)];
}

// 등급 데이터
export const STADIUM_GRADES = [
  { id: 1, name: '1루 내야지정석A', color: '#7A1B28', available: 0 },
  { id: 2, name: '3루 내야지정석A', color: '#B91C1C', available: 9 },
  { id: 3, name: '1루 내야지정석B', color: '#1C3F7C', available: 0 },
  { id: 4, name: '3루 내야지정석B', color: '#1C3F7C', available: 6 },
  { id: 5, name: '1루 응원단석',    color: '#0D2F6B', available: 0 },
  { id: 6, name: '3루 응원단석',    color: '#0D2F6B', available: 9 },
  { id: 7, name: '포수후면석',      color: '#3D2010', available: 0 },
  { id: 8, name: '중앙지정석',      color: '#5A4A2A', available: 0 },
  { id: 9, name: '중앙탁자석',      color: '#7A6535', available: 0 },
  { id: 10, name: '1루 내야탁자석(1층)', color: '#3D2010', available: 0 },
];

// 등급별 가격
const GRADE_PRICES = {
  1: 80000, 2: 80000,
  3: 70000, 4: 70000,
  5: 55000, 6: 55000,
  7: 65000, 8: 45000,
  9: 50000, 10: 65000,
};

// 등급별 하위 구역 (섹션) 목록
export const GRADE_SUB_SECTIONS = {
  1:  [{ id: '101', available: 0 }, { id: '102', available: 0 }, { id: '103', available: 0 }, { id: '104', available: 0 }, { id: '105', available: 0 }],
  2:  [{ id: '113', available: 0 }, { id: '114', available: 0 }, { id: '115', available: 0 }, { id: '116', available: 0 },
       { id: '120', available: 1 }, { id: '121', available: 1 }, { id: '122', available: 4 }, { id: '123', available: 1 }, { id: '124', available: 0 }],
  3:  [{ id: '106', available: 0 }, { id: '107', available: 0 }, { id: '108', available: 0 }, { id: '109', available: 0 }, { id: '110', available: 0 }, { id: '111', available: 0 }],
  4:  [{ id: '117', available: 2 }, { id: '118', available: 2 }, { id: '119', available: 0 }, { id: '125', available: 2 }],
  5:  [{ id: '201', available: 0 }, { id: '202', available: 0 }, { id: '203', available: 0 }],
  6:  [{ id: '213', available: 3 }, { id: '214', available: 3 }, { id: '215', available: 3 }],
  7:  [{ id: '100A', available: 0 }, { id: '100B', available: 0 }],
  8:  [{ id: '303', available: 0 }, { id: '304', available: 0 }],
  9:  [{ id: '1004', available: 0 }, { id: '1008', available: 0 }],
  10: [{ id: '100C', available: 0 }],
};

// 구역 → 등급 역방향 매핑 (내부용)
const SECTION_TO_GRADE = {};
Object.entries(GRADE_SUB_SECTIONS).forEach(([gid, subs]) => {
  subs.forEach(sub => { SECTION_TO_GRADE[sub.id] = parseInt(gid); });
});

// SVG 지도 구역 데이터: [id, gradeId, colorOverride, r1, r2, a1, a2]
// 각도 0°=우측(3시), 90°=하단(홈플레이트 방향), 270°=상단(센터필드)
export const MAP_SECTIONS = [
  // 포수후면석 (홈플레이트 뒤)
  ['100A', 7, null, 40, 92, 83, 91],
  ['100B', 7, null, 40, 92, 91, 98],
  // 중앙탁자석 (더그아웃 인접)
  ['1004', 9, null, 40, 92, 73, 83],
  ['1008', 9, null, 40, 92, 98, 107],
  // 1루 내야탁자석
  ['100C', 10, null, 40, 92, 63, 73],

  // 1루 내야지정석A (와인색, 1루 내야 내측)
  ['101', 1, null, 92, 143, 70, 82],
  ['102', 1, null, 92, 143, 57, 70],
  ['103', 1, null, 92, 143, 43, 57],
  ['104', 1, null, 92, 143, 29, 43],
  ['105', 1, null, 92, 143, 15, 29],

  // 3루 내야지정석A (레드, 3루 내야 내측)
  ['113', 2, null, 92, 143, 98, 106],
  ['114', 2, null, 92, 143, 106, 114],
  ['115', 2, null, 92, 143, 114, 122],
  ['116', 2, null, 92, 143, 122, 129],
  ['120', 2, null, 92, 143, 129, 136],
  ['121', 2, null, 92, 143, 136, 143],
  ['122', 2, null, 92, 143, 143, 151],
  ['123', 2, null, 92, 143, 151, 159],
  ['124', 2, null, 92, 143, 159, 168],

  // 1루 내야지정석B (네이비, 1루 내야 외측)
  ['106', 3, null, 143, 190, 70, 82],
  ['107', 3, null, 143, 190, 57, 70],
  ['108', 3, null, 143, 190, 43, 57],
  ['109', 3, null, 143, 190, 29, 43],
  ['110', 3, null, 143, 190, 15, 29],
  ['111', 3, null, 143, 190,  3, 15],
  ['112', 3, null, 143, 190, 350, 363],

  // 3루 내야지정석B (네이비, 3루 내야 외측)
  ['117', 4, null, 143, 190,  98, 110],
  ['118', 4, null, 143, 190, 110, 123],
  ['119', 4, null, 143, 190, 123, 136],
  ['125', 4, null, 143, 190, 136, 149],
  ['126', 4, null, 143, 190, 149, 162],
  ['127', 4, null, 143, 190, 162, 172],

  // 1루 응원단석 (딥네이비, 우측 외야 방면)
  ['201', 5, null, 190, 234,  64,  82],
  ['202', 5, null, 190, 234,  46,  64],
  ['203', 5, null, 190, 234,  28,  46],
  ['204', 5, null, 190, 234,  10,  28],
  ['205', 5, null, 190, 234, 352, 370],
  ['206', 5, null, 190, 234, 338, 352],

  // 3루 응원단석 (딥네이비, 좌측 외야 방면)
  ['213', 6, null, 190, 234,  98, 115],
  ['214', 6, null, 190, 234, 115, 133],
  ['215', 6, null, 190, 234, 133, 151],
  ['216', 6, null, 190, 234, 151, 165],
  ['217', 6, null, 190, 234, 165, 180],

  // 좌측 필러
  [null, null, '#1A3560', 143, 190, 172, 205],
  [null, null, '#1A3560', 190, 234, 180, 215],
  // 우측 필러
  [null, null, '#1A3560', 143, 190, 320, 352],
  [null, null, '#1A3560', 190, 234, 312, 340],

  // 400번대 (우측 외야 코너)
  ['400', null, '#7A4020', 190, 234, 310, 340],

  // 중앙지정석 (센터필드)
  ['303', 8, null, 143, 234, 215, 240],
  ['304', 8, null, 143, 234, 240, 265],
  ['305', 8, null, 143, 234, 265, 290],
  ['306', 8, null, 143, 234, 290, 315],

  // 500번대 상단 외야석 (올리브 그린)
  ['500', null, '#5E6A38', 234, 270, 188, 214],
  ['501', null, '#566030', 234, 270, 214, 238],
  ['502', null, '#4E5A2C', 234, 270, 238, 262],
  ['503', null, '#485228', 234, 270, 262, 286],
  ['504', null, '#444E26', 234, 270, 286, 310],
  ['505', null, '#404822', 234, 270, 310, 334],
  ['506', null, '#3C4420', 234, 270, 334, 358],
  ['507', null, '#38401E', 234, 270, 358, 378],
];

// 결정론적 시드 기반 랜덤 (동일 구역은 항상 같은 좌석 상태)
function seededRand(sectionId) {
  let seed = sectionId.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

// 구역별 좌석 생성: 4행 × 5열 = 20석
export const getSectionSeats = (sectionId) => {
  const ROWS = 4, COLS = 5;
  const rand = seededRand(sectionId);
  const gradeId = SECTION_TO_GRADE[sectionId] || 8;
  const price = GRADE_PRICES[gradeId] || 50000;
  const seats = [];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const r = rand();
      const status = r > 0.85 ? 'sold' : r > 0.72 ? 'hold' : 'available';
      seats.push({
        id: `${sectionId}-${row}-${col}`,
        sectionId,
        seatNum: `${String.fromCharCode(65 + row)}-${col + 1}`,
        row,
        col,
        status,
        price,
      });
    }
  }
  return seats;
};