export interface ColorSwatch {
  id: string;
  name: string;
  hex: string;
  designation: 'primary' | 'secondary' | 'accent' | 'neutral';
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
  allowedPresets: ('hero' | 'detail' | 'lifestyle' | 'flatlay')[];
}

export interface LightingConfig {
  keyIntensity: number;
  fillIntensity: number;
  rimIntensity: number;
  colorTemperature: number;
  allowHDR: boolean;
  shadowSoftness: number;
}

export interface LogoPlacement {
  zone: string;
  minSize: number;
  maxSize: number;
  allowedPositions: { x: number; y: number }[];
  exclusionZones: { x: number; y: number; width: number; height: number }[];
}

export interface MaterialSpec {
  id: string;
  name: string;
  category: 'sustainable' | 'premium' | 'technical' | 'standard';
  description: string;
  seasons: ('spring' | 'summer' | 'fall' | 'winter')[];
}

export interface BrandStyleJSON {
  colorPalette: ColorSwatch[];
  cameraSettings: CameraSettings;
  lightingConfig: LightingConfig;
  logoRules: LogoPlacement;
  materialLibrary: MaterialSpec[];
  negativePrompts: string[];
  aspectRatios: { width: number; height: number; name: string }[];
}

export interface Brand {
  id: string;
  user_id: string;
  name: string;
  description: string;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface BrandStyle {
  id: string;
  brand_id: string;
  version: number;
  style_json: BrandStyleJSON;
  is_active: boolean;
  created_at: string;
  created_by: string;
}

export interface UserProfile {
  id: string;
  full_name: string;
  avatar_url: string | null;
  role: string;
  created_at: string;
  updated_at: string;
}

export interface TrendingItem {
  name: string;
  confidence: number;
  description: string;
  hex?: string;
  sources?: string[];
}

export interface Celebrity {
  name: string;
  profession: string;
  signature_style: string;
  influence_score?: number;
}

export interface TrendInsightsJSON {
  colors: TrendingItem[];
  silhouettes: TrendingItem[];
  materials: TrendingItem[];
  themes: TrendingItem[];
  celebrities?: Celebrity[];
  summary: string;
}

export interface TrendInsight {
  id: string;
  collection_id: string;
  region: string;
  season: string;
  demographic: string;
  insights_json: TrendInsightsJSON;
  source: 'gemini' | 'manual';
  created_at: string;
  expires_at: string;
}

export interface CollectionPlanJSON {
  apparelCount: number;
  footwearCount: number;
  accessoriesCount: number;
  heroItems: string[];
  colorStory: string;
  trendAlignment: string;
}

export interface Collection {
  id: string;
  brand_id: string;
  name: string;
  season: string;
  region: string;
  target_demographic: string;
  status: 'draft' | 'generating' | 'validating' | 'complete';
  collection_plan_json: CollectionPlanJSON;
  trend_insights_json?: TrendInsightsJSON | null;
  created_at: string;
  updated_at: string;
}

export interface DesignSpecJSON {
  silhouette: string;
  fit: string;
  colors: { name: string; hex: string; usage: string }[];
  materials: { name: string; placement: string }[];
  details: string[];
  inspiration: string;
}

export interface FIBOObject {
  name: string;
  description: string;
  attributes: Record<string, string>;
  position?: string;
  relationships?: string[];
}

export interface FIBOPromptJSON {
  description: string;
  objects: FIBOObject[];
  background: string;
  lighting: string;
  aesthetics: string;
  composition: string;
  color_scheme: string;
  mood_atmosphere: string;
  depth_of_field: string;
  focus: string;
  camera_angle: string;
  focal_length: string;
  aspect_ratio: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9';
  negative_prompt?: string;
  seed?: number;
  num_inference_steps?: number;
  guidance_scale?: number;
}

export interface CollectionItem {
  id: string;
  collection_id: string;
  sku: string;
  name: string;
  category: 'apparel' | 'footwear' | 'accessories';
  subcategory: string;
  design_story: string;
  target_persona: string;
  price_tier: 'entry' | 'mid' | 'premium' | 'luxury';
  design_spec_json: DesignSpecJSON;
  fibo_prompt_json: FIBOPromptJSON;
  brand_compliance_score: number;
  status: 'planned' | 'designing' | 'generating' | 'validating' | 'complete' | 'failed';
  image_url?: string | null;
  video_url?: string | null;
  techpack_json?: Record<string, any> | null;
  techpack_generated?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Violation {
  id: string;
  rule: string;
  category: 'color' | 'camera' | 'lighting' | 'logo' | 'material' | 'prompt';
  severity: 'critical' | 'warning' | 'suggestion';
  detected: string | number;
  allowed: string | number | { min: number; max: number };
  message: string;
  autoFixAvailable: boolean;
  fixedValue?: string | number;
}

export interface AutoFix {
  violationId: string;
  field: string;
  originalValue: string | number;
  fixedValue: string | number;
  appliedAt: string;
}

export interface Validation {
  id: string;
  collection_item_id: string;
  compliance_score: number;
  violations: Violation[];
  auto_fixes_applied: AutoFix[];
  original_prompt_json: FIBOPromptJSON;
  fixed_prompt_json: FIBOPromptJSON;
  validated_at: string;
}

export interface GeneratedImage {
  id: string;
  collection_item_id: string;
  image_url: string;
  image_type: 'product' | 'lifestyle' | 'detail' | 'sketch';
  view_angle: 'front' | 'back' | 'side' | 'three-quarter' | 'top';
  generation_params_json: FIBOPromptJSON;
  is_primary: boolean;
  created_at: string;
}

export interface TechPackDimensions {
  [key: string]: { value: number; unit: string };
}

export interface TechPackMaterial {
  component: string;
  material: string;
  specification: string;
  color: string;
  supplier?: string;
}

export interface TechPackJSON {
  dimensions: TechPackDimensions;
  materials: TechPackMaterial[];
  construction: string[];
  colorSpecs: { name: string; pantone: string; hex: string }[];
  branding: { type: string; placement: string; size: string }[];
  packaging: { type: string; requirements: string[] };
  suppliers: { name: string; location: string; specialization: string }[];
}

export interface TechPack {
  id: string;
  collection_item_id: string;
  version: number;
  tech_pack_json: TechPackJSON;
  pdf_url: string | null;
  status: 'draft' | 'review' | 'approved';
  created_at: string;
  updated_at: string;
}

export interface GenerationJob {
  id: string;
  user_id: string;
  job_type: 'trend_analysis' | 'collection_design' | 'image_generation' | 'validation' | 'tech_pack';
  status: 'queued' | 'processing' | 'complete' | 'failed';
  input_json: Record<string, unknown>;
  output_json: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface LoginAudit {
  id: string;
  user_id: string;
  login_at: string;
  ip_address: string | null;
  user_agent: string | null;
  login_method: string;
  success: boolean;
}

export interface Database {
  public: {
    Tables: {
      user_profiles: {
        Row: UserProfile;
        Insert: Omit<UserProfile, 'created_at' | 'updated_at'>;
        Update: Partial<Omit<UserProfile, 'id'>>;
      };
      brands: {
        Row: Brand;
        Insert: Omit<Brand, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Brand, 'id'>>;
      };
      brand_styles: {
        Row: BrandStyle;
        Insert: Omit<BrandStyle, 'id' | 'created_at'>;
        Update: Partial<Omit<BrandStyle, 'id'>>;
      };
      collections: {
        Row: Collection;
        Insert: Omit<Collection, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Collection, 'id'>>;
      };
      collection_items: {
        Row: CollectionItem;
        Insert: Omit<CollectionItem, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<CollectionItem, 'id'>>;
      };
      trend_insights: {
        Row: TrendInsight;
        Insert: Omit<TrendInsight, 'id' | 'created_at'>;
        Update: Partial<Omit<TrendInsight, 'id'>>;
      };
      validations: {
        Row: Validation;
        Insert: Omit<Validation, 'id' | 'validated_at'>;
        Update: Partial<Omit<Validation, 'id'>>;
      };
      generated_images: {
        Row: GeneratedImage;
        Insert: Omit<GeneratedImage, 'id' | 'created_at'>;
        Update: Partial<Omit<GeneratedImage, 'id'>>;
      };
      tech_packs: {
        Row: TechPack;
        Insert: Omit<TechPack, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<TechPack, 'id'>>;
      };
      generation_jobs: {
        Row: GenerationJob;
        Insert: Omit<GenerationJob, 'id' | 'created_at'>;
        Update: Partial<Omit<GenerationJob, 'id'>>;
      };
      login_audit: {
        Row: LoginAudit;
        Insert: Omit<LoginAudit, 'id' | 'login_at'>;
        Update: never;
      };
    };
  };
}
