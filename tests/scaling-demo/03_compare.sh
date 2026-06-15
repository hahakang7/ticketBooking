#!/usr/bin/env bash
# Test1(HPA-only) vs Test2(LSTM 예측 스케일링) 비교 테스트 자동화
#
# 사용법:
#   bash 03_compare.sh <BASE_URL> [PEAK_VUS]
#   bash 03_compare.sh http://a1b2c3.ap-northeast-2.elb.amazonaws.com:8000
#   bash 03_compare.sh http://localhost:8000 50      # 로컬 경량 테스트
#
# 사전 요구:
#   - k6 설치 (https://k6.io/docs/get-started/installation/)
#   - kubectl 클러스터 연결 (EKS or Docker Desktop)
#   - core-api 정상 실행 중
#
# 출력:
#   - results/test1_summary.json, test2_summary.json
#   - 터미널에 KPI 비교 테이블 출력

set -euo pipefail

BASE_URL="${1:-}"
PEAK_VUS="${2:-100}"
PRE_VUS="${3:-30}"
NS="ticket-system"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K6_SCRIPT="${SCRIPT_DIR}/../../tests/k6/ticket-open-scenario.js"
RESULTS_DIR="${SCRIPT_DIR}/results"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${GREEN}[$(date '+%H:%M:%S')] $*${NC}"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] $*${NC}"; }
info() { echo -e "${CYAN}[$(date '+%H:%M:%S')] $*${NC}"; }

[ -z "${BASE_URL}" ] && { echo "사용법: $0 <BASE_URL> [PEAK_VUS]"; exit 1; }
command -v k6 &>/dev/null || { echo "k6가 설치되지 않음. https://k6.io 참고."; exit 1; }

mkdir -p "${RESULTS_DIR}"

# ── HPA 상태 조회 헬퍼 ──────────────────────────────────────────────
get_pod_count() {
  kubectl get pods -n "${NS}" -l app=core-api \
    --field-selector=status.phase=Running -o name 2>/dev/null | wc -l | tr -d ' '
}

get_hpa_min() {
  kubectl get hpa core-api-hpa -n "${NS}" \
    -o jsonpath='{.spec.minReplicas}' 2>/dev/null || echo "?"
}

patch_hpa_min() {
  local replicas="$1"
  kubectl patch hpa core-api-hpa -n "${NS}" \
    --type=merge -p "{\"spec\":{\"minReplicas\":${replicas}}}" &>/dev/null
  log "HPA minReplicas → ${replicas}"
}

scale_deployment() {
  local replicas="$1"
  kubectl scale deployment core-api -n "${NS}" --replicas="${replicas}" &>/dev/null
  log "core-api deployment replicas → ${replicas}, Running 상태 대기..."
  kubectl rollout status deployment/core-api -n "${NS}" --timeout=120s &>/dev/null
  sleep 5
}

# ── JSON 요약에서 메트릭 추출 ─────────────────────────────────────────
extract_metric() {
  local file="$1" metric="$2"
  python3 -c "
import json, sys
with open('${file}') as f:
    d = json.load(f)
metrics = d.get('metrics', {})
m = metrics.get('${metric}', {})
vals = m.get('values', m)
p95 = vals.get('p(95)', vals.get('95.0', None))
avg = vals.get('avg', None)
rate = vals.get('rate', None)
if p95  is not None: print(f'p95={p95:.2f}')
elif avg  is not None: print(f'avg={avg:.2f}')
elif rate is not None: print(f'rate={rate:.4f}')
else: print('N/A')
" 2>/dev/null || echo "N/A"
}

print_divider() { echo -e "${BOLD}$(printf '─%.0s' {1..70})${NC}"; }

# ════════════════════════════════════════════════════════════════════
# TEST 1: HPA-only (반응형)
# ════════════════════════════════════════════════════════════════════
echo ""
print_divider
log "TEST 1 시작 — HPA-only (반응형 스케일링)"
print_divider

# 시작 전 Pod를 2개로 초기화
patch_hpa_min 2
scale_deployment 2

PODS_BEFORE_T1=$(get_pod_count)
info "테스트 시작 Pod 수: ${PODS_BEFORE_T1}개"
info "k6 실행 중... (약 4분 소요)"

k6 run \
  -e BASE_URL="${BASE_URL}" \
  -e PEAK_VUS="${PEAK_VUS}" \
  -e PRE_VUS="${PRE_VUS}" \
  --summary-export="${RESULTS_DIR}/test1_summary.json" \
  "${K6_SCRIPT}" 2>&1 | tee "${RESULTS_DIR}/test1_output.txt"

PODS_AFTER_T1=$(get_pod_count)
log "TEST 1 완료. Pod 변화: ${PODS_BEFORE_T1} → ${PODS_AFTER_T1}"

# ── 쿨다운: HPA가 Pod를 2개로 돌려보내길 기다림 ─────────────────────
log "쿨다운 대기 (3분)... HPA 안정화 중"
patch_hpa_min 2
sleep 180

# ════════════════════════════════════════════════════════════════════
# TEST 2: LSTM 예측 스케일링
# ════════════════════════════════════════════════════════════════════
print_divider
log "TEST 2 시작 — LSTM 예측 스케일링"
print_divider

# 이벤트 생성 (오픈 8분 후 → prescale 5~15분 윈도우에 즉시 포함)
log "테스트 이벤트 생성 (오픈 8분 후)..."
bash "${SCRIPT_DIR}/01_create_event.sh" 8

PODS_BEFORE_T2=$(get_pod_count)
info "테스트 시작 Pod 수: ${PODS_BEFORE_T2}개"

# prescale 루프가 이벤트를 감지할 때까지 대기 (최대 70초)
log "prescale 루프 감지 대기 (최대 70초)..."
PRESCALE_TRIGGERED=false
for i in $(seq 1 7); do
  sleep 10
  CURRENT_MIN=$(get_hpa_min)
  CURRENT_PODS=$(get_pod_count)
  info "  [${i}0s] Pod: ${CURRENT_PODS}개  HPA min: ${CURRENT_MIN}"
  if [ "${CURRENT_MIN}" != "?" ] && [ "${CURRENT_MIN}" -gt 2 ] 2>/dev/null; then
    log "✅ Prescale 트리거 감지! HPA minReplicas → ${CURRENT_MIN}, Pod: ${CURRENT_PODS}개"
    PRESCALE_TRIGGERED=true
    break
  fi
done

if [ "${PRESCALE_TRIGGERED}" = false ]; then
  warn "prescale 미감지 (이벤트 오픈 윈도우 확인 필요)"
fi

info "k6 실행 중... (약 4분 소요)"

k6 run \
  -e BASE_URL="${BASE_URL}" \
  -e PEAK_VUS="${PEAK_VUS}" \
  -e PRE_VUS="${PRE_VUS}" \
  --summary-export="${RESULTS_DIR}/test2_summary.json" \
  "${K6_SCRIPT}" 2>&1 | tee "${RESULTS_DIR}/test2_output.txt"

PODS_AFTER_T2=$(get_pod_count)
log "TEST 2 완료. Pod 변화: ${PODS_BEFORE_T2} → ${PODS_AFTER_T2}"

# ── 복원 ─────────────────────────────────────────────────────────────
patch_hpa_min 2

# ════════════════════════════════════════════════════════════════════
# 비교 결과 출력
# ════════════════════════════════════════════════════════════════════
echo ""
print_divider
echo -e "${BOLD}  KPI 비교 결과 — Test1(HPA) vs Test2(LSTM 예측 스케일링)${NC}"
print_divider

python3 - "${RESULTS_DIR}/test1_summary.json" "${RESULTS_DIR}/test2_summary.json" <<'PYEOF'
import json, sys

def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}

def get(data, *keys, default="N/A"):
    d = data.get("metrics", {})
    for key in keys:
        m = d.get(key, {})
        vals = m.get("values", m)
        v = vals.get("p(95)", vals.get("95.0", vals.get("avg", vals.get("rate", vals.get("count", None)))))
        if v is not None:
            return v
    return default

t1 = load(sys.argv[1])
t2 = load(sys.argv[2])

metrics = [
    ("p95 응답시간 (ms)",     "http_req_duration",     "p(95)", lambda v: f"{v:.1f}ms"),
    ("평균 응답시간 (ms)",    "http_req_duration",     "avg",   lambda v: f"{v:.1f}ms"),
    ("예약 API p95 (ms)",     "reservation_duration_ms","p(95)", lambda v: f"{v:.1f}ms"),
    ("HTTP 실패율",           "http_req_failed",       "rate",  lambda v: f"{v*100:.1f}%"),
    ("결제 성공률",           "payment_success_rate",  "rate",  lambda v: f"{v*100:.1f}%"),
    ("중복 예매",             "duplicate_reservations_total", "count", lambda v: f"{int(v)}건"),
]

print(f"\n  {'지표':<25}  {'Test1(HPA)':>14}  {'Test2(예측)':>14}  {'개선율':>8}")
print(f"  {'─'*63}")

for label, metric, agg, fmt in metrics:
    m1 = t1.get("metrics", {}).get(metric, {})
    m2 = t2.get("metrics", {}).get(metric, {})
    v1 = m1.get("values", m1).get(agg, None) if isinstance(m1, dict) else None
    v2 = m2.get("values", m2).get(agg, None) if isinstance(m2, dict) else None
    s1 = fmt(v1) if v1 is not None else "N/A"
    s2 = fmt(v2) if v2 is not None else "N/A"

    impr = ""
    if v1 is not None and v2 is not None and v1 > 0:
        pct = (v1 - v2) / v1 * 100
        if abs(pct) >= 1:
            arrow = "↓" if pct > 0 else "↑"
            impr = f"{arrow} {abs(pct):.0f}%"

    print(f"  {label:<25}  {s1:>14}  {s2:>14}  {impr:>8}")

print(f"\n  {'─'*63}")
print("  * 실패율은 큐 직렬화 특성으로 인한 타임아웃 (서버 오류 아님)")
print()
PYEOF

print_divider
log "결과 파일: ${RESULTS_DIR}/"
log "  test1_summary.json, test2_summary.json — k6 전체 메트릭"
log "  test1_output.txt,   test2_output.txt   — k6 전체 출력"
print_divider
echo ""
