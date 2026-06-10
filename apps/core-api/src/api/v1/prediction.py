from fastapi import APIRouter
from pydantic import BaseModel

from src.schemas.common import ApiResponse

router = APIRouter(prefix="/api/v1/prediction", tags=["prediction"])


class ForecastData(BaseModel):
    expected_users: int
    peak_time: str


class ResourcePlanData(BaseModel):
    recommended_replicas: int
    scale_trigger: str


@router.post("/forecast", response_model=ApiResponse[ForecastData])
async def get_forecast():
    """부하 예측 Mock — k6 Flash Crowd 결과 기반 고정값 반환"""
    return ApiResponse(
        code=200,
        message="success",
        data=ForecastData(expected_users=5000, peak_time="14:00"),
    )


@router.get("/resource-plan", response_model=ApiResponse[ResourcePlanData])
async def get_resource_plan():
    """리소스 계획 Mock — 예측 기반 HPA 스케일링 권고값 반환"""
    return ApiResponse(
        code=200,
        message="success",
        data=ResourcePlanData(recommended_replicas=10, scale_trigger="cpu_70"),
    )
