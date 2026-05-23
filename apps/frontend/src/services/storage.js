class StorageService {
  setAccessToken(token) {
    localStorage.setItem('access_token', token)
  }

  getAccessToken() {
    return localStorage.getItem('access_token')
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
