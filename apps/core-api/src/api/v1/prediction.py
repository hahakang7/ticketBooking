from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from src.database.db import SessionLocal
from src.dependencies import get_db, get_redis
from src.schemas.common import ApiResponse
from src.services.prediction_service import PredictionService

router = APIRouter(prefix="/api/v1/prediction", tags=["prediction"])


class ForecastData(BaseModel):
    expected_users: int
    peak_time: str


class ResourcePlanData(BaseModel):
    recommended_replicas: int
    scale_trigger: str


@router.post("/forecast", response_model=ApiResponse[ForecastData])
async def get_forecast(
    event_id: str = Query(None, description="Event ID for LSTM-based prediction (optional)"),
    db=Depends(get_db),
    r=Depends(get_redis),
):
    """
    트래픽 예측
    - event_id 있으면: LSTM 실모델 기반 피크 RPS + 피크 시각 반환
    - event_id 없으면: Mock 고정값 반환 (하위 호환성)
    """
    if event_id:
        service = PredictionService(db, r)
        result = service.get_forecast(event_id)
        return ApiResponse(
            code=200,
            message="success",
            data=ForecastData(**result),
        )
    return ApiResponse(
        code=200,
        message="success",
        data=ForecastData(expected_users=5000, peak_time="14:00"),
    )


@router.get("/resource-plan", response_model=ApiResponse[ResourcePlanData])
async def get_resource_plan(
    event_id: str = Query(None, description="Event ID for actual prediction (optional)"),
    db=Depends(get_db),
    r=Depends(get_redis),
):
    """
    리소스 계획 조회
    - event_id 있으면: 실모델(TrafficForecaster + ResourceCalculator) 기반 계산
    - event_id 없으면: Mock 고정값 반환 (하위 호환성)
    """
    if event_id:
        service = PredictionService(db, r)
        plan = service.get_resource_plan(event_id)
        return ApiResponse(
            code=200,
            message="success",
            data=ResourcePlanData(
                recommended_replicas=plan.get("recommended_replicas", 10),
                scale_trigger="cpu_70",
            ),
        )
    else:
        return ApiResponse(
            code=200,
            message="success",
            data=ResourcePlanData(recommended_replicas=10, scale_trigger="cpu_70"),
        )
