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

    Input  : (batch, seq_len, 5)
             [t_frac, sin(2π·t_frac), cos(2π·t_frac), event_scale, hour_of_day]
    Output : (batch, seq_len)  — 정규화된 RPS (0~1)
    """

    def __init__(self, input_size: int = 5, hidden_size: int = 64, num_layers: int = 2):
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
    """
    시퀀스 피처 행렬 생성: (steps, 5).

    피처:
    1. t_frac: 시퀀스 상 상대 위치 (0~1)
    2. sin(2π·t_frac): 순환 시간 (사인)
    3. cos(2π·t_frac): 순환 시간 (코사인)
    4. event_scale: 이벤트 규모 (상수)
    5. hour_of_day: 하루 중 절대 시각 (0~1, 자정=0, 정오=0.5)
    """
    t = np.arange(steps, dtype=np.float32)
    t_frac = t / max(steps - 1, 1)
    # hour_of_day: step * 15분 → 시간 → 정규화 (0~1)
    # step 0 = 00:00 (0/24), step 40 = 10:00 (10/24 ≈ 0.417)
    hour_of_day = (t * 15.0 / 60.0) / 24.0
    feats = np.stack([
        t_frac,
        np.sin(2 * math.pi * t_frac),
        np.cos(2 * math.pi * t_frac),
        np.full(steps, event_scale, dtype=np.float32),
        hour_of_day,
    ], axis=1)
    return feats


_OPEN_STEPS = [40, 56]  # 오전 10시(step 40), 오후 2시(step 56) — 15분 단위


def _append_sample(
    X_list: list,
    y_list: list,
    event_scale: float,
    seq_len: int,
    rng: np.random.Generator,
) -> None:
  """
  학습 데이터에 샘플 추가.
  event_scale → RPS 시계열 생성 및 feature 벡터와 함께 저장.
  """
  peak_rps = float(rng.uniform(200.0, _RPS_SCALE) * event_scale)
  baseline = float(rng.uniform(20.0, 80.0))
  noise_std = float(rng.uniform(0.03, 0.12))

  t = np.arange(seq_len, dtype=np.float32)
  rps = _rps_weekly_sale(t, seq_len, peak_rps, baseline, rng)
  rps *= (1.0 + rng.normal(0.0, noise_std, size=seq_len))
  rps = np.clip(rps, 0.0, None)

  X_list.append(_build_features(seq_len, event_scale))
  y_list.append((rps / _RPS_SCALE).astype(np.float32))


def _rps_weekly_sale(
    t: np.ndarray,
    seq_len: int,
    peak_rps: float,
    baseline: float,
    rng: np.random.Generator,
) -> np.ndarray:
    """
    시퀀스 중간(step 48)에 명확한 피크를 배치.
    LSTM이 event_scale → peak_rps 크기 관계만 학습.

    predict()에서 max값만 추출하므로 피크 위치는 무관.
    predict()가 target_datetime 기준 가우시안으로 곡선을 재구성한다.

    Parameters
    ----------
    t : np.ndarray
        시간 스텝 배열 (0~seq_len-1)
    seq_len : int
        시퀀스 길이 (96 = 24시간 × 15분)
    peak_rps : float
        피크 RPS
    baseline : float
        평시 트래픽 RPS
    rng : np.random.Generator
        난수 생성기

    Returns
    -------
    np.ndarray
        RPS 곡선: 중간부 (step 48) 기준 warmup + burst + tail
    """
    peak_step = 48  # seq_len 중간 고정
    pre_start = peak_step - int(rng.integers(4, 9))
    sigma = float(rng.uniform(2.0, 4.0))
    decay = float(rng.uniform(0.05, 0.12))

    # warmup: 선형 증가
    window = max(peak_step - pre_start, 1)
    warmup = np.where(
        (t >= pre_start) & (t < peak_step),
        (peak_rps * 0.2) * (t - pre_start) / window,
        0.0,
    )

    # burst: 가우시안 피크
    burst = peak_rps * np.exp(-0.5 * ((t - peak_step) / sigma) ** 2)

    # tail: 지수 감쇠
    tail = (peak_rps * 0.3) * np.exp(-decay * np.maximum(t - peak_step, 0.0))

    return warmup + burst + tail + baseline


def _generate_synthetic_data(
    n_events: int = 1000,
    seq_len: int = 96,   # 15분 * 96 = 24시간
    seed: int = 42,
) -> tuple[np.ndarray, np.ndarray]:
    """
    티켓 오픈 트래픽 패턴 합성 데이터 생성.

    패턴: 주간 정기 판매 (Weekly Regular Sale)
    - 정기 이벤트 쌍 (70%): 같은 시리즈, 회차별 약간 다른 참여율
    - 단건 이벤트 (30%): 일회성 이벤트, 전체 범위의 규모

    모델이 학습하는 패턴:
    - event_scale → peak_rps 기본 회귀
    - 정기 이벤트는 회차 간 규모 일관성 (2회차는 85~100% 참여율)
    """
    rng = np.random.default_rng(seed)
    X_list, y_list = [], []

    n_series = int(n_events * 0.7) // 2   # 70% → 각 시리즈 2회차 = 총 700개
    n_oneoff = n_events - n_series * 2    # 30% = 300개 단건

    # 정기 이벤트 쌍: 같은 시리즈의 연속된 오픈
    for _ in range(n_series):
        series_scale = float(rng.uniform(0.3, 1.0))
        for occ in range(2):
            # 2회차는 살짝 낮은 참여율 (첫 회차 100%, 두번째 회차 85~100%)
            if occ == 1:
                event_scale = series_scale * float(rng.uniform(0.85, 1.0))
            else:
                event_scale = series_scale
            _append_sample(X_list, y_list, event_scale, seq_len, rng)

    # 단건 이벤트: 전체 범위의 규모
    for _ in range(n_oneoff):
        event_scale = float(rng.uniform(0.1, 1.0))
        _append_sample(X_list, y_list, event_scale, seq_len, rng)

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
            예매 오픈 시각
        horizon_hours : int
            예측 기간 (1~24 시간)
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
        # STEP 1: LSTM으로 피크 크기만 추출
        # ================================================
        # LSTM은 event_scale → peak_rps 관계를 학습했다.
        # 피크 시각은 target_datetime(DB의 event.start_at)에서 얻는다.
        _SEQ_LEN = 96

        feats = _build_features(_SEQ_LEN, event_scale)
        x = torch.tensor(feats).unsqueeze(0)   # (1, 96, 5)

        # Monte Carlo Dropout로 불확실성 추정
        self._net.train()
        samples = np.zeros((mc_samples, _SEQ_LEN), dtype=np.float32)
        with torch.no_grad():
            for i in range(mc_samples):
                samples[i] = self._net(x).squeeze(0).numpy()
        self._net.eval()

        mean_norm = samples.mean(axis=0)
        std_norm = samples.std(axis=0)

        # LSTM 출력에서 최대값만 추출
        peak_norm = float(mean_norm.max())
        peak_std = float(std_norm[np.argmax(mean_norm)])
        peak_rps = peak_norm * _RPS_SCALE
        margin = peak_std * _RPS_SCALE * _CI_Z

        logger.debug(
            f"[{event_id}] LSTM 예측: peak_rps={peak_rps:.0f}±{margin:.0f} "
            f"(event_scale={event_scale:.2f})"
        )

        # STEP 2: target_datetime을 중심으로 가우시안 곡선 구성
        # ================================================
        # target_datetime이 피크, horizon_hours 범위 내에서 곡선 생성
        sigma_steps = 4.0  # 1시간 = 4 steps (15분 단위)
        steps = (horizon_hours * 60) // granularity_minutes
        center = steps // 2  # 반환 구간의 중앙 = target_datetime

        points: List[ForecastPoint] = []
        for i in range(steps):
            offset = i - center
            ts = target_datetime + timedelta(minutes=offset * granularity_minutes)
            # 가우시안: target_datetime에서 멀어질수록 감소
            gaussian = math.exp(-0.5 * (offset / sigma_steps) ** 2)
            rps = peak_rps * gaussian
            points.append(ForecastPoint(
                timestamp=ts,
                predicted_rps=round(max(0.0, rps), 1),
                lower_bound=round(max(0.0, rps - margin * gaussian), 1),
                upper_bound=round(rps + margin * gaussian, 1),
            ))

        logger.debug(
            f"[{event_id}] 예측 완료: {len(points)}개 지점, "
            f"peak={max(p.predicted_rps for p in points):.0f} RPS at {target_datetime.strftime('%H:%M')}"
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