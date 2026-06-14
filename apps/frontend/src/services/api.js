const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'

function getToken() {
  return localStorage.getItem('access_token')
}

function buildError(status, data) {
  const err = new Error(`HTTP ${status}`)
  err.response = { status, data }
  return err
}

async function request(method, path, body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)

  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  let res
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    return Promise.reject(e)
  }
  clearTimeout(timer)

  const data = await res.json().catch(() => null)

  if (res.status === 401) {
    localStorage.removeItem('access_token')
    localStorage.removeItem('queue_token')
    window.location.href = '/'
    return
  }

  if (!res.ok) {
    return Promise.reject(buildError(res.status, data))
  }

  return data
}

const api = {
  get: (path) => request('GET', path),
  post: (path, data) => request('POST', path, data),
  delete: (path) => request('DELETE', path),
}

export default api
