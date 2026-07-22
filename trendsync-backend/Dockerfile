FROM python:3.11-slim

WORKDIR /app

# Install system deps:
#   • ffmpeg for the Fal video stitching pipeline
#   • Node.js 20 (used by services/voice-companion which is Node, not Python)
#   • curl + ca-certificates for the NodeSource installer
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg curl ca-certificates gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire backend
COPY . .

# Install Node deps for the voice-companion service
RUN cd services/voice-companion && npm install --omit=dev

# SERVICE env var selects which service the entrypoint runs:
#   main-backend | video-gen-service | voice-companion
ENV SERVICE=main-backend

CMD ["python", "entrypoint.py"]
