# Member 2: runs the web AI backend on internal port 8002 and keeps API credentials outside the image.
# Build with the shared face blurrer available: docker build -f web/ai-backend/Dockerfile .
FROM python:3.12-slim
WORKDIR /aether/web/ai-backend
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY web/ai-backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY web/ai-backend/app/ ./app/
COPY multimedia/processing/__init__.py multimedia/processing/face_blur.py multimedia/processing/image_utils.py /aether/multimedia/processing/
COPY multimedia/processing/models/face_detection_yunet_2023mar.onnx /aether/multimedia/processing/models/
EXPOSE 8002
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
