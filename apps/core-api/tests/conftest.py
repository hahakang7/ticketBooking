import logging
import pytest

logger = logging.getLogger("core-api")


@pytest.fixture(autouse=True)
def test_logger(request):
  """각 테스트 시작/종료 시 로그 출력"""
  test_name = request.node.name
  class_name = request.cls.__name__ if request.cls else "Module"

  logger.info(f"{'='*70}")
  logger.info(f"[TEST START] {class_name}::{test_name}")
  logger.info(f"{'='*70}")

  yield

  logger.info(f"{'='*70}")
  logger.info(f"[TEST END] {class_name}::{test_name}")
  logger.info(f"{'='*70}\n")
