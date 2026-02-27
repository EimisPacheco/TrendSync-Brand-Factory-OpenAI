FROM python:3.11-slim

WORKDIR /app

# Install ffmpeg for video stitching (Veo 3.1 pipeline)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY . .

# SERVICE env var selects which service to run:
#   main-backend | video-gen-service | voice-companion
ENV SERVICE=main-backend

CMD ["python", "entrypoint.py"]
