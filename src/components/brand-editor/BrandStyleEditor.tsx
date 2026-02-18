import { useState, useEffect } from 'react';
import { Save, Eye, Code, AlertCircle } from 'lucide-react';
import { ColorPaletteEditor } from './ColorPaletteEditor';
import { CameraSettingsEditor } from './CameraSettingsEditor';
import { LightingConfigEditor } from './LightingConfigEditor';
import { MaterialLibraryEditor } from './MaterialLibraryEditor';
import { NegativePromptsEditor } from './NegativePromptsEditor';
import type { BrandStyleJSON, BrandStyle } from '../../types/database';

interface BrandStyleEditorProps {
  brandId: string;
  initialStyle?: BrandStyleJSON | null;
  onSave: (styleJson: BrandStyleJSON) => Promise<void>;
}

const DEFAULT_STYLE: BrandStyleJSON = {
  colorPalette: [],
  cameraSettings: {
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
  },
  lightingConfig: {
    keyIntensity: 80,
    fillIntensity: 40,
    rimIntensity: 30,
    colorTemperature: 5500,
    allowHDR: true,
    shadowSoftness: 50,
  },
  logoRules: {
    zone: 'chest',
    minSize: 5,
    maxSize: 15,
    allowedPositions: [{ x: 50, y: 20 }],
    exclusionZones: [],
  },
  materialLibrary: [],
  negativePrompts: ['blurry', 'low quality', 'distorted', 'watermark'],
  aspectRatios: [
    { width: 1, height: 1, name: 'Square' },
    { width: 4, height: 5, name: 'Portrait' },
    { width: 16, height: 9, name: 'Landscape' },
  ],
};

export function BrandStyleEditor({ initialStyle, onSave }: BrandStyleEditorProps) {
  const [style, setStyle] = useState<BrandStyleJSON>(
    initialStyle || DEFAULT_STYLE
  );
  const [saving, setSaving] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setHasChanges(true);
  }, [style]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(style);
      setHasChanges(false);
    } finally {
      setSaving(false);
    }
  };

  const validationIssues = validateStyle(style);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between sticky top-0 pastel-gradient py-4 z-10 border-b border-pastel-muted/20">
        <div>
          <h2 className="text-2xl font-bold text-pastel-navy">Brand Style Editor</h2>
          <p className="text-pastel-text-light">Configure visual rules for FIBO generation</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowJson(!showJson)}
            className={`px-4 py-2 rounded-xl font-medium transition-all flex items-center gap-2 ${
              showJson
                ? 'neumorphic-inset text-pastel-navy'
                : 'neumorphic-sm text-pastel-text-light hover:text-pastel-navy'
            }`}
          >
            {showJson ? <Eye size={18} /> : <Code size={18} />}
            {showJson ? 'Visual' : 'JSON'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || validationIssues.length > 0}
            className="px-6 py-2 btn-navy flex items-center gap-2 disabled:opacity-50"
          >
            <Save size={18} />
            {saving ? 'Saving...' : 'Save Style'}
          </button>
        </div>
      </div>

      {validationIssues.length > 0 && (
        <div className="neumorphic-card p-4 border-2 border-amber-200">
          <div className="flex items-center gap-2 text-amber-600 mb-2">
            <AlertCircle size={18} />
            <span className="font-medium">Validation Issues</span>
          </div>
          <ul className="list-disc list-inside text-sm text-amber-700 space-y-1">
            {validationIssues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {showJson ? (
        <div className="neumorphic-card p-6">
          <pre className="text-sm text-pastel-text overflow-auto max-h-[600px]">
            {JSON.stringify(style, null, 2)}
          </pre>
        </div>
      ) : (
        <div className="space-y-6">
          <ColorPaletteEditor
            colors={style.colorPalette}
            onChange={(colorPalette) => setStyle({ ...style, colorPalette })}
          />

          <CameraSettingsEditor
            settings={style.cameraSettings}
            onChange={(cameraSettings) => setStyle({ ...style, cameraSettings })}
          />

          <LightingConfigEditor
            config={style.lightingConfig}
            onChange={(lightingConfig) => setStyle({ ...style, lightingConfig })}
          />

          <MaterialLibraryEditor
            materials={style.materialLibrary}
            onChange={(materialLibrary) => setStyle({ ...style, materialLibrary })}
          />

          <NegativePromptsEditor
            prompts={style.negativePrompts}
            onChange={(negativePrompts) => setStyle({ ...style, negativePrompts })}
          />
        </div>
      )}

      {hasChanges && (
        <div className="fixed bottom-6 right-6 neumorphic-card px-4 py-3 flex items-center gap-4">
          <span className="text-pastel-muted text-sm">Unsaved changes</span>
          <button
            onClick={handleSave}
            disabled={saving || validationIssues.length > 0}
            className="px-4 py-1.5 btn-navy text-sm disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

function validateStyle(style: BrandStyleJSON): string[] {
  const issues: string[] = [];

  if (style.colorPalette.length === 0) {
    issues.push('Add at least one color to your palette');
  }

  if (!style.colorPalette.some(c => c.designation === 'primary')) {
    issues.push('Designate at least one color as primary');
  }

  if (style.cameraSettings.fovMin >= style.cameraSettings.fovMax) {
    issues.push('FOV minimum must be less than maximum');
  }

  if (style.cameraSettings.angleMin >= style.cameraSettings.angleMax) {
    issues.push('Angle minimum must be less than maximum');
  }

  if (style.materialLibrary.length === 0) {
    issues.push('Add at least one approved material');
  }

  return issues;
}
