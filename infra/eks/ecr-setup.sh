#!/usr/bin/env bash
# ECR 레포지토리 생성 + GitHub Actions OIDC IAM 역할 설정
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-ticket-booking}"
AWS_REGION="${AWS_REGION:-ap-northeast-2}"
GITHUB_ORG="${GITHUB_ORG:-}"         # GitHub 조직 또는 유저명 (예: myorg)
GITHUB_REPO="${GITHUB_REPO:-ticketBooking}"

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

GREEN='\033[0;32m'; NC='\033[0m'
log() { echo -e "${GREEN}[$(date '+%H:%M:%S')] $*${NC}"; }

# ─────────────────────────────────────────────────────────────────
# 1. ECR 레포지토리 생성
# ─────────────────────────────────────────────────────────────────
create_ecr_repos() {
  log "=== ECR 레포지토리 생성 ==="
  for repo in core-api websocket-service frontend; do
    if aws ecr describe-repositories \
      --repository-names "${repo}" \
      --region "${AWS_REGION}" &>/dev/null; then
      log "레포지토리 '${repo}' 이미 존재합니다."
    else
      aws ecr create-repository \
        --repository-name "${repo}" \
        --region "${AWS_REGION}" \
        --image-scanning-configuration scanOnPush=true \
        --encryption-configuration encryptionType=AES256
      log "레포지토리 생성: ${repo}"
    fi

    # 이미지 수명 주기 정책 (최근 10개만 유지)
    aws ecr put-lifecycle-policy \
      --repository-name "${repo}" \
      --region "${AWS_REGION}" \
      --lifecycle-policy-text '{
        "rules": [{
          "rulePriority": 1,
          "description": "Keep last 10 images",
          "selection": {
            "tagStatus": "any",
            "countType": "imageCountMoreThan",
            "countNumber": 10
          },
          "action": {"type": "expire"}
        }]
      }'
  done

  log "ECR 레포지토리 설정 완료"
  echo ""
  echo "ECR Registry: ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
}

# ─────────────────────────────────────────────────────────────────
# 2. GitHub Actions OIDC IAM 역할 생성
# ─────────────────────────────────────────────────────────────────
create_github_oidc_role() {
  if [ -z "${GITHUB_ORG}" ]; then
    echo "GITHUB_ORG 환경변수를 설정하세요 (예: export GITHUB_ORG=myusername)"
    return 1
  fi

  log "=== GitHub Actions OIDC 역할 생성 ==="

  # OIDC Provider 생성 (이미 있으면 무시)
  local oidc_arn="arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
  aws iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
    2>/dev/null || log "OIDC Provider 이미 존재합니다."

  # IAM 역할 생성
  local role_name="GitHubActionsRole"
  local trust_policy
  trust_policy=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "${oidc_arn}"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": "repo:${GITHUB_ORG}/${GITHUB_REPO}:*"
      }
    }
  }]
}
EOF
  )

  if aws iam get-role --role-name "${role_name}" &>/dev/null; then
    log "역할 '${role_name}' 이미 존재합니다."
  else
    aws iam create-role \
      --role-name "${role_name}" \
      --assume-role-policy-document "${trust_policy}"
    log "역할 생성: ${role_name}"
  fi

  # ECR + EKS 권한 정책 연결
  local policy_name="GitHubActionsDeployPolicy"
  aws iam put-role-policy \
    --role-name "${role_name}" \
    --policy-name "${policy_name}" \
    --policy-document "{
      \"Version\": \"2012-10-17\",
      \"Statement\": [
        {
          \"Effect\": \"Allow\",
          \"Action\": [
            \"ecr:GetAuthorizationToken\",
            \"ecr:BatchCheckLayerAvailability\",
            \"ecr:GetDownloadUrlForLayer\",
            \"ecr:BatchGetImage\",
            \"ecr:InitiateLayerUpload\",
            \"ecr:UploadLayerPart\",
            \"ecr:CompleteLayerUpload\",
            \"ecr:PutImage\"
          ],
          \"Resource\": \"*\"
        },
        {
          \"Effect\": \"Allow\",
          \"Action\": [
            \"eks:DescribeCluster\",
            \"eks:ListClusters\"
          ],
          \"Resource\": \"arn:aws:eks:${AWS_REGION}:${AWS_ACCOUNT_ID}:cluster/${CLUSTER_NAME}\"
        }
      ]
    }"

  # EKS aws-auth ConfigMap에 역할 추가 (kubectl 사용 권한)
  log "EKS aws-auth에 GitHubActionsRole 추가 중..."
  eksctl create iamidentitymapping \
    --cluster "${CLUSTER_NAME}" \
    --region "${AWS_REGION}" \
    --arn "arn:aws:iam::${AWS_ACCOUNT_ID}:role/${role_name}" \
    --username "github-actions" \
    --group "system:masters" 2>/dev/null || \
    log "iamidentitymapping 이미 존재합니다."

  log "GitHub Actions OIDC 역할 설정 완료"
  echo ""
  echo "GitHub Secrets에 다음을 추가하세요:"
  echo "  AWS_ACCOUNT_ID = ${AWS_ACCOUNT_ID}"
}

create_ecr_repos
create_github_oidc_role
