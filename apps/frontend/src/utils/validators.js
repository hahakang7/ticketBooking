// 이메일 검증
export const validateEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return regex.test(email)
}

// 전화번호 검증 (한국)
export const validatePhoneNumber = (phone) => {
  const regex = /^01[0-9]-?\d{3,4}-?\d{4}$/
  return regex.test(phone)
}

// 카드 번호 검증
export const validateCardNumber = (cardNumber) => {
  const digits = cardNumber.replace(/\D/g, '')
  if (digits.length !== 16) return false

  // Luhn 알고리즘
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let digit = parseInt(digits[i])
    if (i % 2 === 0) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return sum % 10 === 0
}

// 만료일 검증
export const validateExpiryDate = (expiry) => {
  const [month, year] = expiry.split('/')
  if (!month || !year) return false

  const currentDate = new Date()
  const currentYear = currentDate.getFullYear() % 100
  const currentMonth = currentDate.getMonth() + 1

  const expireYear = parseInt(year)
  const expireMonth = parseInt(month)

  if (expireYear < currentYear) return false
  if (expireYear === currentYear && expireMonth < currentMonth) return false

  return true
}

// CVV 검증
export const validateCVV = (cvv) => {
  return /^\d{3,4}$/.test(cvv)
}

// 좌석 선택 유효성 검사
export const validateSeatSelection = (selectedSeats, maxSeats = 10) => {
  if (!Array.isArray(selectedSeats) || selectedSeats.length === 0) {
    return { valid: false, message: '최소 1개의 좌석을 선택해주세요.' }
  }

  if (selectedSeats.length > maxSeats) {
    return { valid: false, message: `최대 ${maxSeats}개 좌석까지 선택 가능합니다.` }
  }

  return { valid: true }
}

// 대기열 토큰 유효성 검사
export const validateQueueToken = (token) => {
  return typeof token === 'string' && token.length > 0
}

// 액세스 토큰 유효성 검사
export const validateAccessToken = (token) => {
  if (!token) return false
  
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.exp * 1000 > Date.now()
  } catch {
    return false
  }
}
