"""
Cloud Run entrypoint — boots the correct service based on SERVICE env var.

Python services (main-backend, video-gen-service) are loaded as FastAPI apps
and run under uvicorn. The voice-companion service is now a Node.js process,
so we exec `node voice-agent-service.js` directly when SERVICE=voice-companion.

Service directory names contain hyphens, which aren't valid Python import
paths, so for Python services we use importlib to load by file path.
"""

import importlib.util
import os
import sys

# Make `from shared.xxx import ...` work from inside services/*
app_dir = os.path.dirname(os.path.abspath(__file__))
if app_dir not in sys.path:
    sys.path.insert(0, app_dir)

service = os.environ.get("SERVICE", "main-backend")
port = int(os.environ.get("PORT", "8080"))

# ----------------------------------------------------------------------
# Voice companion: Node.js (OpenAI Realtime). Replace the current process
# with `node voice-agent-service.js` so signals propagate cleanly.
# ----------------------------------------------------------------------
if service == "voice-companion":
    voice_dir = os.path.join(app_dir, "services", "voice-companion")
    entry_js = os.path.join(voice_dir, "voice-agent-service.js")
    if not os.path.exists(entry_js):
        print(f"[entrypoint] ERROR: Node entrypoint not found: {entry_js}")
        sys.exit(1)
    # The Node service reads PORT (defaults to 8002 if unset).
    os.environ["PORT"] = str(port)
    print(f"[entrypoint] Starting Node voice-companion on port={port}")
    os.chdir(voice_dir)
    os.execvp("node", ["node", "voice-agent-service.js"])

# ----------------------------------------------------------------------
# Python services
# ----------------------------------------------------------------------
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
