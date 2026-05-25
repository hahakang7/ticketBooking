// 날짜 포맷팅
export const formatDate = (date) => {
  return new Date(date).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export const formatTime = (date) => {
  return new Date(date).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export const formatDateTime = (date) => {
  return `${formatDate(date)} ${formatTime(date)}`
}

// 시간 포맷팅 (예: "15분 30초")
export const formatDuration = (seconds) => {
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes}분 ${secs}초`
}

// 가격 포맷팅
export const formatPrice = (price) => {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
  }).format(price)
}

// 좌석 번호 포맷팅 (예: "A-10")
export const formatSeatNumber = (row, column) => {
  return `${String.fromCharCode(65 + row)}-${column + 1}`
}

// 상태 텍스트
export const getStatusText = (status) => {
  const statusMap = {
    available: '구매 가능',
    hold: '임시 점유',
    sold: '판매 완료',
    selected: '선택됨',
    unavailable: '구매 불가',
  }
  return statusMap[status] || status
}

// 대기열 상태 텍스트
export const getQueueStatusText = (status) => {
  const statusMap = {
    waiting: '대기 중',
    ready: '준비 완료',
    expired: '만료됨',
  }
  return statusMap[status] || status
}

// 결제 상태 텍스트
export const getPaymentStatusText = (status) => {
  const statusMap = {
    pending: '대기 중',
    completed: '완료',
    failed: '실패',
    cancelled: '취소됨',
  }
  return statusMap[status] || status
}
