FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
# CPU-only PyTorch 먼저 설치 (~180MB vs full ~700MB) — GPU 불필요
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY alembic/ ./alembic/
COPY alembic.ini .
COPY data/ ./data/

RUN mkdir -p /app/models && \
    python -m src.prediction.traffic_forecaster /app/models/traffic_model.pt

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]