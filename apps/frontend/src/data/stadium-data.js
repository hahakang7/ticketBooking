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
// 홈플레이트=90°, 1루=0°, 3루=180°, 센터필드=270°
export const STADIUM_GRADES = [
  { id: 1, name: '1루 내야지정석B', color: '#7A1B28', available: 0  },
  { id: 2, name: '3루 내야지정석B', color: '#B91C1C', available: 6  },
  { id: 3, name: '1루 응원단석',    color: '#1C3F7C', available: 0  },
  { id: 4, name: '3루 응원단석',    color: '#2B5FBF', available: 6  },
  { id: 5, name: '1루 내야지정석A', color: '#0D2F6B', available: 0  },
  { id: 6, name: '3루 내야지정석A', color: '#0D2F6B', available: 9  },
  { id: 7, name: '중앙지정석',      color: '#7B4220', available: 4  },
  { id: 8, name: '외야 지정석',     color: '#5A4A2A', available: 0  },
  { id: 9, name: '외야 탁자석',     color: '#2D6A3E', available: 14 },
];

// 등급별 가격
const GRADE_PRICES = {
  1: 70000, 2: 70000,  // 내야지정석B
  3: 55000, 4: 55000,  // 응원단석
  5: 80000, 6: 80000,  // 내야지정석A
  7: 75000,
  8: 45000,
  9: 30000,
};

// 등급별 하위 구역 (섹션) 목록
export const GRADE_SUB_SECTIONS = {
  1: [{ id: '201', available: 0 }, { id: '202', available: 0 }, { id: '203', available: 0 }, { id: '204', available: 0 }],
  2: [{ id: '213', available: 3 }, { id: '214', available: 3 }, { id: '215', available: 2 }, { id: '216', available: 1 }],
  3: [{ id: '101', available: 0 }, { id: '102', available: 0 }, { id: '103', available: 0 }, { id: '104', available: 0 }, { id: '105', available: 0 }],
  4: [{ id: '113', available: 2 }, { id: '114', available: 1 }, { id: '115', available: 1 }, { id: '116', available: 2 }, { id: '117', available: 0 }],
  5: [{ id: '106', available: 0 }, { id: '107', available: 0 }, { id: '108', available: 0 }, { id: '109', available: 0 }, { id: '110', available: 0 }, { id: '111', available: 0 }],
  6: [{ id: '118', available: 2 }, { id: '119', available: 1 }, { id: '120', available: 2 }, { id: '121', available: 0 }, { id: '122', available: 1 }, { id: '123', available: 0 }],
  7: [{ id: '300', available: 2 }, { id: '301', available: 1 }, { id: '302', available: 1 }],
  8: [{ id: '303', available: 0 }, { id: '304', available: 0 }, { id: '305', available: 0 }, { id: '306', available: 0 }],
  9: [{ id: '500', available: 2 }, { id: '501', available: 2 }, { id: '502', available: 1 }, { id: '503', available: 2 },
      { id: '504', available: 2 }, { id: '505', available: 1 }, { id: '506', available: 2 }, { id: '507', available: 2 }],
};

// 구역 → 등급 역방향 매핑 (내부용)
const SECTION_TO_GRADE = {};
Object.entries(GRADE_SUB_SECTIONS).forEach(([gid, subs]) => {
  subs.forEach(sub => { SECTION_TO_GRADE[sub.id] = parseInt(gid); });
});

// SVG 지도 구역 데이터: [id, gradeId, colorOverride, r1, r2, a1, a2]
// 1루(우측)와 3루(좌측)는 90°(홈플레이트)를 기준으로 완전 대칭
export const MAP_SECTIONS = [

  // ── 중앙지정석: 홈플레이트 구역 (grade 7) ─────────────────
  // 내측 전체 (기존 포수후면석·탁자석 통합)
  ['300', 7, null, 40, 92, 73, 107],
  // 내야 A·B링 홈플레이트 컬럼
  ['301', 7, null, 92, 190, 83, 97],
  // 외야 응원단 링 홈플레이트 컬럼
  ['302', 7, null, 190, 234, 82, 98],

  // ── 내야 A링 (r1=92, r2=143) ──────────────────────────────
  // 1루 내야지정석A (5구역, grade 3)
  ['101', 3, null, 92, 143, 72, 83],
  ['102', 3, null, 92, 143, 58, 72],
  ['103', 3, null, 92, 143, 44, 58],
  ['104', 3, null, 92, 143, 30, 44],
  ['105', 3, null, 92, 143, 16, 30],

  // 3루 내야지정석A (5구역, 1루 대칭, grade 4)
  ['113', 4, null, 92, 143,  97, 111],
  ['114', 4, null, 92, 143, 111, 125],
  ['115', 4, null, 92, 143, 125, 139],
  ['116', 4, null, 92, 143, 139, 153],
  ['117', 4, null, 92, 143, 153, 167],

  // ── 내야 B링 (r1=143, r2=190) ────────────────────────────
  [null, null, '#BEC4CC', 143, 190, 320, 364], // 1루 파울지역 필러
  [null, null, '#BEC4CC', 143, 190, 176, 220], // 3루 파울지역 필러

  // 1루 내야지정석B (6구역, grade 5)
  ['106', 5, null, 143, 190, 72, 83],
  ['107', 5, null, 143, 190, 58, 72],
  ['108', 5, null, 143, 190, 44, 58],
  ['109', 5, null, 143, 190, 30, 44],
  ['110', 5, null, 143, 190, 16, 30],
  ['111', 5, null, 143, 190,  4, 16],

  // 3루 내야지정석B (6구역, 1루 대칭, grade 6)
  ['118', 6, null, 143, 190,  97, 108],
  ['119', 6, null, 143, 190, 108, 122],
  ['120', 6, null, 143, 190, 122, 136],
  ['121', 6, null, 143, 190, 136, 150],
  ['122', 6, null, 143, 190, 150, 164],
  ['123', 6, null, 143, 190, 164, 176],

  // ── 응원단석 링 (r1=190, r2=234) ─────────────────────────
  [null, null, '#BEC4CC', 190, 234, 338, 372], // 1루 파울지역 필러
  [null, null, '#BEC4CC', 190, 234, 168, 202], // 3루 파울지역 필러

  // 1루 응원단석 (4구역, grade 1)
  ['201', 1, null, 190, 234, 66, 82],
  ['202', 1, null, 190, 234, 48, 66],
  ['203', 1, null, 190, 234, 30, 48],
  ['204', 1, null, 190, 234, 12, 30],

  // 3루 응원단석 (4구역, 1루 대칭, grade 2)
  ['213', 2, null, 190, 234,  98, 114],
  ['214', 2, null, 190, 234, 114, 132],
  ['215', 2, null, 190, 234, 132, 150],
  ['216', 2, null, 190, 234, 150, 168],

  // ── 외야 지정석 (r1=143, r2=234, 센터필드, grade 8) ──────
  ['303', 8, null, 143, 234, 220, 245],
  ['304', 8, null, 143, 234, 245, 270],
  ['305', 8, null, 143, 234, 270, 295],
  ['306', 8, null, 143, 234, 295, 320],

  // ── 외야 탁자석 (r1=234, r2=270, 270° 기준 대칭, grade 9) ─
  ['500', 9, null, 234, 270, 202, 219],
  ['501', 9, null, 234, 270, 219, 236],
  ['502', 9, null, 234, 270, 236, 253],
  ['503', 9, null, 234, 270, 253, 270],
  ['504', 9, null, 234, 270, 270, 287],
  ['505', 9, null, 234, 270, 287, 304],
  ['506', 9, null, 234, 270, 304, 321],
  ['507', 9, null, 234, 270, 321, 338],
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
