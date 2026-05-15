# 브랜칭 전략

3명의 팀원이 병렬로 개발할 때 사용할 Git 브랜칭 전략입니다.

## 브랜치 구조

```
main                    # 배포 가능 상태 (PR만 허용)
├── develop            # 통합 브랜치 (기본 브랜치)
│   ├── feat/infra-*   # 팀원 1 (인프라)
│   ├── feat/backend-* # 팀원 2 (백엔드)
│   └── feat/gateway-* # 팀원 3 (게이트웨이/프론트)
```

## 브랜치 명명 규칙

### Feature 브랜치

```
feat/{팀원}/{기능명}
```

**예시:**
```
feat/infra/k8s-base-setup
feat/backend/queue-system
feat/gateway/websocket-socket-io
```

### Bugfix 브랜치

```
fix/{팀원}/{버그설명}
```

**예시:**
```
fix/backend/redis-connection-timeout
fix/gateway/websocket-reconnection
```

### 기타 브랜치

```
chore/{설명}           # 문서, 설정 변경
refactor/{팀원}/{설명}  # 리팩토링
```

## 개발 워크플로우

### 1. develop에서 새 브랜치 생성

```bash
git checkout develop
git pull origin develop
git checkout -b feat/backend/queue-implementation
```

### 2. 개발 및 커밋

```bash
# 코드 작성
git add .
git commit -m "Implement Redis Sorted Set queue manager"

# 여러 번 반복
git push origin feat/backend/queue-implementation
```

### 3. Pull Request 생성

GitHub에서 PR을 생성합니다:
- **Base:** develop
- **Compare:** feat/backend/queue-implementation
- **제목:** `[Backend] Implement Redis Sorted Set queue manager`
- **설명:** 변경 사항 상세 설명

### 4. 코드 리뷰 및 병합

**자동 리뷰어 지정:**
- `.github/CODEOWNERS` 파일이 자동으로 해당 팀원 지정
- 최소 1명의 approval 필수

**병합 전 확인:**
```bash
# 로컬에서 develop 최신 상태 동기화
git checkout develop
git pull origin develop

# 머지 미리보기 (선택사항)
git merge --no-commit --no-ff feat/backend/queue-implementation
git merge --abort
```

**병합:**
- GitHub에서 "Squash and merge" 선택 (커밋 히스토리 깔끔 유지)
- 또는 팀의 정책에 따라 "Merge pull request"

### 5. 로컬 정리

```bash
git checkout develop
git pull origin develop
git branch -d feat/backend/queue-implementation
git push origin --delete feat/backend/queue-implementation
```

## 커밋 메시지 규칙

### 형식

```
<Type>: <subject>

<body>

<footer>
```

### Type

- `feat`: 새 기능
- `fix`: 버그 수정
- `docs`: 문서 변경
- `style`: 포맷, 세미콜론 등 (기능 변경 아님)
- `refactor`: 리팩토링
- `perf`: 성능 개선
- `test`: 테스트 추가/수정
- `chore`: 빌드, 의존성 등

### 예시

```
feat: implement Redis Sorted Set queue manager

Add queue_service.py with the following functionality:
- Join queue with user ID and timestamp
- Check position in queue
- Consume queue token after wait time

Related to Phase 1 of the ticketing system.

Closes #42
```

## 병렬 개발 시 충돌 방지

### 파일 소유권 원칙

1. **서로 다른 디렉토리 작업**
   - `apps/core-api/` (팀원 2)
   - `apps/websocket-service/` (팀원 3)
   - `infra/` (팀원 1)
   - 충돌 가능성 낮음

2. **공동 파일 수정 시**
   - `docker-compose.yml`: 팀원 1만 merge (Slack 사전 공지 필수)
   - `docs/api-specs/`: 모든 변경 사항 팀 전원 리뷰
   - `README.md`: 변경 시 팀 전원 동의

### 충돌 발생 시 해결

```bash
# 1. develop 최신 상태 당기기
git fetch origin develop

# 2. rebase 또는 merge
git rebase origin/develop      # 또는 git merge origin/develop

# 3. 충돌 파일 수정
vim <conflict-file>

# 4. 충돌 해결 후 계속
git add .
git rebase --continue          # rebase 진행 중인 경우
# 또는
git commit -m "Resolve merge conflict"  # merge 진행 중인 경우

# 5. Push
git push origin feat/xxx --force-with-lease
```

## Week별 브랜칭 계획

### Week 1
- `feat/infra/k8s-base-setup` - K8s base 구조 생성
- `feat/backend/core-api-scaffold` - FastAPI 기본 구조
- `feat/gateway/websocket-init` - WebSocket 초기화

### Week 2
- `feat/backend/queue-system` - 대기열 로직
- `feat/gateway/sse-integration` - SSE 연동
- `feat/infra/k6-queue-test` - k6 대기열 테스트

### Week 3
- `feat/backend/distributed-lock` - 분산 락 구현
- `feat/gateway/socket-io-setup` - Socket.IO 구현
- `feat/infra/ingress-config` - Ingress 설정

### Week 4
- `feat/infra/load-test-automation` - k6 자동화
- `feat/backend/db-optimization` - DB 최적화
- `fix/gateway/websocket-stability` - WebSocket 안정화

## 주의사항

1. **Force Push 금지**
   - `--force`는 팀 동의 후에만 사용
   - `--force-with-lease` 사용 권장

2. **Commit 이력 유지**
   - Squash merge는 최소 커밋만
   - 의미 있는 커밋 메시지 유지

3. **PR 크기 관리**
   - 한 PR은 한 기능 (1 PR = 1 Issue)
   - 파일 변경 50개 이상 시 분할 검토

4. **리뷰 요청**
   - PR 생성 후 Slack에서 "@member 리뷰 부탁" 메시지 발송
   - 리뷰는 업무 시간 내 12시간 이내 완료 목표
