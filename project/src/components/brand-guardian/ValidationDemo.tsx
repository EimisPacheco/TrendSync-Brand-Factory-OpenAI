import { useState, useEffect } from 'react';
import { Play, ArrowRight, Sparkles, RotateCcw, AlertCircle } from 'lucide-react';
import { ValidationPanel } from './ValidationPanel';
import { brandStorage, brandStyleStorage } from '../../services/storage';
import type { BrandStyleJSON, FIBOPromptJSON } from '../../types/database';
import type { ValidationWithFixes } from '../../lib/brand-guardian';

// Default brand style as fallback
const DEFAULT_BRAND_STYLE: BrandStyleJSON = {
  colorPalette: [
    { id: '1', name: 'Forest Green', hex: '#2D5A27', designation: 'primary' },
    { id: '2', name: 'Sand Beige', hex: '#D4C4A8', designation: 'secondary' },
    { id: '3', name: 'Terracotta', hex: '#C75B39', designation: 'accent' },
    { id: '4', name: 'Charcoal', hex: '#36454F', designation: 'neutral' },
  ],
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
  materialLibrary: [
    { id: '1', name: 'Organic Cotton', category: 'sustainable', description: 'GOTS certified', seasons: ['spring', 'summer', 'fall'] },
    { id: '2', name: 'Recycled Polyester', category: 'sustainable', description: 'From ocean plastics', seasons: ['spring', 'summer', 'fall', 'winter'] },
    { id: '3', name: 'Hemp Blend', category: 'sustainable', description: '55% hemp, 45% cotton', seasons: ['spring', 'summer'] },
  ],
  negativePrompts: ['cheap', 'tacky', 'gaudy', 'generic'],
  aspectRatios: [{ width: 4, height: 5, name: 'Portrait' }],
};

const DEMO_FIBO_PROMPT: FIBOPromptJSON = {
  description: 'A fashion product photograph showcasing an oversized linen shirt with natural texture, displayed on an invisible mannequin against a clean backdrop',
  objects: [
    {
      name: 'Oversized Linen Shirt',
      description: 'Relaxed fit shirt with dropped shoulders, natural linen texture visible, minimalist design with no visible branding',
      attributes: {
        material: 'Premium linen',
        fit: 'Oversized relaxed',
        style: 'Minimalist contemporary',
      },
      position: 'center frame',
      relationships: ['worn on invisible mannequin'],
    },
  ],
  background: 'Clean white studio backdrop with subtle gradient, professional product photography setup',
  lighting: 'Cool studio lighting with soft diffused key light, minimal shadows',
  aesthetics: 'High-end fashion editorial, clean minimalist product photography',
  composition: 'Centered subject with balanced negative space, rule of thirds applied',
  color_scheme: 'Primary color #8B4513 (saddle brown) with accent #1E90FF (dodger blue) details',
  mood_atmosphere: 'Professional, clean, aspirational fashion aesthetic',
  depth_of_field: 'Shallow depth of field with subject in sharp focus',
  focus: 'Sharp focus on garment texture and construction details',
  camera_angle: '55 degree high angle shot',
  focal_length: '24mm wide angle',
  aspect_ratio: '4:5',
  negative_prompt: 'blurry',
  seed: 42,
  num_inference_steps: 50,
  guidance_scale: 5,
};

export function ValidationDemo() {
  const [prompt, setPrompt] = useState<FIBOPromptJSON>(DEMO_FIBO_PROMPT);
  const [isRunning, setIsRunning] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [fixedPrompt, setFixedPrompt] = useState<FIBOPromptJSON | null>(null);
  const [brandStyle, setBrandStyle] = useState<BrandStyleJSON>(DEFAULT_BRAND_STYLE);
  const [brandName, setBrandName] = useState<string>('Demo Brand');

  // Load actual brand style from localStorage on mount
  useEffect(() => {
    // Get the first brand (or specific brand if you have a brandId)
    const brands = brandStorage.getAll();
    if (brands.length > 0) {
      const activeBrand = brands[0]; // Use the first brand or implement logic to select active brand
      setBrandName(activeBrand.name);

      // Load the brand style for this brand
      const loadedStyle = brandStyleStorage.getByBrandId(activeBrand.id);
      if (loadedStyle) {
        setBrandStyle(loadedStyle);
      }
    }
  }, []);

  const runDemo = () => {
    setIsRunning(true);
    setShowComparison(false);
    setFixedPrompt(null);
    setTimeout(() => setIsRunning(false), 500);
  };

  const handleApplyFixes = (result: ValidationWithFixes) => {
    setFixedPrompt(result.fixedPrompt);
    setShowComparison(true);
  };

  const reset = () => {
    setPrompt(DEMO_FIBO_PROMPT);
    setShowComparison(false);
    setFixedPrompt(null);
  };

  return (
    <div className="space-y-6">
      <div className="neumorphic-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-pastel-navy flex items-center gap-3">
              <div className="p-2 circular-icon">
                <Sparkles className="text-emerald-500" />
              </div>
              Brand Guardian Demo
            </h2>
            <p className="text-pastel-text-light mt-1">
              Watch real-time validation catch off-brand elements and auto-correct them using official FIBO schema
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={reset}
              className="px-4 py-2 btn-soft flex items-center gap-2"
            >
              <RotateCcw size={18} />
              Reset
            </button>
            <button
              onClick={runDemo}
              disabled={isRunning}
              className="px-6 py-2 btn-navy flex items-center gap-2"
            >
              <Play size={18} />
              Run Validation
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="neumorphic-inset p-3 rounded-xl">
            <p className="text-pastel-muted mb-1">Active Brand</p>
            <p className="text-pastel-navy font-medium">{brandName}</p>
          </div>
          <div className="neumorphic-inset p-3 rounded-xl">
            <p className="text-pastel-muted mb-1">Demo Product</p>
            <p className="text-pastel-navy font-medium">Oversized Linen Shirt</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-pastel-navy">FIBO Structured Prompt JSON</h3>
          <div className="neumorphic-card p-4">
            <pre className="text-xs text-pastel-text overflow-auto max-h-[500px]">
              {JSON.stringify(showComparison && fixedPrompt ? fixedPrompt : prompt, null, 2)}
            </pre>
          </div>
          {showComparison && fixedPrompt && (
            <div className="flex items-center gap-2 text-emerald-600 text-sm">
              <ArrowRight size={16} />
              Showing corrected prompt after auto-fixes
            </div>
          )}
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-pastel-navy">Validation Results</h3>
          {!isRunning ? (
            <ValidationPanel
              prompt={showComparison && fixedPrompt ? fixedPrompt : prompt}
              brandStyle={brandStyle}
              onApplyFixes={handleApplyFixes}
            />
          ) : (
            <div className="neumorphic-card p-12 flex items-center justify-center">
              <div className="text-center">
                <div className="w-12 h-12 border-4 border-pastel-accent/30 border-t-pastel-accent rounded-full animate-spin mx-auto mb-4" />
                <p className="text-pastel-text-light">Running validation...</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="neumorphic-card p-6">
        <h3 className="text-lg font-semibold text-pastel-navy mb-4">Current Brand Style Rules</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="neumorphic-inset p-3 rounded-xl">
            <p className="text-xs text-pastel-muted mb-2">Color Palette</p>
            <div className="flex gap-1 flex-wrap">
              {brandStyle.colorPalette.length > 0 ? (
                brandStyle.colorPalette.slice(0, 6).map(c => (
                  <div
                    key={c.id}
                    className="w-8 h-8 rounded-lg shadow-neumorphic-sm"
                    style={{ backgroundColor: c.hex }}
                    title={`${c.name} (${c.designation})`}
                  />
                ))
              ) : (
                <p className="text-xs text-pastel-muted">No colors defined</p>
              )}
            </div>
          </div>
          <div className="neumorphic-inset p-3 rounded-xl">
            <p className="text-xs text-pastel-muted mb-2">FOV Range</p>
            <p className="text-pastel-navy font-medium">
              {brandStyle.cameraSettings.fovMin}° - {brandStyle.cameraSettings.fovMax}°
            </p>
          </div>
          <div className="neumorphic-inset p-3 rounded-xl">
            <p className="text-xs text-pastel-muted mb-2">Angle Range</p>
            <p className="text-pastel-navy font-medium">
              {brandStyle.cameraSettings.angleMin}° - {brandStyle.cameraSettings.angleMax}°
            </p>
          </div>
          <div className="neumorphic-inset p-3 rounded-xl">
            <p className="text-xs text-pastel-muted mb-2">Color Temp</p>
            <p className="text-pastel-navy font-medium">{brandStyle.lightingConfig.colorTemperature}K</p>
          </div>
        </div>

        {/* Additional brand style information */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
          <div className="neumorphic-inset p-3 rounded-xl">
            <p className="text-xs text-pastel-muted mb-2">Negative Prompts</p>
            <p className="text-pastel-navy text-xs">
              {brandStyle.negativePrompts.length} terms blocked
            </p>
          </div>
          <div className="neumorphic-inset p-3 rounded-xl">
            <p className="text-xs text-pastel-muted mb-2">Materials</p>
            <p className="text-pastel-navy text-xs">
              {brandStyle.materialLibrary.length} materials defined
            </p>
          </div>
          <div className="neumorphic-inset p-3 rounded-xl">
            <p className="text-xs text-pastel-muted mb-2">Lighting Style</p>
            <p className="text-pastel-navy text-xs">
              {brandStyle.lightingConfig.colorTemperature < 4500 ? 'Warm' :
               brandStyle.lightingConfig.colorTemperature > 5500 ? 'Cool' : 'Neutral'}
            </p>
          </div>
        </div>
      </div>

      <div className="neumorphic-inset p-4 rounded-xl">
        <p className="text-xs text-pastel-muted">
          {brandName === 'Demo Brand' ? (
            <>
              <AlertCircle className="inline w-3 h-3 mr-1" />
              No brand configured. Using default brand style. Create a brand in the Brand Style tab to see your actual brand rules applied here.
            </>
          ) : (
            <>This demo validates FIBO prompts against your brand's style rules defined in the Brand Style tab.</>
          )}
        </p>
        <p className="text-xs text-pastel-muted mt-2">
          Uses official FIBO JSON schema with fields: description, objects, background, lighting, aesthetics, composition, color_scheme, mood_atmosphere, depth_of_field, focus, camera_angle, focal_length, aspect_ratio, and negative_prompt.
        </p>
      </div>
    </div>
  );
}
