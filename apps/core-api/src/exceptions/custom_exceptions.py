class BusinessLogicError(Exception):
  """비즈니스 로직 기본 예외"""
  pass


class SeatNotAvailableError(BusinessLogicError):
  """좌석이 이용 불가능한 경우"""
  pass


class EventNotFoundError(BusinessLogicError):
  """이벤트를 찾을 수 없는 경우"""
  pass


class ReservationNotFoundError(BusinessLogicError):
  """예약을 찾을 수 없는 경우"""
  pass


class DuplicateReservationError(BusinessLogicError):
  """중복 예매 시도"""
  pass


class ReservationExpiredError(BusinessLogicError):
  """예매 제한시간이 만료된 경우"""
  pass
