import { useState, useCallback } from 'react'
import { storageService } from '../services'

export const useSeatSelection = (eventId) => {
  const [selectedSeats, setSelectedSeats] = useState(() => {
    return storageService.getSeatSelection(eventId)
  })

  const toggleSeat = useCallback((seat) => {
    setSelectedSeats((prevSeats) => {
      const isSelected = prevSeats.some(
        (s) => s.row === seat.row && s.column === seat.column
      )

      let newSeats
      if (isSelected) {
        newSeats = prevSeats.filter(
          (s) => !(s.row === seat.row && s.column === seat.column)
        )
      } else {
        newSeats = [...prevSeats, seat]
      }

      storageService.setSeatSelection(eventId, newSeats)
      return newSeats
    })
  }, [eventId])

  const clearSelection = useCallback(() => {
    setSelectedSeats([])
    storageService.removeSeatSelection(eventId)
  }, [eventId])

  const isSeatSelected = useCallback((row, column) => {
    return selectedSeats.some((s) => s.row === row && s.column === column)
  }, [selectedSeats])

  return {
    selectedSeats,
    toggleSeat,
    clearSelection,
    isSeatSelected,
  }
}
