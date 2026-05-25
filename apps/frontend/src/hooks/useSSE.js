import { useState, useEffect, useCallback } from 'react'
import { sseService } from '../services'

export const useSSE = (token) => {
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!token) return

    sseService.connect(token)

    const handleConnected = () => setIsConnected(true)
    const handleDisconnected = () => setIsConnected(false)
    const handleError = (err) => setError(err)

    sseService.on('connected', handleConnected)
    sseService.on('disconnected', handleDisconnected)
    sseService.on('error', handleError)

    return () => {
      sseService.off('connected', handleConnected)
      sseService.off('disconnected', handleDisconnected)
      sseService.off('error', handleError)
      sseService.close()
    }
  }, [token])

  const on = useCallback((event, callback) => {
    sseService.on(event, callback)
  }, [])

  const off = useCallback((event, callback) => {
    sseService.off(event, callback)
  }, [])

  return {
    isConnected,
    error,
    on,
    off,
  }
}
