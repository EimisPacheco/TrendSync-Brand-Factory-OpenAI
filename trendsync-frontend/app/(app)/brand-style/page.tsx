"use client";

import { useState, useEffect } from "react";
import { getBrandStyle, saveBrandStyle } from "@/lib/api";

const DEFAULT_BRAND_STYLE = {
  colorPalette: [
    { id: "1", name: "Navy", hex: "#1E2A4A", designation: "primary" },
    { id: "2", name: "Soft Pink", hex: "#E8A0BF", designation: "accent" },
    { id: "3", name: "Cloud White", hex: "#F5F5F5", designation: "neutral" },
    { id: "4", name: "Teal", hex: "#A0D2DB", designation: "secondary" },
  ],
  cameraSettings: {
    fovMin: 20, fovMax: 80, fovDefault: 50,
    angleMin: 0, angleMax: 45, angleDefault: 15,
    distanceMin: 1, distanceMax: 5,
    heightMin: 0, heightMax: 2,
    allowedPresets: ["hero", "detail", "lifestyle", "flatlay"],
  },
  lightingConfig: {
    keyIntensity: 80, fillIntensity: 40, rimIntensity: 30,
    colorTemperature: 5000, allowHDR: true, shadowSoftness: 60,
  },
  logoRules: { zone: "bottom-right", minSize: 24, maxSize: 64 },
  materialLibrary: [
    { id: "1", name: "Organic Cotton", category: "sustainable", description: "GOTS certified organic cotton", seasons: ["spring", "summer"] },
    { id: "2", name: "Italian Silk", category: "premium", description: "Mulberry silk twill", seasons: ["spring", "summer", "fall"] },
    { id: "3", name: "Merino Wool", category: "premium", description: "Fine gauge merino wool", seasons: ["fall", "winter"] },
  ],
  negativePrompts: ["low quality", "blurry", "distorted", "watermark", "text overlay", "cartoon", "anime"],
  aspectRatios: [
    { width: 1, height: 1, name: "Square" },
    { width: 3, height: 4, name: "Portrait" },
  ],
};

export default function BrandStylePage() {
  const [style, setStyle] = useState(DEFAULT_BRAND_STYLE);
  const [editMode, setEditMode] = useState<"visual" | "json">("visual");
  const [jsonText, setJsonText] = useState("");
  const [saving, setSaving] = useState(false);
  const brandId = "default";

  useEffect(() => {
    getBrandStyle(brandId)
      .then((data) => {
        if (data.style && Object.keys(data.style).length > 0) {
          setStyle(data.style as typeof DEFAULT_BRAND_STYLE);
        }
      })
      .catch(() => {
        // Use defaults
      });
  }, []);

  useEffect(() => {
    setJsonText(JSON.stringify(style, null, 2));
  }, [style]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const toSave = editMode === "json" ? JSON.parse(jsonText) : style;
      await saveBrandStyle(brandId, toSave);
      setStyle(toSave);
    } catch (e) {
      console.error("Save failed:", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: "var(--pastel-navy)" }}>Brand Style Editor</h1>
          <p style={{ color: "var(--pastel-text-light)" }}>Define your brand&apos;s visual DNA for AI-consistent designs.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setEditMode(editMode === "visual" ? "json" : "visual")}
            className="btn-soft text-sm"
          >
            {editMode === "visual" ? "Switch to JSON" : "Switch to Visual"}
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-navy text-sm">
            {saving ? "Saving..." : "Save Style"}
          </button>
        </div>
      </div>

      {editMode === "visual" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Color Palette */}
          <div className="neumorphic-card p-6">
            <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--pastel-navy)" }}>Color Palette</h2>
            <div className="grid grid-cols-2 gap-3">
              {style.colorPalette.map((color, i) => (
                <div key={color.id} className="neumorphic-inset p-3 rounded-xl flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg border border-white/50 shadow-sm flex-shrink-0"
                    style={{ backgroundColor: color.hex }}
                  />
                  <div className="flex-1 min-w-0">
                    <input
                      className="input-neumorphic text-sm w-full mb-1"
                      value={color.name}
                      onChange={(e) => {
                        const updated = [...style.colorPalette];
                        updated[i] = { ...updated[i], name: e.target.value };
                        setStyle({ ...style, colorPalette: updated });
                      }}
                    />
                    <input
                      className="input-neumorphic text-xs w-full"
                      value={color.hex}
                      onChange={(e) => {
                        const updated = [...style.colorPalette];
                        updated[i] = { ...updated[i], hex: e.target.value };
                        setStyle({ ...style, colorPalette: updated });
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Camera Settings */}
          <div className="neumorphic-card p-6">
            <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--pastel-navy)" }}>Camera Settings</h2>
            <div className="space-y-3 text-sm">
              {[
                { label: "FOV Range", min: style.cameraSettings.fovMin, max: style.cameraSettings.fovMax },
                { label: "Angle Range", min: style.cameraSettings.angleMin, max: style.cameraSettings.angleMax },
              ].map((s) => (
                <div key={s.label} className="flex items-center justify-between neumorphic-inset p-3 rounded-xl">
                  <span style={{ color: "var(--pastel-text-light)" }}>{s.label}</span>
                  <span className="font-semibold" style={{ color: "var(--pastel-navy)" }}>{s.min}° — {s.max}°</span>
                </div>
              ))}
            </div>
          </div>

          {/* Lighting */}
          <div className="neumorphic-card p-6">
            <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--pastel-navy)" }}>Lighting Config</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between neumorphic-inset p-3 rounded-xl">
                <span style={{ color: "var(--pastel-text-light)" }}>Color Temperature</span>
                <span className="font-semibold" style={{ color: "var(--pastel-navy)" }}>{style.lightingConfig.colorTemperature}K</span>
              </div>
              <div className="flex justify-between neumorphic-inset p-3 rounded-xl">
                <span style={{ color: "var(--pastel-text-light)" }}>Key Light</span>
                <span className="font-semibold" style={{ color: "var(--pastel-navy)" }}>{style.lightingConfig.keyIntensity}%</span>
              </div>
            </div>
          </div>

          {/* Negative Prompts */}
          <div className="neumorphic-card p-6">
            <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--pastel-navy)" }}>Negative Prompts</h2>
            <div className="flex flex-wrap gap-2">
              {style.negativePrompts.map((neg, i) => (
                <span key={i} className="neumorphic-inset px-3 py-1 rounded-full text-xs font-medium" style={{ color: "var(--pastel-navy)" }}>
                  {neg}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="neumorphic-card p-6">
          <textarea
            className="input-neumorphic w-full h-[600px] font-mono text-sm"
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
