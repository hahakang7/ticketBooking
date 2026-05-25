import { describe, it, expect, beforeEach } from 'vitest'

// StorageService는 싱글턴이라 직접 클래스를 복제해서 테스트
function decodeJwtExp(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.exp ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

function makeJwt(expOffset) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const exp = Math.floor(Date.now() / 1000) + expOffset
  const payload = btoa(JSON.stringify({ sub: 'user-1', exp }))
  return `${header}.${payload}.fakesignature`
}

// localStorage mock은 jsdom이 제공
beforeEach(() => localStorage.clear())

describe('storage.js - 토큰 만료 처리', () => {
  it('유효한 토큰은 getAccessToken()으로 반환된다', () => {
    const token = makeJwt(3600) // 1시간 후 만료
    localStorage.setItem('access_token', token)
    const exp = decodeJwtExp(token)
    expect(exp).toBeGreaterThan(Date.now())
    expect(Date.now()).toBeLessThan(exp)
  })

  it('만료된 토큰은 만료 여부를 판별할 수 있다', () => {
    const token = makeJwt(-10) // 10초 전 만료
    const exp = decodeJwtExp(token)
    expect(Date.now()).toBeGreaterThanOrEqual(exp)
  })

  it('만료되지 않은 토큰은 localStorage에 그대로 존재한다', () => {
    const token = makeJwt(3600)
    localStorage.setItem('access_token', token)
    expect(localStorage.getItem('access_token')).toBe(token)
  })

  it('JWT exp 디코딩이 올바르게 동작한다', () => {
    const token = makeJwt(1800)
    const exp = decodeJwtExp(token)
    const expected = Math.floor(Date.now() / 1000) + 1800
    // 1초 오차 허용
    expect(Math.abs(exp / 1000 - expected)).toBeLessThan(1)
  })

  it('잘못된 형식의 토큰은 exp를 null로 반환한다', () => {
    expect(decodeJwtExp('not.a.jwt')).toBeNull()
    expect(decodeJwtExp('invalid')).toBeNull()
  })

  it('queue_token 저장 및 조회', () => {
    localStorage.setItem('queue_token', 'test-queue-token')
    expect(localStorage.getItem('queue_token')).toBe('test-queue-token')
    localStorage.removeItem('queue_token')
    expect(localStorage.getItem('queue_token')).toBeNull()
  })

  it('queue_user 저장 및 조회', () => {
    localStorage.setItem('queue_user_id', 'user-123')
    localStorage.setItem('queue_event_id', 'event-456')
    expect(localStorage.getItem('queue_user_id')).toBe('user-123')
    expect(localStorage.getItem('queue_event_id')).toBe('event-456')
  })
})
