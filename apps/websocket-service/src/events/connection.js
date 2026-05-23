export const setupConnectionEvents = (io, socketService, eventService) => {
  io.on('connection', (socket) => {
    socketService.handleConnection(socket)

    // 이벤트 구독 (WebSocket API 스펙: { event_id, access_token })
    socket.on('subscribe_event', (data) => {
      const eventId = data?.event_id
      if (eventId) {
        eventService.subscribeToEvent(socket, eventId)
      }
    })

    // 이벤트 구독 취소 (WebSocket API 스펙: { event_id })
    socket.on('unsubscribe_event', (data) => {
      const eventId = data?.event_id
      if (eventId) {
        eventService.unsubscribeFromEvent(socket, eventId)
      }
    })

    socket.on('error', (error) => {
      console.error('Socket error:', error)
    })
  })
}
