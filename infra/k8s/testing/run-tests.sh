#!/usr/bin/env bash
# EKS 내부에서 k6 테스트 실행 (이그레스 비용 $0)
set -euo pipefail

NS="ticket-system"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K6_DIR="$(cd "${SCRIPT_DIR}/../../tests/k6" && pwd)"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[$(date '+%H:%M:%S')] $*${NC}"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] $*${NC}"; }

# ── 사용법 ──────────────────────────────────────────────────────────
usage() {
  echo "사용법: $0 [stress|ticket-open|all]"
  echo "  stress      : 중복예매 방지 테스트 (KPI 2+3, 2분)"
  echo "  ticket-open : 티켓 오픈 시나리오 (KPI 1+3, 10분)"
  echo "  all         : 두 테스트 순차 실행"
  exit 1
}

TEST="${1:-all}"

# ── ConfigMap에 스크립트 주입 ────────────────────────────────────────
inject_scripts() {
  log "k6 스크립트 ConfigMap 생성 중..."
  kubectl create configmap k6-scripts \
    --from-file=reservation-stress-test.js="${K6_DIR}/reservation-stress-test.js" \
    --from-file=ticket-open-scenario.js="${K6_DIR}/ticket-open-scenario.js" \
    -n "${NS}" \
    --dry-run=client -o yaml | kubectl apply -f -
  log "스크립트 주입 완료"
}

# ── Job 실행 및 로그 스트리밍 ─────────────────────────────────────────
run_job() {
  local job_name="$1"
  log "=== ${job_name} 시작 ==="

  # 기존 Job 삭제 (재실행 시)
  kubectl delete job "${job_name}" -n "${NS}" --ignore-not-found=true 2>/dev/null
  sleep 2

  kubectl apply -f <(kubectl get job "${job_name}" -n "${NS}" -o yaml 2>/dev/null || \
    grep -A 100 "name: ${job_name}" "${SCRIPT_DIR}/k6-job.yaml" | \
    awk '/^---/{if(p)exit; p=1} p') 2>/dev/null || \
  kubectl create -f "${SCRIPT_DIR}/k6-job.yaml" --dry-run=client -o yaml | \
    python3 -c "
import sys, yaml
docs = list(yaml.safe_load_all(sys.stdin))
for d in docs:
    if d and d.get('kind')=='Job' and d.get('metadata',{}).get('name')=='${job_name}':
        print(yaml.dump(d))
" | kubectl apply -f -

  # Pod가 시작될 때까지 대기
  log "Pod 시작 대기 중..."
  kubectl wait --for=condition=ready pod \
    -l "job-name=${job_name}" \
    -n "${NS}" --timeout=120s 2>/dev/null || true

  # 실시간 로그 출력
  POD=$(kubectl get pod -n "${NS}" -l "job-name=${job_name}" -o name | head -1)
  warn "로그 스트리밍 중 (Ctrl+C로 중단 가능, 테스트는 계속 실행됨)"
  kubectl logs -f "${POD}" -n "${NS}" 2>/dev/null || true

  # 완료 대기
  kubectl wait --for=condition=complete job/"${job_name}" -n "${NS}" --timeout=900s
  log "=== ${job_name} 완료 ==="
}

# ── 메인 ────────────────────────────────────────────────────────────
inject_scripts

case "${TEST}" in
  stress)
    run_job "k6-reservation-stress"
    ;;
  ticket-open)
    run_job "k6-ticket-open"
    ;;
  all)
    run_job "k6-reservation-stress"
    log "30초 대기 후 다음 테스트 시작..."
    sleep 30
    run_job "k6-ticket-open"
    ;;
  *)
    usage
    ;;
esac

log "모든 테스트 완료. 비용 절감 계산:"
log "  kubectl exec -n ticket-system deploy/prometheus -- wget -qO- 'http://localhost:9090/api/v1/query?query=avg_over_time(kube_deployment_status_replicas_available{deployment=\"core-api\"}[1h])'"
