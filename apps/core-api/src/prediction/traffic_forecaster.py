"""
LSTM 기반 티켓 오픈 트래픽 예측기.

학습:  python -m src.prediction.traffic_forecaster
       → models/traffic_model.pt 생성

K8s:  PREDICTION_MODEL_PATH 환경변수로 모델 파일 경로 지정 (ConfigMap/Volume 연동)
      미지정 시 models/traffic_model.pt 사용
"""
import math
import os
import logging
from datetime import datetime, timedelta
from typing import List

import numpy as np
import torch
import torch.nn as nn

from src.prediction.types import ForecastPoint

logger = logging.getLogger(__name__)

# K8s Volume 마운트 경로 또는 로컬 경로
_DEFAULT_MODEL_PATH = os.getenv(
    "PREDICTION_MODEL_PATH",
    os.path.join(os.path.dirname(__file__), "../../../../models/traffic_model.pt"),
)
_RPS_SCALE = 5000.0   # 학습 시 정규화 상수 (최대 RPS)
_CI_Z = 1.645         # 90% 신뢰구간 z-score


# ── 모델 아키텍처 ──────────────────────────────────────────────────────────────

class _RPSNet(nn.Module):
    """
    LSTM 시계열 예측 네트워크.

    Input  : (batch, seq_len, 4)
             [t_frac, sin(2π·t_frac), cos(2π·t_frac), event_scale]
    Output : (batch, seq_len)  — 정규화된 RPS (0~1)
    """

    def __init__(self, input_size: int = 4, hidden_size: int = 64, num_layers: int = 2):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size, hidden_size, num_layers,
            batch_first=True, dropout=0.2,
        )
        self.head = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Linear(32, 1),
            nn.Softplus(),   # 음수 RPS 방지
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h, _ = self.lstm(x)
        return self.head(h).squeeze(-1)   # (batch, seq_len)


# ── 합성 학습 데이터 생성 ────────────────────────────────────────────────────────

def _build_features(steps: int, event_scale: float) -> np.ndarray:
    """시퀀스 피처 행렬 생성: (steps, 4)."""
    t = np.arange(steps, dtype=np.float32)
    t_frac = t / max(steps - 1, 1)
    feats = np.stack([
        t_frac,
        np.sin(2 * math.pi * t_frac),
        np.cos(2 * math.pi * t_frac),
        np.full(steps, event_scale, dtype=np.float32),
    ], axis=1)
    return feats


def _generate_synthetic_data(
    n_events: int = 1000,
    seq_len: int = 96,   # 15분 * 96 = 24시간
    seed: int = 42,
) -> tuple[np.ndarray, np.ndarray]:
    """
    티켓 오픈 트래픽 패턴 합성 데이터 생성.

    패턴: T=0(오픈) 직후 급증 → 지수 감쇠 → baseline 수렴
    """
    rng = np.random.default_rng(seed)
    X_list, y_list = [], []

    for _ in range(n_events):
        event_scale = float(rng.uniform(0.1, 1.0))
        peak_rps = rng.uniform(200.0, _RPS_SCALE) * event_scale
        decay = rng.uniform(0.03, 0.18)        # 감쇠 속도
        noise_std = rng.uniform(0.05, 0.20)    # 상대적 노이즈 크기
        baseline = rng.uniform(20.0, 80.0)     # 평시 트래픽

        t = np.arange(seq_len, dtype=np.float32)
        rps = peak_rps * np.exp(-decay * t) + baseline
        rps *= (1.0 + rng.normal(0.0, noise_std, size=seq_len))
        rps = np.clip(rps, 0.0, None)

        X_list.append(_build_features(seq_len, event_scale))
        y_list.append((rps / _RPS_SCALE).astype(np.float32))

    return np.array(X_list), np.array(y_list)


# ── 학습 ────────────────────────────────────────────────────────────────────────

def train_and_save(model_path: str = _DEFAULT_MODEL_PATH, epochs: int = 40) -> None:
    """합성 데이터로 LSTM 학습 후 모델 저장."""
    os.makedirs(os.path.dirname(os.path.abspath(model_path)), exist_ok=True)

    logger.info("합성 학습 데이터 생성 중 (n=1000)...")
    X, y = _generate_synthetic_data(n_events=1000)

    split = int(len(X) * 0.9)
    X_tr = torch.tensor(X[:split])
    y_tr = torch.tensor(y[:split])
    X_val = torch.tensor(X[split:])
    y_val = torch.tensor(y[split:])

    model = _RPSNet()
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=15, gamma=0.5)
    criterion = nn.MSELoss()

    logger.info(f"LSTM 학습 시작 ({epochs} epochs)...")
    for epoch in range(epochs):
        model.train()
        optimizer.zero_grad()
        loss = criterion(model(X_tr), y_tr)
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        optimizer.step()
        scheduler.step()

        if (epoch + 1) % 10 == 0:
            model.eval()
            with torch.no_grad():
                val_loss = criterion(model(X_val), y_val).item()
            logger.info(
                f"  Epoch {epoch+1:3d}/{epochs} | "
                f"train={loss.item():.5f} | val={val_loss:.5f}"
            )

    torch.save(model.state_dict(), model_path)
    logger.info(f"모델 저장 완료: {model_path}")


# ── 예측기 클래스 ────────────────────────────────────────────────────────────────

class TrafficForecaster:
    """
    LSTM 기반 티켓 오픈 트래픽 예측기.

    팀원 2 사용법:
        from src.prediction.traffic_forecaster import TrafficForecaster

        forecaster = TrafficForecaster()  # 모델 파일 없으면 자동 학습
        points = forecaster.predict(
            event_id="...",
            target_datetime=event.open_at,
            horizon_hours=6,
            granularity_minutes=15,
            event_scale=min(event.capacity / 50_000, 1.0),  # DB에서 계산
        )

    Parameters
    ----------
    model_path : str
        모델 파일 경로. K8s Volume 마운트 경로와 일치해야 함.
        미지정 시 PREDICTION_MODEL_PATH 환경변수 → 기본 경로 순으로 탐색.
    """

    model_type: str = "lstm"

    def __init__(self, model_path: str = _DEFAULT_MODEL_PATH):
        self._net = _RPSNet()
        abs_path = os.path.abspath(model_path)
        if not os.path.exists(abs_path):
            logger.warning(f"모델 파일 없음 ({abs_path}), 합성 데이터로 학습합니다.")
            train_and_save(abs_path)
        self._net.load_state_dict(
            torch.load(abs_path, map_location="cpu", weights_only=True)
        )
        self._net.eval()
        logger.info(f"LSTM 모델 로드 완료: {abs_path}")

    def predict(
        self,
        event_id: str,
        target_datetime: datetime,
        horizon_hours: int,
        granularity_minutes: int,
        event_scale: float = 0.7,
        mc_samples: int = 40,
    ) -> List[ForecastPoint]:
        """
        Parameters
        ----------
        event_id : str
            예측 대상 이벤트 UUID (로깅용)
        target_datetime : datetime
            예매 오픈 시각 (예측 기준점 T=0)
        horizon_hours : int
            예측 기간 (1~72 시간)
        granularity_minutes : int
            예측 간격 (5/15/30/60 분)
        event_scale : float
            이벤트 규모 0~1. 권장: min(event.capacity / 50_000, 1.0)
        mc_samples : int
            Monte Carlo Dropout 샘플 수 (불확실성 정량화)

        Returns
        -------
        List[ForecastPoint]
            timestamp, predicted_rps, lower_bound, upper_bound 포함 시계열
        """
        steps = (horizon_hours * 60) // granularity_minutes
        feats = _build_features(steps, event_scale)
        x = torch.tensor(feats).unsqueeze(0)   # (1, steps, 4)

        # Monte Carlo Dropout: dropout 활성화 상태로 복수 추론 → 분포 추정
        self._net.train()
        samples = np.zeros((mc_samples, steps), dtype=np.float32)
        with torch.no_grad():
            for i in range(mc_samples):
                samples[i] = self._net(x).squeeze(0).numpy()
        self._net.eval()

        mean_norm = samples.mean(axis=0)
        std_norm = samples.std(axis=0)

        points: List[ForecastPoint] = []
        for i in range(steps):
            ts = target_datetime + timedelta(minutes=i * granularity_minutes)
            rps = float(mean_norm[i]) * _RPS_SCALE
            margin = float(std_norm[i]) * _RPS_SCALE * _CI_Z
            points.append(ForecastPoint(
                timestamp=ts,
                predicted_rps=round(max(0.0, rps), 1),
                lower_bound=round(max(0.0, rps - margin), 1),
                upper_bound=round(rps + margin, 1),
            ))

        logger.debug(
            f"[{event_id}] 예측 완료: {steps}개 지점, "
            f"peak={max(p.predicted_rps for p in points):.0f} RPS"
        )
        return points


# ── 단독 실행 시 학습 ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    path = sys.argv[1] if len(sys.argv) > 1 else _DEFAULT_MODEL_PATH
    train_and_save(path)