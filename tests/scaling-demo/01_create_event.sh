#!/usr/bin/env bash
# 예측 스케일링 시연용 테스트 이벤트 생성
#
# 사용법:
#   bash 01_create_event.sh          # 기본 8분 후 오픈
#   bash 01_create_event.sh 10       # 10분 후 오픈
#   bash 01_create_event.sh 3 hpa    # 3분 후 오픈 (HPA-only 비교용, 5분 미만 = prescale 미동작)
#
# 결과:
#   - DB에 이벤트 + 300석 좌석 생성
#   - EVENT_ID 파일에 event_id 저장 (k6 실행 시 참조)

set -euo pipefail

MINUTES="${1:-8}"
MODE="${2:-prescale}"   # prescale | hpa
NS="ticket-system"
EVENT_NAME="PRESCALE_TEST_$(date +%H%M%S)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[$(date '+%H:%M:%S')] $*${NC}"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] $*${NC}"; }
err()  { echo -e "${RED}[$(date '+%H:%M:%S')] $*${NC}"; exit 1; }

# ── 사전 확인 ────────────────────────────────────────────────────────
if ! kubectl cluster-info &>/dev/null; then
  err "kubectl 클러스터 연결 실패. kubeconfig 확인 필요."
fi

PG_POD=$(kubectl get pod -n "${NS}" -l app=postgres -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
[ -z "${PG_POD}" ] && err "postgres pod을 찾을 수 없음 (namespace: ${NS})"

log "postgres pod: ${PG_POD}"

# ── k8s Secret에서 DB 접속 정보 추출 ─────────────────────────────────
PG_USER=$(kubectl get secret app-secrets -n "${NS}" -o jsonpath='{.data.POSTGRES_USER}' 2>/dev/null | base64 -d 2>/dev/null || echo "user")
PG_PASS=$(kubectl get secret app-secrets -n "${NS}" -o jsonpath='{.data.POSTGRES_PASSWORD}' 2>/dev/null | base64 -d 2>/dev/null || echo "password")
PG_DB="booking_system"

log "오픈 예정: ${MINUTES}분 후 / 모드: ${MODE} / 이벤트명: ${EVENT_NAME}"

# ── prescale 동작 여부 안내 ───────────────────────────────────────────
if [ "${MINUTES}" -ge 5 ] && [ "${MINUTES}" -le 15 ]; then
  warn "→ prescale 루프가 즉시 이 이벤트를 감지합니다 (5~15분 윈도우 내)"
elif [ "${MINUTES}" -lt 5 ]; then
  warn "→ prescale 미동작 (오픈까지 5분 미만 — HPA-only 시나리오)"
else
  warn "→ 오픈까지 15분 초과. 약 $((MINUTES - 15))분 후 prescale 윈도우 진입"
fi

# ── DB에 이벤트 및 좌석 삽입 ─────────────────────────────────────────
log "이벤트 및 좌석(300석) 생성 중..."

EVENT_ID=$(kubectl exec -n "${NS}" "${PG_POD}" -- \
  env PGPASSWORD="${PG_PASS}" psql -U "${PG_USER}" -d "${PG_DB}" -t -c "
BEGIN;

INSERT INTO events (event_id, name, description, location, start_at, end_at, total_seats, available_seats, created_at)
VALUES (
  gen_random_uuid(),
  '${EVENT_NAME}',
  'LSTM 예측 스케일링 시연용 이벤트',
  'Demo Venue Seoul',
  NOW() AT TIME ZONE 'UTC' + INTERVAL '${MINUTES} minutes',
  NOW() AT TIME ZONE 'UTC' + INTERVAL '4 hours',
  30000,
  300,
  NOW()
);

INSERT INTO seats (seat_id, event_id, section, row, seat_number, status, price)
SELECT
  gen_random_uuid(),
  (SELECT event_id FROM events WHERE name = '${EVENT_NAME}' ORDER BY start_at DESC LIMIT 1),
  'A',
  LPAD(((gs-1)/25 + 1)::text, 2, '0'),
  ((gs-1) % 25) + 1,
  'available',
  50000
FROM generate_series(1, 300) gs;

COMMIT;

SELECT event_id FROM events WHERE name = '${EVENT_NAME}' ORDER BY start_at DESC LIMIT 1;
" 2>/dev/null | tr -d ' \n')

[ -z "${EVENT_ID}" ] && err "이벤트 생성 실패. DB 로그 확인 필요."

# ── 결과 저장 및 출력 ─────────────────────────────────────────────────
echo "${EVENT_ID}" > "${SCRIPT_DIR}/.last_event_id"
echo "${EVENT_NAME}" > "${SCRIPT_DIR}/.last_event_name"

log "✅ 생성 완료"
echo ""
echo "  이벤트명  : ${EVENT_NAME}"
echo "  event_id  : ${EVENT_ID}"
echo "  오픈 시각 : $(date -d "+${MINUTES} minutes" '+%H:%M:%S' 2>/dev/null || date -v+${MINUTES}M '+%H:%M:%S')"
echo "  좌석 수   : 300석 (A구역)"
echo ""
echo "다음 단계:"
echo "  # 실시간 모니터링 시작 (별도 터미널)"
echo "  python 02_monitor.py"
echo ""
echo "  # prescale 루프 로그 확인"
echo "  kubectl logs -f -n ${NS} deploy/core-api | grep -E 'PreScale|prescale'"
