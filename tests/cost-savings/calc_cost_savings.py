#!/usr/bin/env python3
"""
발표용 비용 절감 계산 스크립트 (KPI 4)

정적 할당(max Pod 고정) 대비 HPA 실제 평균 Pod 수를 비교해
비용 절감률을 계산합니다.

사용법:
  python calc_cost_savings.py                        # 기본 (Prometheus localhost:9090)
  python calc_cost_savings.py --url http://prom:9090 # 커스텀 Prometheus URL
  python calc_cost_savings.py --range 1h             # 집계 시간 범위 (기본: 1h)
"""

import argparse
import sys
import urllib.request
import json
from datetime import datetime


DEPLOYMENTS = {
    "core-api": {
        "hpa": "core-api-hpa",
        "static_max": 6,   # core-api-hpa maxReplicas
        "cpu_per_pod_m": 500,   # limits.cpu (millicores)
        "mem_per_pod_mi": 512,  # limits.memory (MiB)
    },
    "websocket-service": {
        "hpa": "websocket-hpa",
        "static_max": 10,  # websocket-hpa maxReplicas
        "cpu_per_pod_m": 200,
        "mem_per_pod_mi": 256,
    },
}

# AWS ap-northeast-2 t3.small 온디맨드 기준 vCPU당 시간당 비용 (USD)
COST_PER_VCPU_HOUR = 0.0416
COST_PER_GIB_HOUR  = 0.0052


def query_prometheus(prom_url: str, promql: str) -> float | None:
    url = f"{prom_url}/api/v1/query?query={urllib.parse.quote(promql)}"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read())
        results = data.get("data", {}).get("result", [])
        if not results:
            return None
        return float(results[0]["value"][1])
    except Exception as e:
        print(f"  [경고] Prometheus 조회 실패 ({promql[:50]}...): {e}", file=sys.stderr)
        return None


def calc_savings(prom_url: str, time_range: str) -> None:
    import urllib.parse  # noqa: PLC0415

    print(f"\n{'='*60}")
    print(f"  비용 절감 분석  |  범위: 최근 {time_range}  |  {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"{'='*60}\n")

    total_static_cost  = 0.0
    total_actual_cost  = 0.0

    for name, cfg in DEPLOYMENTS.items():
        avg_pods = query_prometheus(
            prom_url,
            f"avg_over_time(kube_deployment_status_replicas_available{{deployment=\"{name}\"}}[{time_range}])"
        )

        if avg_pods is None:
            avg_pods = cfg["static_max"]  # Prometheus 없으면 최대치로 추정
            note = "(Prometheus 미연결 — max 값으로 추정)"
        else:
            note = ""

        static_pods = cfg["static_max"]

        # 시간당 비용 (CPU + Memory)
        cpu_cost  = (cfg["cpu_per_pod_m"] / 1000) * COST_PER_VCPU_HOUR
        mem_cost  = (cfg["mem_per_pod_mi"] / 1024) * COST_PER_GIB_HOUR
        pod_cost_per_hour = cpu_cost + mem_cost

        static_cost = static_pods * pod_cost_per_hour
        actual_cost = avg_pods   * pod_cost_per_hour
        saved       = static_cost - actual_cost
        savings_pct = (saved / static_cost * 100) if static_cost > 0 else 0.0

        total_static_cost += static_cost
        total_actual_cost += actual_cost

        print(f"  [{name}]")
        print(f"    정적 할당 Pod 수  : {static_pods}개 (max 고정)")
        print(f"    실제 평균 Pod 수  : {avg_pods:.2f}개  {note}")
        print(f"    시간당 절감       : ${saved:.4f}  ({savings_pct:.1f}%)")
        print()

    total_saved     = total_static_cost - total_actual_cost
    total_saved_pct = (total_saved / total_static_cost * 100) if total_static_cost > 0 else 0.0

    print(f"{'─'*60}")
    print(f"  전체 합산")
    print(f"    정적 할당 시간당 비용  : ${total_static_cost:.4f}")
    print(f"    HPA 실제 시간당 비용   : ${total_actual_cost:.4f}")
    print(f"    절감액                 : ${total_saved:.4f}")
    print(f"    절감률                 : {total_saved_pct:.1f}%  {'✅ KPI 달성 (>20%)' if total_saved_pct >= 20 else '❌ KPI 미달 (<20%)'}")
    print(f"{'='*60}\n")

    # 발표용 요약 한 줄
    print(f"  [발표용 멘트]")
    print(f"  정적 할당({DEPLOYMENTS['core-api']['static_max']}+{DEPLOYMENTS['websocket-service']['static_max']} Pod 고정) 대비")
    print(f"  HPA 적용 시 평균 {total_saved_pct:.0f}% 비용 절감 달성")
    print()


if __name__ == "__main__":
    import urllib.parse  # noqa: PLC0415

    parser = argparse.ArgumentParser(description="HPA 비용 절감 계산기")
    parser.add_argument("--url",   default="http://localhost:9090", help="Prometheus URL")
    parser.add_argument("--range", default="1h",                    help="집계 시간 범위 (예: 30m, 1h, 3h)")
    args = parser.parse_args()

    calc_savings(args.url, getattr(args, "range"))
