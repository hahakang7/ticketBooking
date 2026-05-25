// subscribe_event / unsubscribe_event 는 connection.js 에서 처리
// 여기서는 좌석 단위 구독 및 hold 알림 이벤트를 담당

export const setupSubscriptionEvents = (io, eventService, seatService) => {
  io.on('connection', (socket) => {
    // 좌석 임시 점유 알림 (WebSocket API 스펙: seat_hold)
    socket.on('seat_hold', (data) => {
      const { event_id, seat_ids, reservation_id, hold_duration } = data || {}
      if (!event_id || !seat_ids?.length) return

      eventService.broadcastToEvent(event_id, 'seat_status_updated', {
        event_id,
        timestamp: new Date().toISOString(),
        updates: seat_ids.map((seat_id) => ({
          seat_id,
          status: 'hold',
        })),
      })
    })

    // 좌석 선택 취소 알림 (WebSocket API 스펙: seat_unhold)
    socket.on('seat_unhold', (data) => {
      const { event_id, seat_ids } = data || {}
      if (!event_id || !seat_ids?.length) return

      eventService.broadcastToEvent(event_id, 'seat_status_updated', {
        event_id,
        timestamp: new Date().toISOString(),
        updates: seat_ids.map((seat_id) => ({
          seat_id,
          status: 'available',
        })),
      })
    })

    // 가용 좌석 현황 요청
    socket.on('request_seat_summary', (data) => {
      const { event_id } = data || {}
      if (!event_id) return
      const summary = seatService.getSeatsSummary(event_id)
      socket.emit('seat_availability_summary', summary)
    })
  })
}
