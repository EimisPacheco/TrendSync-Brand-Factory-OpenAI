"use client";

import { useState } from "react";

export default function SettingsPage() {
  const [apiBaseUrl, setApiBaseUrl] = useState(
    typeof window !== "undefined"
      ? localStorage.getItem("ts_api_base_url") || "http://localhost:8000"
      : "http://localhost:8000"
  );
  const [voiceUrl, setVoiceUrl] = useState(
    typeof window !== "undefined"
      ? localStorage.getItem("ts_voice_url") || "http://localhost:8002"
      : "http://localhost:8002"
  );
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem("ts_api_base_url", apiBaseUrl);
    localStorage.setItem("ts_voice_url", voiceUrl);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold" style={{ color: "var(--pastel-navy)" }}>Settings</h1>
        <p style={{ color: "var(--pastel-text-light)" }}>
          Configure platform connections and preferences.
        </p>
      </div>

      <div className="neumorphic-card p-6 space-y-6">
        <h2 className="text-lg font-semibold" style={{ color: "var(--pastel-navy)" }}>
          Backend Configuration
        </h2>

        <div>
          <label className="text-sm font-semibold block mb-1" style={{ color: "var(--pastel-navy)" }}>
            API Base URL
          </label>
          <input
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            className="input-neumorphic"
            placeholder="http://localhost:8000"
          />
          <p className="text-xs mt-1" style={{ color: "var(--pastel-muted)" }}>
            Main backend service (FastAPI)
          </p>
        </div>

        <div>
          <label className="text-sm font-semibold block mb-1" style={{ color: "var(--pastel-navy)" }}>
            Voice Companion URL
          </label>
          <input
            value={voiceUrl}
            onChange={(e) => setVoiceUrl(e.target.value)}
            className="input-neumorphic"
            placeholder="http://localhost:8002"
          />
          <p className="text-xs mt-1" style={{ color: "var(--pastel-muted)" }}>
            Voice companion service (Google ADK)
          </p>
        </div>

        <button onClick={handleSave} className="btn-navy w-full py-3">
          {saved ? "✓ Saved!" : "Save Settings"}
        </button>
      </div>

      <div className="neumorphic-card p-6">
        <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--pastel-navy)" }}>
          Service Architecture
        </h2>
        <div className="space-y-2 text-sm">
          {[
            { port: "8000", name: "Main Backend", desc: "API gateway — collections, images, validation, trends" },
            { port: "8001", name: "Video Gen Service", desc: "Veo 3.1 ad video generation + FFmpeg stitching" },
            { port: "8002", name: "Voice Companion", desc: "Google ADK + Gemini Live voice agent" },
          ].map((svc) => (
            <div key={svc.port} className="neumorphic-inset p-3 rounded-xl flex items-center gap-3">
              <span className="font-mono text-xs px-2 py-1 rounded bg-gray-200" style={{ color: "var(--pastel-navy)" }}>
                :{svc.port}
              </span>
              <div>
                <p className="font-semibold" style={{ color: "var(--pastel-navy)" }}>{svc.name}</p>
                <p className="text-xs" style={{ color: "var(--pastel-muted)" }}>{svc.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="neumorphic-card p-6">
        <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--pastel-navy)" }}>
          GCP Configuration
        </h2>
        <div className="neumorphic-inset p-4 rounded-xl text-sm">
          <p style={{ color: "var(--pastel-text-light)" }}>
            <strong>Project:</strong> crafty-cairn-469222-a8
          </p>
          <p style={{ color: "var(--pastel-text-light)" }}>
            <strong>Service Account:</strong> hackthons@crafty-cairn-469222-a8.iam.gserviceaccount.com
          </p>
          <p style={{ color: "var(--pastel-text-light)" }}>
            <strong>Credentials:</strong> salvador-google-credential-key.json
          </p>
        </div>
      </div>
    </div>
  );
}
