# Build from multimedia/: docker build -f api/Dockerfile -t aether-multimedia .
# .dockerignore excludes credentials, stored images and virtual environments.
FROM python:3.13-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY api/ ./api/
COPY database/ ./database/
COPY processing/ ./processing/
EXPOSE 8000
# Publish on host loopback, e.g. -p 127.0.0.1:8000:8000; supply private settings
# and the existing account service JWT_SECRET at runtime, never in the image.
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
