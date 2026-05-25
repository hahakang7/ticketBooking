# k6 부하 테스트

## 설치

```bash
# macOS
brew install k6

# Linux (Ubuntu/Debian)
sudo apt-get install k6

# Docker로 실행
docker run --rm -i grafana/k6 run - <script.js
```

## 실행 방법

```bash
# 대기열 부하 테스트 (기본: 10 VUs, 30초)
k6 run tests/k6/queue-load-test.js

# 강도 높여서 실행
k6 run --vus 100 --duration 1m tests/k6/queue-load-test.js

# 결과를 JSON으로 저장
k6 run --out json=results/queue-$(date +%Y%m%d-%H%M%S).json tests/k6/queue-load-test.js

# 예약 부하 테스트 (Week 3 이후)
k6 run tests/k6/reservation-stress-test.js

# WebSocket 부하 테스트 (Week 3 이후)
k6 run tests/k6/websocket-load-test.js
```

## 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| BASE_URL | http://localhost:8000 | Core API 주소 |
| WS_URL | ws://localhost:3000 | WebSocket 서버 주소 |
| EVENT_ID | evt-default | 테스트용 이벤트 ID |

```bash
# 환경 변수로 서버 주소 변경
BASE_URL=http://api.example.com k6 run tests/k6/queue-load-test.js
```

## KPI 목표

| 지표 | 목표 |
|------|------|
| P95 응답 시간 | < 300ms |
| 에러율 | < 1% |
| 가용성 | > 99.9% |
| 중복 예매 | 0건 |
| WebSocket 지연 | < 100ms |