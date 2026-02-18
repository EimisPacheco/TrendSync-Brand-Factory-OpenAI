"use client";

import { useState, useEffect, useCallback } from "react";
import { validatePrompt, getBrandStyle, saveBrandStyle } from "@/lib/api";

/* ------------------------------------------------------------------ */
/* Icons (inline SVGs to match Vite lucide-react icons exactly)       */
/* ------------------------------------------------------------------ */

function ShieldIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  );
}

function SparklesIcon({ className = "" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" /><path d="M22 5h-4" />
    </svg>
  );
}

function PlayIcon({ size = 18 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

function RotateCcwIcon({ size = 18 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
    </svg>
  );
}

function ArrowRightIcon({ size = 16 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function AlertCircleIcon({ className = "" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}

function Wand2Icon({ size = 20 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" />
      <path d="m14 7 3 3" /><path d="M5 6v4" /><path d="M19 14v4" /><path d="M10 2v2" /><path d="M7 8H3" /><path d="M21 16h-4" /><path d="M11 3H9" />
    </svg>
  );
}

function CheckCircleIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" />
    </svg>
  );
}

function XCircleIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" />
    </svg>
  );
}

function AlertTriangleIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" />
    </svg>
  );
}

function InfoIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
    </svg>
  );
}

function ChevronDownIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ChevronUpIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

function ZapIcon({ size = 12 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </svg>
  );
}


/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

interface Violation {
  id: string;
  rule: string;
  category: string;
  severity: "critical" | "warning" | "suggestion";
  detected: unknown;
  allowed: unknown;
  message: string;
  autoFixAvailable?: boolean;
  fixedValue?: unknown;
}

interface ValidationResult {
  is_valid: boolean;
  compliance_score: number;
  violations: Violation[];
  auto_fixes_available: number;
  badge?: { label: string; color: string; bgColor: string };
}

interface BrandStyle {
  colorPalette: { id: string; name: string; hex: string; designation: string }[];
  cameraSettings: { fovMin: number; fovMax: number; fovDefault: number; angleMin: number; angleMax: number; angleDefault: number };
  lightingConfig: { colorTemperature: number; keyIntensity: number; fillIntensity: number; rimIntensity: number; allowHDR: boolean; shadowSoftness: number };
  negativePrompts: string[];
  materialLibrary: { id: string; name: string; category: string; description: string; seasons: string[] }[];
  aspectRatios: { width: number; height: number; name: string }[];
}

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_BRAND_STYLE: BrandStyle = {
  colorPalette: [
    { id: "1", name: "Forest Green", hex: "#2D5A27", designation: "primary" },
    { id: "2", name: "Sand Beige", hex: "#D4C4A8", designation: "secondary" },
    { id: "3", name: "Terracotta", hex: "#C75B39", designation: "accent" },
    { id: "4", name: "Charcoal", hex: "#36454F", designation: "neutral" },
  ],
  cameraSettings: { fovMin: 24, fovMax: 85, fovDefault: 50, angleMin: 0, angleMax: 90, angleDefault: 30 },
  lightingConfig: { keyIntensity: 80, fillIntensity: 40, rimIntensity: 30, colorTemperature: 5500, allowHDR: true, shadowSoftness: 50 },
  negativePrompts: ["cheap", "tacky", "gaudy", "generic"],
  materialLibrary: [
    { id: "1", name: "Organic Cotton", category: "sustainable", description: "GOTS certified", seasons: ["spring", "summer", "fall"] },
    { id: "2", name: "Recycled Polyester", category: "sustainable", description: "From ocean plastics", seasons: ["spring", "summer", "fall", "winter"] },
  ],
  aspectRatios: [{ width: 4, height: 5, name: "Portrait" }],
};

const DEMO_PROMPT = {
  description: "A fashion product photograph showcasing an oversized linen shirt with natural texture, displayed on an invisible mannequin against a clean backdrop",
  objects: [
    {
      name: "Oversized Linen Shirt",
      description: "Relaxed fit shirt with dropped shoulders, natural linen texture visible, minimalist design with no visible branding",
      attributes: { material: "Premium linen", fit: "Oversized relaxed", style: "Minimalist contemporary" },
      position: "center frame",
      relationships: ["worn on invisible mannequin"],
    },
  ],
  background: "Clean white studio backdrop with subtle gradient, professional product photography setup",
  lighting: "Cool studio lighting with soft diffused key light, minimal shadows",
  aesthetics: "High-end fashion editorial, clean minimalist product photography",
  composition: "Centered subject with balanced negative space, rule of thirds applied",
  color_scheme: "Primary color #8B4513 (saddle brown) with accent #1E90FF (dodger blue) details",
  mood_atmosphere: "Professional, clean, aspirational fashion aesthetic",
  depth_of_field: "Shallow depth of field with subject in sharp focus",
  focus: "Sharp focus on garment texture and construction details",
  camera_angle: "55 degree high angle shot",
  focal_length: "24mm wide angle",
  aspect_ratio: "4:5",
  negative_prompt: "blurry",
  seed: 42,
  num_inference_steps: 50,
  guidance_scale: 5,
};


/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function getBadge(score: number) {
  if (score >= 90) return { label: "Excellent", color: "text-emerald-400" };
  if (score >= 75) return { label: "Good", color: "text-green-400" };
  if (score >= 60) return { label: "Fair", color: "text-amber-400" };
  if (score >= 40) return { label: "Poor", color: "text-orange-400" };
  return { label: "Critical", color: "text-red-400" };
}

function getSeverityStyles(severity: string) {
  switch (severity) {
    case "critical":
      return {
        cardBg: "bg-gradient-to-br from-rose-50/80 via-pink-50/60 to-rose-50/80",
        iconBg: "bg-rose-100/50",
        Icon: XCircleIcon,
        iconColor: "text-rose-400",
        badgeBg: "bg-rose-400",
        badgeText: "text-white",
        borderAccent: "border-l-rose-300",
      };
    case "warning":
      return {
        cardBg: "bg-gradient-to-br from-amber-50/80 via-yellow-50/60 to-amber-50/80",
        iconBg: "bg-amber-100/50",
        Icon: AlertTriangleIcon,
        iconColor: "text-amber-400",
        badgeBg: "bg-amber-400",
        badgeText: "text-white",
        borderAccent: "border-l-amber-300",
      };
    default:
      return {
        cardBg: "bg-gradient-to-r from-sky-50 to-blue-50",
        iconBg: "bg-sky-100",
        Icon: InfoIcon,
        iconColor: "text-sky-500",
        badgeBg: "bg-sky-500",
        badgeText: "text-white",
        borderAccent: "border-l-sky-400",
      };
  }
}

function applyFixesLocally(prompt: Record<string, unknown>, violations: Violation[]): Record<string, unknown> {
  const fixed: Record<string, unknown> = JSON.parse(JSON.stringify(prompt));

  for (const v of violations) {
    if (!v.autoFixAvailable || v.fixedValue === undefined) continue;

    switch (v.category) {
      case "color":
        if (typeof v.fixedValue === "string" && typeof v.detected === "string" && typeof fixed.color_scheme === "string") {
          fixed.color_scheme = (fixed.color_scheme as string).replace(v.detected, v.fixedValue);
        }
        break;
      case "camera":
        if (v.rule.includes("Focal length") && typeof v.fixedValue === "string") {
          fixed.focal_length = v.fixedValue;
        } else if (v.rule.includes("angle") && typeof v.fixedValue === "string") {
          fixed.camera_angle = v.fixedValue;
        }
        break;
      case "lighting":
        if (typeof v.fixedValue === "string") {
          fixed.lighting = v.fixedValue;
        }
        break;
      case "prompt":
        if (v.rule.includes("Description") && typeof v.fixedValue === "string") {
          fixed.description = v.fixedValue;
        } else if (v.rule.includes("Negative prompt") && typeof v.fixedValue === "string") {
          const existing = (fixed.negative_prompt as string) || "";
          if (!existing.toLowerCase().includes((v.fixedValue as string).toLowerCase())) {
            fixed.negative_prompt = existing ? `${existing}, ${v.fixedValue}` : v.fixedValue;
          }
        }
        break;
    }
  }
  return fixed;
}


/* ------------------------------------------------------------------ */
/* Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function BrandGuardianPage() {
  const [prompt, setPrompt] = useState<Record<string, unknown>>(DEMO_PROMPT);
  const [brandStyle, setBrandStyle] = useState<BrandStyle>(DEFAULT_BRAND_STYLE);
  const [brandName, setBrandName] = useState("Demo Brand");

  const [result, setResult] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [showComparison, setShowComparison] = useState(false);
  const [fixedPrompt, setFixedPrompt] = useState<Record<string, unknown> | null>(null);

  // Try to load brand style from backend
  useEffect(() => {
    getBrandStyle("default")
      .then((res) => {
        if (res.style) {
          setBrandStyle(res.style as unknown as BrandStyle);
          setBrandName("Configured Brand");
        }
      })
      .catch(() => { /* keep default */ });
  }, []);

  const runValidation = useCallback(async () => {
    setLoading(true);
    setShowComparison(false);
    setFixedPrompt(null);
    setExpanded([]);
    try {
      // First save brand style so backend knows about it
      await saveBrandStyle("default", brandStyle as unknown as Record<string, unknown>).catch(() => {});
      const res = await validatePrompt({ prompt: prompt as Record<string, unknown>, brand_id: "default" });
      setResult(res as ValidationResult);
    } catch (e) {
      console.error("Validation failed:", e);
    } finally {
      setLoading(false);
    }
  }, [prompt, brandStyle]);

  // Auto-run validation on mount
  useEffect(() => {
    runValidation();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApplyFixes = async () => {
    if (!result) return;
    setApplying(true);

    // Apply fixes locally on the prompt
    const fixed = applyFixesLocally(prompt, result.violations);
    setFixedPrompt(fixed);
    setShowComparison(true);

    // Re-validate the fixed prompt against backend
    try {
      await saveBrandStyle("default", brandStyle as unknown as Record<string, unknown>).catch(() => {});
      const newResult = await validatePrompt({ prompt: fixed, brand_id: "default" });
      setResult(newResult as ValidationResult);
      setPrompt(fixed);
    } catch (e) {
      console.error("Re-validation failed:", e);
    } finally {
      setApplying(false);
    }
  };

  const reset = () => {
    setPrompt(DEMO_PROMPT);
    setShowComparison(false);
    setFixedPrompt(null);
    setResult(null);
    setExpanded([]);
    // Re-run validation with original prompt
    setTimeout(() => {
      runValidation();
    }, 100);
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const violations = result?.violations || [];
  const score = result?.compliance_score || 0;
  const badge = getBadge(score);
  const criticalCount = violations.filter((v) => v.severity === "critical").length;
  const warningCount = violations.filter((v) => v.severity === "warning").length;
  const suggestionCount = violations.filter((v) => v.severity === "suggestion").length;

  const displayPrompt = showComparison && fixedPrompt ? fixedPrompt : prompt;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="neumorphic-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-3" style={{ color: "var(--pastel-navy)" }}>
              <div className="p-2 circular-icon">
                <SparklesIcon className="text-emerald-500" />
              </div>
              Brand Guardian Demo
            </h2>
            <p className="mt-1" style={{ color: "var(--pastel-text-light)" }}>
              Watch real-time validation catch off-brand elements and auto-correct them using official FIBO schema
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={reset} className="px-4 py-2 btn-soft flex items-center gap-2">
              <RotateCcwIcon size={18} />
              Reset
            </button>
            <button onClick={runValidation} disabled={loading} className="px-6 py-2 btn-navy flex items-center gap-2 disabled:opacity-50">
              <PlayIcon size={18} />
              Run Validation
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="neumorphic-inset p-3 rounded-xl">
            <p style={{ color: "var(--pastel-muted)" }} className="mb-1">Active Brand</p>
            <p className="font-medium" style={{ color: "var(--pastel-navy)" }}>{brandName}</p>
          </div>
          <div className="neumorphic-inset p-3 rounded-xl">
            <p style={{ color: "var(--pastel-muted)" }} className="mb-1">Demo Product</p>
            <p className="font-medium" style={{ color: "var(--pastel-navy)" }}>Oversized Linen Shirt</p>
          </div>
        </div>
      </div>

      {/* Main 2-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: FIBO JSON */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold" style={{ color: "var(--pastel-navy)" }}>FIBO Structured Prompt JSON</h3>
          <div className="neumorphic-card p-4">
            <pre className="text-xs overflow-auto max-h-[500px]" style={{ color: "var(--pastel-text)" }}>
              {JSON.stringify(displayPrompt, null, 2)}
            </pre>
          </div>
          {showComparison && fixedPrompt && (
            <div className="flex items-center gap-2 text-emerald-600 text-sm">
              <ArrowRightIcon size={16} />
              Showing corrected prompt after auto-fixes
            </div>
          )}
        </div>

        {/* Right: Validation Results */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold" style={{ color: "var(--pastel-navy)" }}>Validation Results</h3>

          {loading ? (
            <div className="neumorphic-card p-12 flex items-center justify-center">
              <div className="text-center">
                <div className="w-12 h-12 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin mx-auto mb-4" />
                <p style={{ color: "var(--pastel-text-light)" }}>Running validation...</p>
              </div>
            </div>
          ) : result ? (
            <div className="neumorphic-card overflow-hidden">
              {/* Score header */}
              <div className="p-6 border-b" style={{ borderColor: "rgba(var(--pastel-muted-rgb, 128, 128, 128), 0.2)" }}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 circular-icon flex items-center justify-center">
                      <ShieldIcon size={24} className="text-emerald-500" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold" style={{ color: "var(--pastel-navy)" }}>Brand Guardian</h3>
                      <p className="text-sm" style={{ color: "var(--pastel-muted)" }}>Real-time compliance validation</p>
                    </div>
                  </div>
                  <div className="px-4 py-2 neumorphic-sm rounded-xl text-right">
                    <div className="text-3xl font-bold" style={{ color: "var(--pastel-navy)" }}>{Math.round(score)}%</div>
                    <div className={`text-sm font-medium ${badge.color}`}>{badge.label}</div>
                  </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="neumorphic-inset rounded-xl p-3 text-center">
                    <div className="text-2xl font-bold text-rose-400">{criticalCount}</div>
                    <div className="text-xs" style={{ color: "var(--pastel-muted)" }}>Critical</div>
                  </div>
                  <div className="neumorphic-inset rounded-xl p-3 text-center">
                    <div className="text-2xl font-bold text-amber-400">{warningCount}</div>
                    <div className="text-xs" style={{ color: "var(--pastel-muted)" }}>Warnings</div>
                  </div>
                  <div className="neumorphic-inset rounded-xl p-3 text-center">
                    <div className="text-2xl font-bold text-sky-500">{suggestionCount}</div>
                    <div className="text-xs" style={{ color: "var(--pastel-muted)" }}>Suggestions</div>
                  </div>
                </div>

                {/* Auto-Fix button */}
                {(result.auto_fixes_available ?? 0) > 0 && (
                  <button
                    onClick={handleApplyFixes}
                    disabled={applying}
                    className="w-full py-3 px-4 btn-navy flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {applying ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Applying Fixes...
                      </>
                    ) : (
                      <>
                        <Wand2Icon size={20} />
                        Auto-Fix All ({result.auto_fixes_available} issues)
                      </>
                    )}
                  </button>
                )}

                {/* All passed state */}
                {violations.length === 0 && (
                  <div className="flex items-center gap-3 p-4 neumorphic-inset rounded-xl">
                    <CheckCircleIcon size={24} className="text-emerald-500" />
                    <div>
                      <p className="font-medium text-emerald-600">All checks passed!</p>
                      <p className="text-sm" style={{ color: "var(--pastel-muted)" }}>This prompt is fully compliant with brand guidelines</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Violations list */}
              {violations.length > 0 && (
                <div className="p-4 space-y-3">
                  {violations.map((violation) => {
                    const styles = getSeverityStyles(violation.severity);
                    const SeverityIcon = styles.Icon;
                    const isExpanded = expanded.includes(violation.id);

                    return (
                      <div
                        key={violation.id}
                        className={`rounded-xl overflow-hidden shadow-sm border-l-4 ${styles.borderAccent} ${styles.cardBg}`}
                      >
                        <button
                          onClick={() => toggleExpand(violation.id)}
                          className="w-full p-4 text-left flex items-start gap-3 hover:bg-white/30 transition-colors"
                        >
                          <div className={`p-2 rounded-lg ${styles.iconBg} flex-shrink-0`}>
                            <SeverityIcon size={18} className={styles.iconColor} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${styles.badgeBg} ${styles.badgeText}`}>
                                {violation.severity.toUpperCase()}
                              </span>
                              <span className="text-xs bg-white/50 px-2 py-0.5 rounded-full" style={{ color: "var(--pastel-muted)" }}>
                                {violation.category}
                              </span>
                            </div>
                            <p className="text-sm font-medium leading-relaxed" style={{ color: "var(--pastel-navy)" }}>
                              {violation.message}
                            </p>
                          </div>
                          <div className={`p-1.5 rounded-lg ${isExpanded ? "bg-white/50" : ""} transition-colors`}>
                            {isExpanded ? (
                              <ChevronUpIcon size={18} className="text-gray-400" />
                            ) : (
                              <ChevronDownIcon size={18} className="text-gray-400" />
                            )}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-4">
                            <div className="bg-white/60 rounded-xl p-4 space-y-3 shadow-inner">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--pastel-muted)" }}>
                                  Detected Value
                                </span>
                                <code className="bg-rose-100/60 text-rose-600 px-3 py-1 rounded-lg text-xs font-mono">
                                  {typeof violation.detected === "object" ? JSON.stringify(violation.detected) : String(violation.detected)}
                                </code>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--pastel-muted)" }}>
                                  Allowed Range
                                </span>
                                <code className="bg-emerald-100/60 text-emerald-600 px-3 py-1 rounded-lg text-xs font-mono">
                                  {typeof violation.allowed === "object" && violation.allowed !== null
                                    ? `${(violation.allowed as { min: number; max: number }).min} - ${(violation.allowed as { min: number; max: number }).max}`
                                    : String(violation.allowed)}
                                </code>
                              </div>
                              {violation.autoFixAvailable && violation.fixedValue !== undefined && (
                                <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: "rgba(var(--pastel-muted-rgb, 128, 128, 128), 0.2)" }}>
                                  <span className="text-xs font-medium uppercase tracking-wide flex items-center gap-1" style={{ color: "var(--pastel-accent, #5B9BD5)" }}>
                                    <ZapIcon size={12} />
                                    Auto-fix Available
                                  </span>
                                  <code className="bg-sky-100 text-sky-700 px-3 py-1 rounded-lg text-xs font-mono">
                                    {String(violation.fixedValue)}
                                  </code>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Brand Style Rules */}
      <div className="neumorphic-card p-6">
        <h3 className="text-lg font-semibold mb-4" style={{ color: "var(--pastel-navy)" }}>Current Brand Style Rules</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="neumorphic-inset p-3 rounded-xl">
            <p className="text-xs mb-2" style={{ color: "var(--pastel-muted)" }}>Color Palette</p>
            <div className="flex gap-1 flex-wrap">
              {brandStyle.colorPalette.length > 0 ? (
                brandStyle.colorPalette.slice(0, 6).map((c) => (
                  <div
                    key={c.id}
                    className="w-8 h-8 rounded-lg shadow-sm"
                    style={{ backgroundColor: c.hex }}
                    title={`${c.name} (${c.designation})`}
                  />
                ))
              ) : (
                <p className="text-xs" style={{ color: "var(--pastel-muted)" }}>No colors defined</p>
              )}
            </div>
          </div>
          <div className="neumorphic-inset p-3 rounded-xl">
            <p className="text-xs mb-2" style={{ color: "var(--pastel-muted)" }}>FOV Range</p>
            <p className="font-medium" style={{ color: "var(--pastel-navy)" }}>
              {brandStyle.cameraSettings.fovMin}° - {brandStyle.cameraSettings.fovMax}°
            </p>
          </div>
          <div className="neumorphic-inset p-3 rounded-xl">
            <p className="text-xs mb-2" style={{ color: "var(--pastel-muted)" }}>Angle Range</p>
            <p className="font-medium" style={{ color: "var(--pastel-navy)" }}>
              {brandStyle.cameraSettings.angleMin}° - {brandStyle.cameraSettings.angleMax}°
            </p>
          </div>
          <div className="neumorphic-inset p-3 rounded-xl">
            <p className="text-xs mb-2" style={{ color: "var(--pastel-muted)" }}>Color Temp</p>
            <p className="font-medium" style={{ color: "var(--pastel-navy)" }}>{brandStyle.lightingConfig.colorTemperature}K</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
          <div className="neumorphic-inset p-3 rounded-xl">
            <p className="text-xs mb-2" style={{ color: "var(--pastel-muted)" }}>Negative Prompts</p>
            <p className="text-xs" style={{ color: "var(--pastel-navy)" }}>
              {brandStyle.negativePrompts.length} terms blocked
            </p>
          </div>
          <div className="neumorphic-inset p-3 rounded-xl">
            <p className="text-xs mb-2" style={{ color: "var(--pastel-muted)" }}>Materials</p>
            <p className="text-xs" style={{ color: "var(--pastel-navy)" }}>
              {brandStyle.materialLibrary.length} materials defined
            </p>
          </div>
          <div className="neumorphic-inset p-3 rounded-xl">
            <p className="text-xs mb-2" style={{ color: "var(--pastel-muted)" }}>Lighting Style</p>
            <p className="text-xs" style={{ color: "var(--pastel-navy)" }}>
              {brandStyle.lightingConfig.colorTemperature < 4500 ? "Warm" : brandStyle.lightingConfig.colorTemperature > 5500 ? "Cool" : "Neutral"}
            </p>
          </div>
        </div>
      </div>

      {/* Footer note */}
      <div className="neumorphic-inset p-4 rounded-xl">
        <p className="text-xs" style={{ color: "var(--pastel-muted)" }}>
          {brandName === "Demo Brand" ? (
            <>
              <AlertCircleIcon className="inline w-3 h-3 mr-1" />
              No brand configured. Using default brand style. Create a brand in the Brand Style tab to see your actual brand rules applied here.
            </>
          ) : (
            <>This demo validates FIBO prompts against your brand&apos;s style rules defined in the Brand Style tab.</>
          )}
        </p>
        <p className="text-xs mt-2" style={{ color: "var(--pastel-muted)" }}>
          Uses official FIBO JSON schema with fields: description, objects, background, lighting, aesthetics, composition, color_scheme, mood_atmosphere, depth_of_field, focus, camera_angle, focal_length, aspect_ratio, and negative_prompt.
        </p>
      </div>
    </div>
  );
}
