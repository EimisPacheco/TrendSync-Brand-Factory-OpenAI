import { Sun, Lightbulb } from 'lucide-react';
import type { LightingConfig } from '../../types/database';

interface LightingConfigEditorProps {
  config: LightingConfig;
  onChange: (config: LightingConfig) => void;
}

export function LightingConfigEditor({ config, onChange }: LightingConfigEditorProps) {
  const update = (key: keyof LightingConfig, value: number | boolean) => {
    onChange({ ...config, [key]: value });
  };

  const getTemperatureColor = (temp: number) => {
    if (temp < 4000) return 'from-orange-400 to-amber-500';
    if (temp < 5500) return 'from-amber-300 to-yellow-200';
    return 'from-sky-200 to-sky-400';
  };

  const getTemperatureLabel = (temp: number) => {
    if (temp < 3500) return 'Warm (Tungsten)';
    if (temp < 4500) return 'Warm White';
    if (temp < 5500) return 'Daylight';
    if (temp < 6500) return 'Cool Daylight';
    return 'Cool (Blue Sky)';
  };

  return (
    <div className="neumorphic-card p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 circular-icon">
          <Sun size={20} className="text-amber-500" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-pastel-navy">Lighting Configuration</h3>
          <p className="text-sm text-pastel-muted">Set lighting intensity and mood</p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-pastel-navy flex items-center gap-2">
                <Lightbulb size={14} className="text-amber-500" />
                Key Light
              </label>
              <span className="text-sm text-amber-500 font-medium">{config.keyIntensity}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={config.keyIntensity}
              onChange={(e) => update('keyIntensity', Number(e.target.value))}
              className="w-full accent-amber-500"
            />
            <p className="text-xs text-pastel-muted mt-1">Primary light source</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-pastel-navy flex items-center gap-2">
                <Lightbulb size={14} className="text-pastel-accent" />
                Fill Light
              </label>
              <span className="text-sm text-pastel-accent font-medium">{config.fillIntensity}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={config.fillIntensity}
              onChange={(e) => update('fillIntensity', Number(e.target.value))}
              className="w-full accent-pastel-accent"
            />
            <p className="text-xs text-pastel-muted mt-1">Softens shadows</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-pastel-navy flex items-center gap-2">
                <Lightbulb size={14} className="text-pastel-text" />
                Rim Light
              </label>
              <span className="text-sm text-pastel-text font-medium">{config.rimIntensity}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={config.rimIntensity}
              onChange={(e) => update('rimIntensity', Number(e.target.value))}
              className="w-full accent-pastel-text"
            />
            <p className="text-xs text-pastel-muted mt-1">Edge definition</p>
          </div>
        </div>

        <div className="pt-4 border-t border-pastel-muted/20">
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-pastel-navy">Color Temperature</label>
            <span className="text-sm text-pastel-muted">
              {config.colorTemperature}K - {getTemperatureLabel(config.colorTemperature)}
            </span>
          </div>
          <div className={`h-2 rounded-full bg-gradient-to-r ${getTemperatureColor(config.colorTemperature)} mb-2 shadow-neumorphic-sm`} />
          <input
            type="range"
            min={2700}
            max={8000}
            step={100}
            value={config.colorTemperature}
            onChange={(e) => update('colorTemperature', Number(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-pastel-muted mt-1">
            <span>Warm (2700K)</span>
            <span>Daylight (5500K)</span>
            <span>Cool (8000K)</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-pastel-muted/20">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-pastel-navy">Shadow Softness</label>
              <span className="text-sm text-pastel-muted">{config.shadowSoftness}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={config.shadowSoftness}
              onChange={(e) => update('shadowSoftness', Number(e.target.value))}
              className="w-full accent-pastel-muted"
            />
            <div className="flex justify-between text-xs text-pastel-muted mt-1">
              <span>Hard shadows</span>
              <span>Soft shadows</span>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-pastel-navy block mb-2">HDR Output</label>
            <button
              onClick={() => update('allowHDR', !config.allowHDR)}
              className={`w-full p-3 rounded-xl text-left transition-all ${
                config.allowHDR
                  ? 'neumorphic-inset'
                  : 'neumorphic-sm'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className={`font-medium ${config.allowHDR ? 'text-emerald-600' : 'text-pastel-muted'}`}>
                    16-bit HDR
                  </p>
                  <p className="text-xs text-pastel-muted">Production-ready output</p>
                </div>
                <div className={`w-12 h-6 rounded-full transition-colors shadow-neumorphic-sm ${
                  config.allowHDR ? 'bg-emerald-500' : 'bg-pastel-muted/30'
                }`}>
                  <div className={`w-5 h-5 rounded-full bg-white mt-0.5 transition-transform shadow-md ${
                    config.allowHDR ? 'translate-x-6' : 'translate-x-0.5'
                  }`} />
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
