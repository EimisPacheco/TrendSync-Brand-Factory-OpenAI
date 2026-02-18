import { Camera, RotateCcw } from 'lucide-react';
import type { CameraSettings } from '../../types/database';

interface CameraSettingsEditorProps {
  settings: CameraSettings;
  onChange: (settings: CameraSettings) => void;
}

const PRESETS: { id: CameraSettings['allowedPresets'][number]; label: string; description: string }[] = [
  { id: 'hero', label: 'Hero Shot', description: 'Main product view' },
  { id: 'detail', label: 'Detail', description: 'Close-up textures' },
  { id: 'lifestyle', label: 'Lifestyle', description: 'In-context usage' },
  { id: 'flatlay', label: 'Flat Lay', description: 'Top-down view' },
];

export function CameraSettingsEditor({ settings, onChange }: CameraSettingsEditorProps) {
  const update = (key: keyof CameraSettings, value: number | CameraSettings['allowedPresets']) => {
    onChange({ ...settings, [key]: value });
  };

  const togglePreset = (preset: CameraSettings['allowedPresets'][number]) => {
    const current = settings.allowedPresets;
    const newPresets = current.includes(preset)
      ? current.filter(p => p !== preset)
      : [...current, preset];
    update('allowedPresets', newPresets);
  };

  const resetDefaults = () => {
    onChange({
      fovMin: 24,
      fovMax: 85,
      fovDefault: 50,
      angleMin: 0,
      angleMax: 90,
      angleDefault: 30,
      distanceMin: 1,
      distanceMax: 10,
      heightMin: -2,
      heightMax: 2,
      allowedPresets: ['hero', 'detail', 'lifestyle'],
    });
  };

  return (
    <div className="neumorphic-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 circular-icon">
            <Camera size={20} className="text-pastel-accent" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-pastel-navy">Camera Settings</h3>
            <p className="text-sm text-pastel-muted">Control angle, FOV, and distance</p>
          </div>
        </div>
        <button
          onClick={resetDefaults}
          className="p-2 text-pastel-muted hover:text-pastel-navy neumorphic-sm rounded-lg transition-all"
          title="Reset to defaults"
        >
          <RotateCcw size={18} />
        </button>
      </div>

      <div className="space-y-6">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-pastel-navy">Field of View (FOV)</label>
            <span className="text-sm text-pastel-muted">
              {settings.fovMin} - {settings.fovMax} (default: {settings.fovDefault})
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-pastel-muted mb-1">Min</p>
              <input
                type="range"
                min={15}
                max={settings.fovMax - 5}
                value={settings.fovMin}
                onChange={(e) => update('fovMin', Number(e.target.value))}
                className="w-full accent-pastel-teal"
              />
              <input
                type="number"
                value={settings.fovMin}
                onChange={(e) => update('fovMin', Number(e.target.value))}
                className="w-full mt-1 input-neumorphic px-2 py-1 text-sm text-pastel-navy text-center"
              />
            </div>
            <div>
              <p className="text-xs text-pastel-muted mb-1">Default</p>
              <input
                type="range"
                min={settings.fovMin}
                max={settings.fovMax}
                value={settings.fovDefault}
                onChange={(e) => update('fovDefault', Number(e.target.value))}
                className="w-full accent-pastel-teal"
              />
              <input
                type="number"
                value={settings.fovDefault}
                onChange={(e) => update('fovDefault', Number(e.target.value))}
                className="w-full mt-1 input-neumorphic px-2 py-1 text-sm text-pastel-navy text-center"
              />
            </div>
            <div>
              <p className="text-xs text-pastel-muted mb-1">Max</p>
              <input
                type="range"
                min={settings.fovMin + 5}
                max={120}
                value={settings.fovMax}
                onChange={(e) => update('fovMax', Number(e.target.value))}
                className="w-full accent-pastel-teal"
              />
              <input
                type="number"
                value={settings.fovMax}
                onChange={(e) => update('fovMax', Number(e.target.value))}
                className="w-full mt-1 input-neumorphic px-2 py-1 text-sm text-pastel-navy text-center"
              />
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-pastel-navy">Camera Angle</label>
            <span className="text-sm text-pastel-muted">
              {settings.angleMin} - {settings.angleMax} (default: {settings.angleDefault})
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-pastel-muted mb-1">Min</p>
              <input
                type="range"
                min={-45}
                max={settings.angleMax - 5}
                value={settings.angleMin}
                onChange={(e) => update('angleMin', Number(e.target.value))}
                className="w-full accent-pastel-teal"
              />
              <input
                type="number"
                value={settings.angleMin}
                onChange={(e) => update('angleMin', Number(e.target.value))}
                className="w-full mt-1 input-neumorphic px-2 py-1 text-sm text-pastel-navy text-center"
              />
            </div>
            <div>
              <p className="text-xs text-pastel-muted mb-1">Default</p>
              <input
                type="range"
                min={settings.angleMin}
                max={settings.angleMax}
                value={settings.angleDefault}
                onChange={(e) => update('angleDefault', Number(e.target.value))}
                className="w-full accent-pastel-teal"
              />
              <input
                type="number"
                value={settings.angleDefault}
                onChange={(e) => update('angleDefault', Number(e.target.value))}
                className="w-full mt-1 input-neumorphic px-2 py-1 text-sm text-pastel-navy text-center"
              />
            </div>
            <div>
              <p className="text-xs text-pastel-muted mb-1">Max</p>
              <input
                type="range"
                min={settings.angleMin + 5}
                max={180}
                value={settings.angleMax}
                onChange={(e) => update('angleMax', Number(e.target.value))}
                className="w-full accent-pastel-teal"
              />
              <input
                type="number"
                value={settings.angleMax}
                onChange={(e) => update('angleMax', Number(e.target.value))}
                className="w-full mt-1 input-neumorphic px-2 py-1 text-sm text-pastel-navy text-center"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-pastel-navy block mb-2">
              Distance Range (m)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={settings.distanceMin}
                onChange={(e) => update('distanceMin', Number(e.target.value))}
                step={0.5}
                className="w-20 input-neumorphic px-2 py-1 text-sm text-pastel-navy text-center"
              />
              <span className="text-pastel-muted">to</span>
              <input
                type="number"
                value={settings.distanceMax}
                onChange={(e) => update('distanceMax', Number(e.target.value))}
                step={0.5}
                className="w-20 input-neumorphic px-2 py-1 text-sm text-pastel-navy text-center"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-pastel-navy block mb-2">
              Height Range (m)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={settings.heightMin}
                onChange={(e) => update('heightMin', Number(e.target.value))}
                step={0.5}
                className="w-20 input-neumorphic px-2 py-1 text-sm text-pastel-navy text-center"
              />
              <span className="text-pastel-muted">to</span>
              <input
                type="number"
                value={settings.heightMax}
                onChange={(e) => update('heightMax', Number(e.target.value))}
                step={0.5}
                className="w-20 input-neumorphic px-2 py-1 text-sm text-pastel-navy text-center"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-pastel-navy block mb-3">Allowed Presets</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {PRESETS.map(preset => (
              <button
                key={preset.id}
                onClick={() => togglePreset(preset.id)}
                className={`p-3 rounded-xl text-left transition-all ${
                  settings.allowedPresets.includes(preset.id)
                    ? 'neumorphic-inset text-pastel-navy'
                    : 'neumorphic-sm text-pastel-text-light hover:shadow-neumorphic'
                }`}
              >
                <p className="font-medium text-sm">{preset.label}</p>
                <p className="text-xs text-pastel-muted">{preset.description}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
