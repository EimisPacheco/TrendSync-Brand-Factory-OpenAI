"""
Cloud Run entrypoint — loads the correct FastAPI app based on SERVICE env var.

Service directories have hyphens (main-backend, video-gen-service, voice-companion)
which aren't valid Python import paths, so we use importlib to load by file path.
"""

import importlib.util
import os
import sys

# Ensure /app is on sys.path so `from shared.xxx import ...` works inside services
app_dir = os.path.dirname(os.path.abspath(__file__))
if app_dir not in sys.path:
    sys.path.insert(0, app_dir)

service = os.environ.get("SERVICE", "main-backend")
port = int(os.environ.get("PORT", "8080"))

service_path = os.path.join(app_dir, "services", service, "main.py")
if not os.path.exists(service_path):
    print(f"[entrypoint] ERROR: Service file not found: {service_path}")
    sys.exit(1)

print(f"[entrypoint] Starting service={service} on port={port}")

spec = importlib.util.spec_from_file_location("service_main", service_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

import uvicorn

uvicorn.run(mod.app, host="0.0.0.0", port=port)
