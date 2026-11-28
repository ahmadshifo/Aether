FROM python:3.12-slim
WORKDIR /app
ENV HOME=/models PYTHONUNBUFFERED=1 PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 libgomp1 libgl1 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir paddlepaddle==3.3.1 paddleocr==3.7.0 fastapi==0.165.0 uvicorn==0.54.0
COPY app.py ./app.py
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8004", "--no-access-log"]
