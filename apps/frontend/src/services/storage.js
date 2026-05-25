function decodeJwtExp(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.exp ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

class StorageService {
  setAccessToken(token) {
    localStorage.setItem('access_token', token)
  }

  getAccessToken() {
    const token = localStorage.getItem('access_token')
    if (!token) return null
    const expMs = decodeJwtExp(token)
    if (expMs && Date.now() >= expMs) {
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
