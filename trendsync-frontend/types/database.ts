// Re-export all types from the original codebase — identical schema
// This ensures full compatibility with Supabase tables

export interface ColorSwatch {
  id: string;
  name: string;
  hex: string;
  designation: "primary" | "secondary" | "accent" | "neutral";
  pantone?: string;
}

export interface CameraSettings {
  fovMin: number;
  fovMax: number;
  fovDefault: number;
  angleMin: number;
  angleMax: number;
  angleDefault: number;
  distanceMin: number;
  distanceMax: number;
  heightMin: number;
  heightMax: number;
  allowedPresets: ("hero" | "detail" | "lifestyle" | "flatlay")[];
}

export interface LightingConfig {
  keyIntensity: number;
  fillIntensity: number;
  rimIntensity: number;
  colorTemperature: number;
  allowHDR: boolean;
  shadowSoftness: number;
}

export interface MaterialSpec {
  id: string;
  name: string;
  category: "sustainable" | "premium" | "technical" | "standard";
  description: string;
  seasons: ("spring" | "summer" | "fall" | "winter")[];
}

export interface BrandStyleJSON {
  colorPalette: ColorSwatch[];
  cameraSettings: CameraSettings;
  lightingConfig: LightingConfig;
  logoRules: { zone: string; minSize: number; maxSize: number };
  materialLibrary: MaterialSpec[];
  negativePrompts: string[];
  aspectRatios: { width: number; height: number; name: string }[];
}

export interface CollectionItem {
  id: string;
  collection_id: string;
  name: string;
  category: string;
  subcategory?: string;
  description: string;
  color_story: string;
  material: string;
  target_price: string;
  image_url?: string | null;
  image_base64?: string;
  video_url?: string | null;
  status: string;
  validation?: {
    is_valid: boolean;
    compliance_score: number;
    violations: Violation[];
    auto_fixes_available: number;
  };
  product_id?: string;
}

export interface Violation {
  id: string;
  rule: string;
  category: "color" | "camera" | "lighting" | "logo" | "material" | "prompt";
  severity: "critical" | "warning" | "suggestion";
  detected: string | number;
  allowed: string | number | { min: number; max: number };
  message: string;
  autoFixAvailable: boolean;
  fixedValue?: string | number;
}

export interface TrendInsights {
  colors: { name: string; hex?: string; confidence: number; description: string }[];
  silhouettes: { name: string; confidence: number; description: string }[];
  materials: { name: string; confidence: number; description: string }[];
  themes: { name: string; confidence: number; description: string }[];
  celebrities?: { name: string; profession: string; signature_style: string; influence_score?: number }[];
  summary: string;
}

export interface CollectionConfig {
  brand_id: string;
  season: string;
  region: string;
  demographic: string;
  categories: string[];
  product_count: number;
  trend_source: string;
}
