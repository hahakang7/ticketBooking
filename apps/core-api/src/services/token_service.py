from src.auth.token import create_queue_token, create_access_token, decode_token


class TokenService:
  def issue_queue_token(self, user_id: str, event_id: str, position: int) -> str:
    return create_queue_token(user_id, event_id, position)

  def issue_access_token(self, user_id: str, event_id: str) -> str:
    return create_access_token(user_id, event_id)

  def verify_token(self, token: str) -> dict:
    return decode_token(token)
