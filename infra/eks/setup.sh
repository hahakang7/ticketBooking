#!/usr/bin/env bash
# EKS 클러스터 생성 + Karpenter 설치 스크립트
set -euo pipefail

# ─────────────────────────────────────────────────────────────────
# 변수 설정 (필요에 맞게 수정하세요)
# ─────────────────────────────────────────────────────────────────
CLUSTER_NAME="${CLUSTER_NAME:-ticket-booking}"
AWS_REGION="${AWS_REGION:-ap-northeast-2}"
KARPENTER_VERSION="${KARPENTER_VERSION:-1.1.0}"
KARPENTER_NAMESPACE="kube-system"

# 스크립트 위치 기준으로 프로젝트 루트 경로 설정
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# AWS 계정 ID 자동 조회
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[$(date '+%H:%M:%S')] $*${NC}"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] $*${NC}"; }
die()  { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR: $*${NC}" >&2; exit 1; }

# ─────────────────────────────────────────────────────────────────
# 사전 조건 확인
# ─────────────────────────────────────────────────────────────────
check_prerequisites() {
  log "사전 조건 확인 중..."
  for cmd in aws eksctl kubectl helm; do
    command -v "$cmd" &>/dev/null || die "$cmd 가 설치되어 있지 않습니다."
  done
  log "AWS Account: ${AWS_ACCOUNT_ID} / Region: ${AWS_REGION}"
}

# ─────────────────────────────────────────────────────────────────
# 1. EKS 클러스터 생성
# ─────────────────────────────────────────────────────────────────
create_cluster() {
  log "=== 1단계: EKS 클러스터 생성 ==="
  if eksctl get cluster --name "${CLUSTER_NAME}" --region "${AWS_REGION}" &>/dev/null; then
    warn "클러스터 '${CLUSTER_NAME}' 가 이미 존재합니다. 건너뜁니다."
    return
  fi
  eksctl create cluster -f "${SCRIPT_DIR}/cluster.yaml"
  log "클러스터 생성 완료"
}

# ─────────────────────────────────────────────────────────────────
# 2. 서브넷/보안그룹에 Karpenter 디스커버리 태그 추가
# ─────────────────────────────────────────────────────────────────
tag_resources() {
  log "=== 2단계: 서브넷/SG 태깅 ==="
  local vpc_id
  vpc_id=$(aws eks describe-cluster \
    --name "${CLUSTER_NAME}" \
    --region "${AWS_REGION}" \
    --query "cluster.resourcesVpcConfig.vpcId" \
    --output text)

  # 서브넷 태깅
  local subnet_ids
  subnet_ids=$(aws ec2 describe-subnets \
    --filters "Name=vpc-id,Values=${vpc_id}" \
    --query "Subnets[*].SubnetId" \
    --output text \
    --region "${AWS_REGION}")

  for subnet_id in $subnet_ids; do
    aws ec2 create-tags \
      --resources "${subnet_id}" \
      --tags "Key=karpenter.sh/discovery,Value=${CLUSTER_NAME}" \
      --region "${AWS_REGION}"
  done

  # 보안그룹 태깅 (클러스터 노드 SG)
  local sg_ids
  sg_ids=$(aws eks describe-cluster \
    --name "${CLUSTER_NAME}" \
    --region "${AWS_REGION}" \
    --query "cluster.resourcesVpcConfig.clusterSecurityGroupId" \
    --output text)

  aws ec2 create-tags \
    --resources "${sg_ids}" \
    --tags "Key=karpenter.sh/discovery,Value=${CLUSTER_NAME}" \
    --region "${AWS_REGION}"

  log "서브넷/SG 태깅 완료 (VPC: ${vpc_id})"
}

# ─────────────────────────────────────────────────────────────────
# 3. Karpenter IAM 설정
# ─────────────────────────────────────────────────────────────────
setup_iam() {
  log "=== 3단계: Karpenter IAM 설정 ==="

  # Spot 서비스 연결 역할 (이미 존재하면 무시)
  aws iam create-service-linked-role \
    --aws-service-name spot.amazonaws.com 2>/dev/null || true

  # Karpenter 컨트롤러 정책 생성
  local policy_name="KarpenterControllerPolicy-${CLUSTER_NAME}"
  local policy_doc
  policy_doc=$(sed \
    -e "s/__CLUSTER_NAME__/${CLUSTER_NAME}/g" \
    -e "s/__REGION__/${AWS_REGION}/g" \
    -e "s/__ACCOUNT_ID__/${AWS_ACCOUNT_ID}/g" \
    "${SCRIPT_DIR}/karpenter-controller-policy.json")

  if aws iam get-policy --policy-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${policy_name}" &>/dev/null; then
    warn "정책 '${policy_name}' 가 이미 존재합니다. 버전을 업데이트합니다."
    local version_id
    version_id=$(aws iam create-policy-version \
      --policy-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${policy_name}" \
      --policy-document "${policy_doc}" \
      --set-as-default \
      --query 'PolicyVersion.VersionId' --output text)
    log "정책 버전 업데이트: ${version_id}"
  else
    aws iam create-policy \
      --policy-name "${policy_name}" \
      --policy-document "${policy_doc}"
    log "컨트롤러 정책 생성 완료"
  fi

  # Karpenter 노드 역할 생성
  local node_role_name="KarpenterNodeRole-${CLUSTER_NAME}"
  if ! aws iam get-role --role-name "${node_role_name}" &>/dev/null; then
    aws iam create-role \
      --role-name "${node_role_name}" \
      --assume-role-policy-document '{
        "Version":"2012-10-17",
        "Statement":[{
          "Effect":"Allow",
          "Principal":{"Service":"ec2.amazonaws.com"},
          "Action":"sts:AssumeRole"
        }]
      }'

    for policy in \
      "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy" \
      "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy" \
      "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly" \
      "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"; do
      aws iam attach-role-policy \
        --role-name "${node_role_name}" \
        --policy-arn "${policy}"
    done
    log "노드 역할 생성 완료: ${node_role_name}"
  else
    warn "노드 역할 '${node_role_name}' 가 이미 존재합니다."
  fi

  # EKS Access Entry 등록 (노드가 클러스터에 조인할 수 있도록)
  aws eks create-access-entry \
    --cluster-name "${CLUSTER_NAME}" \
    --principal-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:role/${node_role_name}" \
    --type EC2_LINUX \
    --region "${AWS_REGION}" 2>/dev/null || \
    warn "Access Entry 가 이미 존재합니다."

  # Karpenter 컨트롤러 IRSA 생성
  eksctl create iamserviceaccount \
    --cluster "${CLUSTER_NAME}" \
    --name karpenter \
    --namespace "${KARPENTER_NAMESPACE}" \
    --role-name "KarpenterControllerRole-${CLUSTER_NAME}" \
    --attach-policy-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:policy/KarpenterControllerPolicy-${CLUSTER_NAME}" \
    --role-only \
    --approve \
    --override-existing-serviceaccounts \
    --region "${AWS_REGION}"

  log "IAM 설정 완료"
}

# ─────────────────────────────────────────────────────────────────
# 4. Spot 인터럽션 SQS 큐 생성
# ─────────────────────────────────────────────────────────────────
create_interruption_queue() {
  log "=== 4단계: SQS 인터럽션 큐 생성 ==="

  local queue_url
  queue_url=$(aws sqs create-queue \
    --queue-name "${CLUSTER_NAME}" \
    --attributes MessageRetentionPeriod=300 \
    --tags "Key=karpenter.sh/discovery,Value=${CLUSTER_NAME}" \
    --region "${AWS_REGION}" \
    --query QueueUrl --output text 2>/dev/null || \
    aws sqs get-queue-url --queue-name "${CLUSTER_NAME}" \
      --region "${AWS_REGION}" \
      --query QueueUrl --output text)

  local queue_arn
  queue_arn=$(aws sqs get-queue-attributes \
    --queue-url "${queue_url}" \
    --attribute-names QueueArn \
    --region "${AWS_REGION}" \
    --query Attributes.QueueArn --output text)

  # SQS 정책: EventBridge에서 메시지 전송 허용
  aws sqs set-queue-attributes \
    --queue-url "${queue_url}" \
    --attributes "{
      \"Policy\": \"{\\\"Version\\\":\\\"2012-10-17\\\",\\\"Statement\\\":[{\\\"Effect\\\":\\\"Allow\\\",\\\"Principal\\\":{\\\"Service\\\":[\\\"events.amazonaws.com\\\",\\\"sqs.amazonaws.com\\\"]},\\\"Action\\\":\\\"sqs:SendMessage\\\",\\\"Resource\\\":\\\"${queue_arn}\\\"}]}\"
    }" \
    --region "${AWS_REGION}"

  # EventBridge 규칙 생성
  for rule_name_suffix in SpotInterruption RebalanceRecommendation InstanceStateChange ScheduledChange; do
    local rule_name="${CLUSTER_NAME}-${rule_name_suffix}"
    case "$rule_name_suffix" in
      SpotInterruption)
        local event_pattern='{"source":["aws.ec2"],"detail-type":["EC2 Spot Instance Interruption Warning"]}'
        ;;
      RebalanceRecommendation)
        local event_pattern='{"source":["aws.ec2"],"detail-type":["EC2 Instance Rebalance Recommendation"]}'
        ;;
      InstanceStateChange)
        local event_pattern='{"source":["aws.ec2"],"detail-type":["EC2 Instance State-change Notification"]}'
        ;;
      ScheduledChange)
        local event_pattern='{"source":["aws.health"],"detail-type":["AWS Health Event"]}'
        ;;
    esac

    aws events put-rule \
      --name "${rule_name}" \
      --event-pattern "${event_pattern}" \
      --region "${AWS_REGION}" \
      --state ENABLED &>/dev/null || true

    aws events put-targets \
      --rule "${rule_name}" \
      --targets "Id=1,Arn=${queue_arn}" \
      --region "${AWS_REGION}" &>/dev/null || true
  done

  log "SQS 인터럽션 큐 및 EventBridge 규칙 설정 완료"
}

# ─────────────────────────────────────────────────────────────────
# 5. Karpenter Helm 설치
# ─────────────────────────────────────────────────────────────────
install_karpenter() {
  log "=== 5단계: Karpenter 설치 (v${KARPENTER_VERSION}) ==="

  helm registry logout public.ecr.aws 2>/dev/null || true

  helm upgrade --install karpenter \
    oci://public.ecr.aws/karpenter/karpenter \
    --version "${KARPENTER_VERSION}" \
    --namespace "${KARPENTER_NAMESPACE}" \
    --create-namespace \
    --values "${SCRIPT_DIR}/karpenter-helm-values.yaml" \
    --set "settings.clusterName=${CLUSTER_NAME}" \
    --set "settings.interruptionQueue=${CLUSTER_NAME}" \
    --set "serviceAccount.annotations.eks\.amazonaws\.com/role-arn=arn:aws:iam::${AWS_ACCOUNT_ID}:role/KarpenterControllerRole-${CLUSTER_NAME}" \
    --wait \
    --timeout 5m

  log "Karpenter 설치 완료"
}

# ─────────────────────────────────────────────────────────────────
# 6. Karpenter 리소스 및 앱 배포
# ─────────────────────────────────────────────────────────────────
deploy_app() {
  log "=== 6단계: 애플리케이션 배포 ==="

  kubectl apply -f "${PROJECT_ROOT}/infra/k8s/namespace/namespace.yaml"

  kubectl apply -f "${PROJECT_ROOT}/infra/k8s/autoscaling/karpenter-nodeclass.yaml"
  kubectl apply -f "${PROJECT_ROOT}/infra/k8s/autoscaling/karpenter-nodepool.yaml"

  kubectl apply -f "${PROJECT_ROOT}/infra/k8s/base/shared/" -n ticket-system
  kubectl apply -f "${PROJECT_ROOT}/infra/k8s/base/core-api/" -n ticket-system
  kubectl apply -f "${PROJECT_ROOT}/infra/k8s/base/websocket-service/" -n ticket-system
  kubectl apply -f "${PROJECT_ROOT}/infra/k8s/base/frontend/" -n ticket-system
  kubectl apply -f "${PROJECT_ROOT}/infra/k8s/autoscaling/core-api-hpa.yaml" -n ticket-system
  kubectl apply -f "${PROJECT_ROOT}/infra/k8s/autoscaling/websocket-hpa.yaml" -n ticket-system

  log "애플리케이션 배포 완료"
}

# ─────────────────────────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────────────────────────
main() {
  log "=== ticket-booking EKS 클러스터 설치 시작 ==="
  log "클러스터: ${CLUSTER_NAME} / 리전: ${AWS_REGION} / Karpenter: v${KARPENTER_VERSION}"

  check_prerequisites
  create_cluster
  tag_resources
  setup_iam
  create_interruption_queue
  install_karpenter
  deploy_app

  log "=== 모든 설정 완료 ==="
  echo ""
  echo "kubectl get nodes 로 노드 상태를 확인하세요."
  echo "kubectl get pods -n ticket-system 으로 애플리케이션 상태를 확인하세요."
}

main "$@"
