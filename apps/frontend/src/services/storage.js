const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function decodeJwtPayload(token) {
  try {
    return JSON.parse(atob(token.split('.')[1]))
  } catch {
    return null
  }
}

function decodeJwtExp(token) {
  const payload = decodeJwtPayload(token)
  return payload?.exp ? payload.exp * 1000 : null
}

class StorageService {
  setAccessToken(token) {
    localStorage.setItem('access_token', token)
  }

  getAccessToken() {
    const token = localStorage.getItem('access_token')
    if (!token) return null
    const payload = decodeJwtPayload(token)
    // 만료 검사
    if (payload?.exp && Date.now() >= payload.exp * 1000) {
      this.removeAccessToken()
      return null
    }
    // event_id가 유효한 UUID가 아니면 오염된 토큰으로 간주하고 제거
    if (payload?.event_id && !UUID_RE.test(payload.event_id)) {
      this.removeAccessToken()
      return null
    }
    return token
  }

  isAccessTokenExpired() {
    return this.getAccessToken() === null && localStorage.getItem('access_token') !== null
  }

  removeAccessToken() {
    localStorage.removeItem('access_token')
  }

  setQueueToken(token) {
    localStorage.setItem('queue_token', token)
  }

  getQueueToken() {
    return localStorage.getItem('queue_token')
  }

  removeQueueToken() {
    localStorage.removeItem('queue_token')
  }

  setQueueUser(userId, eventId) {
    localStorage.setItem('queue_user_id', userId)
    localStorage.setItem('queue_event_id', eventId)
  }

  getQueueUser() {
    const userId = localStorage.getItem('queue_user_id')
    const eventId = localStorage.getItem('queue_event_id')
    return userId && eventId ? { userId, eventId } : null
  }

  removeQueueUser() {
    localStorage.removeItem('queue_user_id')
    localStorage.removeItem('queue_event_id')
  }

  setUserData(data) {
    localStorage.setItem('user_data', JSON.stringify(data))
  }

  getUserData() {
    const data = localStorage.getItem('user_data')
    return data ? JSON.parse(data) : null
  }

  removeUserData() {
    localStorage.removeItem('user_data')
  }

  setSeatSelection(eventId, seats) {
    localStorage.setItem(`seat_selection_${eventId}`, JSON.stringify(seats))
  }

  getSeatSelection(eventId) {
    const data = localStorage.getItem(`seat_selection_${eventId}`)
    return data ? JSON.parse(data) : []
  }

  removeSeatSelection(eventId) {
    localStorage.removeItem(`seat_selection_${eventId}`)
  }

  clear() {
    localStorage.clear()
  }
}

export default new StorageService()
