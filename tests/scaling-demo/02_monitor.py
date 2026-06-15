#!/usr/bin/env python3
"""
예측 스케일링 실시간 Pod 모니터링

사용법:
    python 02_monitor.py                        # 무한 루프 (Ctrl+C로 종료)
    python 02_monitor.py --duration 15          # 15분 동안 모니터링 후 요약 출력
    python 02_monitor.py --namespace ticket-system --interval 15

출력:
    - 15초마다 현재 Pod 수 / HPA minReplicas / 이벤트 오픈까지 남은 시간
    - Prescale 트리거 감지 시 강조 표시
    - 종료 시 타임라인 테이블 출력 (발표자료용)
"""

import argparse
import subprocess
import sys
import time
from datetime import datetime, timedelta

# ── ANSI 색상 ────────────────────────────────────────────────────────
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
CYAN   = "\033[96m"
BOLD   = "\033[1m"
RESET  = "\033[0m"


def run(cmd: list[str]) -> str:
    try:
        return subprocess.check_output(cmd, stderr=subprocess.DEVNULL, text=True).strip()
    except subprocess.CalledProcessError:
        return ""


def get_pod_count(ns: str) -> int:
    out = run(["kubectl", "get", "pods", "-n", ns, "-l", "app=core-api",
               "--field-selector=status.phase=Running", "-o", "name"])
    return len([l for l in out.splitlines() if l.strip()])


def get_hpa_info(ns: str) -> dict:
    out = run(["kubectl", "get", "hpa", "core-api-hpa", "-n", ns,
               "-o", "jsonpath={.spec.minReplicas},{.spec.maxReplicas},{.status.currentReplicas}"])
    if not out:
        return {"min": "?", "max": "?", "current": "?"}
    parts = out.split(",")
    return {
        "min":     parts[0] if len(parts) > 0 else "?",
        "max":     parts[1] if len(parts) > 1 else "?",
        "current": parts[2] if len(parts) > 2 else "?",
    }


def get_event_open_at(ns: str, event_name: str | None) -> datetime | None:
    """postgres pod에서 다음 오픈 예정 이벤트 start_at 조회."""
    if not event_name:
        return None

    pg_pod = run(["kubectl", "get", "pod", "-n", ns, "-l", "app=postgres",
                  "-o", "jsonpath={.items[0].metadata.name}"])
    if not pg_pod:
        return None

    pg_user = run(["kubectl", "get", "secret", "app-secrets", "-n", ns,
                   "-o", "jsonpath={.data.POSTGRES_USER}"])
    pg_user = run(["bash", "-c", f"echo '{pg_user}' | base64 -d"]) if pg_user else "postgres"

    pg_db = run(["kubectl", "get", "secret", "app-secrets", "-n", ns,
                 "-o", "jsonpath={.data.POSTGRES_DB}"])
    pg_db = run(["bash", "-c", f"echo '{pg_db}' | base64 -d"]) if pg_db else "ticketdb"

    ts_str = run(["kubectl", "exec", "-n", ns, pg_pod, "--",
                  "psql", "-U", pg_user, "-d", pg_db, "-t", "-c",
                  f"SELECT start_at AT TIME ZONE 'UTC' FROM events "
                  f"WHERE name = '{event_name}' ORDER BY start_at DESC LIMIT 1;"])
    ts_str = ts_str.strip()
    if not ts_str:
        return None
    try:
        return datetime.fromisoformat(ts_str.replace(" ", "T").split("+")[0])
    except ValueError:
        return None


def fmt_countdown(seconds: float) -> str:
    if seconds < 0:
        return f"+{abs(int(seconds))}s (오픈 후)"
    m, s = divmod(int(seconds), 60)
    return f"-{m:02d}:{s:02d}"


def print_header():
    print(f"\n{BOLD}{'─'*72}{RESET}")
    print(f"{BOLD}  {'시각':^8}  {'Pod(Running)':^12}  {'HPA min':^8}  {'HPA current':^12}  {'이벤트까지':^10}  이벤트{RESET}")
    print(f"{BOLD}{'─'*72}{RESET}")


def classify_event(pods_before: int, pods_now: int, hpa_min: str) -> str:
    try:
        min_r = int(hpa_min)
    except (ValueError, TypeError):
        min_r = 0

    if pods_now > pods_before:
        if min_r > 2:
            return f"{GREEN}▲ PRESCALE 트리거!{RESET}"
        return f"{YELLOW}▲ HPA 반응형 증설{RESET}"
    if pods_now < pods_before:
        return f"{CYAN}▼ 스케일다운{RESET}"
    return ""


def main():
    parser = argparse.ArgumentParser(description="예측 스케일링 실시간 Pod 모니터")
    parser.add_argument("--namespace", "-n", default="ticket-system")
    parser.add_argument("--interval",  "-i", type=int, default=15, help="폴링 간격(초, 기본 15)")
    parser.add_argument("--duration",  "-d", type=int, default=0,  help="모니터링 시간(분, 0=무한)")
    parser.add_argument("--event",     "-e", default=None,          help="이벤트명 (타임라인 표시용)")
    args = parser.parse_args()

    # .last_event_name 파일에서 이벤트명 로드
    if args.event is None:
        try:
            with open(".last_event_name") as f:
                args.event = f.read().strip()
        except FileNotFoundError:
            pass

    ns = args.namespace
    end_time = datetime.now() + timedelta(minutes=args.duration) if args.duration > 0 else None
    open_at  = get_event_open_at(ns, args.event)

    print(f"\n{BOLD}예측 스케일링 모니터{RESET}  |  namespace: {ns}  |  간격: {args.interval}s")
    if args.event:
        print(f"이벤트: {CYAN}{args.event}{RESET}", end="")
        if open_at:
            print(f"  (오픈: {open_at.strftime('%H:%M:%S')} UTC)", end="")
        print()
    if end_time:
        print(f"모니터링 종료: {end_time.strftime('%H:%M:%S')}")
    print("(Ctrl+C로 조기 종료 → 타임라인 요약 출력)")

    timeline: list[dict] = []
    prev_pods = -1

    print_header()

    try:
        while True:
            now       = datetime.utcnow()
            pods      = get_pod_count(ns)
            hpa       = get_hpa_info(ns)
            countdown = (open_at - now).total_seconds() if open_at else None

            note = classify_event(prev_pods, pods, hpa["min"]) if prev_pods >= 0 else ""

            countdown_str = fmt_countdown(countdown) if countdown is not None else "    —    "

            # Pod 수 색상
            if pods > 2:
                pods_str = f"{GREEN}{pods:^12}{RESET}"
            else:
                pods_str = f"{pods:^12}"

            print(f"  {now.strftime('%H:%M:%S'):^8}  {pods_str}  {hpa['min']:^8}  {hpa['current']:^12}  {countdown_str:^10}  {note}")

            timeline.append({
                "time":     now,
                "pods":     pods,
                "hpa_min":  hpa["min"],
                "hpa_cur":  hpa["current"],
                "countdown": countdown,
                "note":     note,
            })

            prev_pods = pods

            if end_time and datetime.now() >= end_time:
                print(f"\n{GREEN}모니터링 시간 만료.{RESET}")
                break

            time.sleep(args.interval)

    except KeyboardInterrupt:
        print(f"\n{YELLOW}모니터링 중단됨.{RESET}")

    # ── 타임라인 요약 출력 ────────────────────────────────────────────
    if not timeline:
        return

    print(f"\n\n{BOLD}{'='*72}{RESET}")
    print(f"{BOLD}  스케일링 타임라인 요약  (발표자료용){RESET}")
    print(f"{BOLD}{'='*72}{RESET}")
    print(f"  {'시각':^8}  {'Pod':^5}  {'HPA min':^8}  {'이벤트까지':^10}  비고")
    print(f"  {'─'*66}")

    prev_pods_val = -1
    for entry in timeline:
        cd = entry["countdown"]
        cd_str = fmt_countdown(cd) if cd is not None else "    —    "
        note = ""

        try:
            cur_pods = int(entry["pods"])
        except (ValueError, TypeError):
            cur_pods = 0

        if prev_pods_val >= 0 and cur_pods > prev_pods_val:
            try:
                if int(entry["hpa_min"]) > 2:
                    note = "◀ PRESCALE 트리거"
                else:
                    note = "◀ HPA 반응형 증설"
            except (ValueError, TypeError):
                note = "◀ HPA 증설"
        elif cd is not None and abs(cd) < 30:
            note = "◀ 이벤트 오픈"

        print(f"  {entry['time'].strftime('%H:%M:%S'):^8}  {entry['pods']:^5}  {entry['hpa_min']:^8}  {cd_str:^10}  {note}")
        prev_pods_val = cur_pods

    # prescale 트리거 탐지 요약
    prescale_entries = [e for e in timeline
                        if "PRESCALE" in (e.get("note") or "")]
    if prescale_entries:
        first = prescale_entries[0]
        cd = first["countdown"]
        print(f"\n{GREEN}{BOLD}  ✅ Prescale 트리거: {first['time'].strftime('%H:%M:%S')}  "
              f"(이벤트 오픈 {fmt_countdown(cd)} 전)  "
              f"Pod: {first['pods']}개{RESET}")
    else:
        print(f"\n{YELLOW}  ⚠ prescale 트리거 미감지 (HPA 반응형 동작){RESET}")

    print(f"\n{BOLD}{'='*72}{RESET}\n")


if __name__ == "__main__":
    main()
