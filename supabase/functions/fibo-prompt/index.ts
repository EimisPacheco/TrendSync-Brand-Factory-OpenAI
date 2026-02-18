import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BRIA_API_BASE = "https://engine.prod.bria-api.com";

interface ProductSpec {
  name: string;
  category: "apparel" | "footwear" | "accessories";
  subcategory: string;
  description: string;
  colors: { name: string; hex: string }[];
  materials: string[];
  style: string;
  season: string;
}

interface BrandStyleRules {
  colorPalette: { hex: string; name: string }[];
  cameraSettings: {
    fovMin: number;
    fovMax: number;
    fovDefault: number;
    angleMin: number;
    angleMax: number;
    angleDefault: number;
  };
  lightingConfig: {
    keyIntensity: number;
    colorTemperature: number;
  };
  negativePrompts: string[];
}

interface FIBOStructuredPrompt {
  description: string;
  objects: {
    name: string;
    description: string;
    attributes: Record<string, string>;
    position?: string;
    relationships?: string[];
  }[];
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
  aspect_ratio: string;
  negative_prompt?: string;
  seed?: number;
  num_inference_steps?: number;
  guidance_scale?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.split("/").pop();

    if (path === "generate-prompt") {
      return await handleGeneratePrompt(req);
    } else if (path === "generate-image") {
      return await handleGenerateImage(req);
    } else if (path === "check-status") {
      return await handleCheckStatus(req);
    } else {
      return await handleGeneratePrompt(req);
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function handleGeneratePrompt(req: Request): Promise<Response> {
  const { product, brandStyle, viewType = "hero" }: {
    product: ProductSpec;
    brandStyle: BrandStyleRules;
    viewType?: "hero" | "detail" | "lifestyle" | "back";
  } = await req.json();

  if (!product || !brandStyle) {
    return new Response(
      JSON.stringify({ error: "Product and brandStyle are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const fiboPrompt = generateFIBOPrompt(product, brandStyle, viewType);

  return new Response(
    JSON.stringify({ prompt: fiboPrompt, viewType }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleGenerateImage(req: Request): Promise<Response> {
  const BRIA_API_KEY = Deno.env.get("BRIA_API_KEY");

  if (!BRIA_API_KEY) {
    return new Response(
      JSON.stringify({ error: "BRIA_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { prompt, structuredPrompt, aspectRatio = "4:5", seed, sync = false }: {
    prompt?: string;
    structuredPrompt?: FIBOStructuredPrompt;
    aspectRatio?: string;
    seed?: number;
    sync?: boolean;
  } = await req.json();

  if (!prompt && !structuredPrompt) {
    return new Response(
      JSON.stringify({ error: "Either prompt or structuredPrompt is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const textPrompt = structuredPrompt
    ? buildTextPromptFromStructured(structuredPrompt)
    : prompt;

  const negativePrompt = structuredPrompt?.negative_prompt || "blurry, low quality, distorted, watermark";

  const requestBody: Record<string, unknown> = {
    prompt: textPrompt,
    model_version: "FIBO",
    negative_prompt: negativePrompt,
    aspect_ratio: aspectRatio,
    steps_num: structuredPrompt?.num_inference_steps || 50,
    guidance_scale: structuredPrompt?.guidance_scale || 5,
    sync: sync,
  };

  if (seed !== undefined) {
    requestBody.seed = seed;
  } else if (structuredPrompt?.seed !== undefined) {
    requestBody.seed = structuredPrompt.seed;
  }

  const response = await fetch(`${BRIA_API_BASE}/v2/image/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api_token": BRIA_API_KEY,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return new Response(
      JSON.stringify({ error: `Bria API error: ${response.status}`, details: errorText }),
      { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const result = await response.json();

  return new Response(
    JSON.stringify(result),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleCheckStatus(req: Request): Promise<Response> {
  const BRIA_API_KEY = Deno.env.get("BRIA_API_KEY");

  if (!BRIA_API_KEY) {
    return new Response(
      JSON.stringify({ error: "BRIA_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { statusUrl }: { statusUrl: string } = await req.json();

  if (!statusUrl) {
    return new Response(
      JSON.stringify({ error: "statusUrl is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const response = await fetch(statusUrl, {
    method: "GET",
    headers: {
      "api_token": BRIA_API_KEY,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    return new Response(
      JSON.stringify({ error: `Status check error: ${response.status}`, details: errorText }),
      { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const result = await response.json();

  return new Response(
    JSON.stringify(result),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

function buildTextPromptFromStructured(sp: FIBOStructuredPrompt): string {
  const parts: string[] = [];

  parts.push(sp.description);

  if (sp.objects && sp.objects.length > 0) {
    const objectDescriptions = sp.objects.map(obj => {
      let desc = obj.description;
      if (obj.attributes) {
        const attrs = Object.entries(obj.attributes).map(([k, v]) => `${k}: ${v}`).join(", ");
        desc += ` (${attrs})`;
      }
      if (obj.position) desc += `, positioned ${obj.position}`;
      return desc;
    });
    parts.push(`Objects: ${objectDescriptions.join("; ")}`);
  }

  parts.push(`Background: ${sp.background}`);
  parts.push(`Lighting: ${sp.lighting}`);
  parts.push(`Style: ${sp.aesthetics}`);
  parts.push(`Composition: ${sp.composition}`);
  parts.push(`Colors: ${sp.color_scheme}`);
  parts.push(`Mood: ${sp.mood_atmosphere}`);
  parts.push(`DOF: ${sp.depth_of_field}`);
  parts.push(`Focus: ${sp.focus}`);
  parts.push(`Camera: ${sp.camera_angle}, ${sp.focal_length}`);

  return parts.join(". ");
}

function generateFIBOPrompt(
  product: ProductSpec,
  brandStyle: BrandStyleRules,
  viewType: string
): FIBOStructuredPrompt {
  const getBackground = () => {
    switch (viewType) {
      case "lifestyle":
        return product.season.toLowerCase().includes("summer")
          ? "Outdoor setting with natural daylight, urban street or nature background with soft bokeh"
          : "Indoor studio with lifestyle props, warm ambient lighting, soft shadows";
      case "detail":
        return "Clean neutral background, macro photography setup, focus on texture and construction";
      case "back":
        return "Clean white studio backdrop, even lighting, minimal shadows";
      default:
        return "Professional studio setting, clean white backdrop with subtle gradient, controlled lighting environment";
    }
  };

  const getLighting = () => {
    const temp = brandStyle.lightingConfig.colorTemperature;
    const warmth = temp < 4500 ? "warm" : temp > 5500 ? "cool" : "neutral";
    switch (viewType) {
      case "lifestyle":
        return `Natural ${warmth} ambient lighting, soft diffused shadows, ${temp}K color temperature`;
      case "detail":
        return `Soft diffused ${warmth} lighting, even illumination for texture visibility, ${temp}K`;
      default:
        return `Three-point studio lighting, ${warmth} key light at ${brandStyle.lightingConfig.keyIntensity}% intensity, ${temp}K color temperature`;
    }
  };

  const getCameraSettings = () => {
    const { cameraSettings } = brandStyle;
    switch (viewType) {
      case "detail":
        return {
          angle: `${Math.min(cameraSettings.angleDefault + 10, cameraSettings.angleMax)} degree close-up angle`,
          focal: "85mm macro lens",
        };
      case "lifestyle":
        return {
          angle: `${cameraSettings.angleDefault} degree natural eye-level`,
          focal: "35mm wide angle",
        };
      case "back":
        return {
          angle: `${cameraSettings.angleDefault} degree straight-on back view`,
          focal: `${Math.round(36 / (2 * Math.tan((cameraSettings.fovDefault * Math.PI / 180) / 2)))}mm`,
        };
      default:
        return {
          angle: `${cameraSettings.angleDefault} degree three-quarter hero shot`,
          focal: `${Math.round(36 / (2 * Math.tan((cameraSettings.fovDefault * Math.PI / 180) / 2)))}mm`,
        };
    }
  };

  const buildColorScheme = () => {
    if (product.colors.length === 0) {
      const primary = brandStyle.colorPalette[0];
      return primary ? `Primary ${primary.name} (${primary.hex})` : "Neutral tones";
    }
    return product.colors.map((c, i) => {
      const role = i === 0 ? "Primary" : i === 1 ? "Secondary" : "Accent";
      return `${role} ${c.name} (${c.hex})`;
    }).join(", ");
  };

  const buildNegativePrompt = () => {
    const baseNegatives = ["blurry", "low quality", "distorted", "watermark", "text overlay", "duplicate", "cropped"];
    return [...new Set([...baseNegatives, ...brandStyle.negativePrompts])].join(", ");
  };

  const getAspectRatio = (): FIBOStructuredPrompt["aspect_ratio"] => {
    switch (product.category) {
      case "footwear": return "4:3";
      case "accessories": return "1:1";
      default: return "4:5";
    }
  };

  const camera = getCameraSettings();

  return {
    description: `Professional ${product.category} product photograph of ${product.name}, ${product.description}, ${product.style} style for ${product.season} collection`,
    objects: [
      {
        name: product.name,
        description: `${product.description}, ${product.materials.join(" and ")} construction`,
        attributes: {
          category: product.category,
          subcategory: product.subcategory,
          materials: product.materials.join(", "),
          style: product.style,
          season: product.season,
        },
        position: "center frame",
        relationships: viewType === "lifestyle" ? ["styled with complementary props"] : ["isolated on backdrop"],
      },
    ],
    background: getBackground(),
    lighting: getLighting(),
    aesthetics: `High-end ${product.category} photography, fashion editorial quality, ${product.season} collection aesthetic`,
    composition: viewType === "detail"
      ? "Tight framing on construction details, rule of thirds"
      : "Centered subject with balanced negative space, professional product framing",
    color_scheme: buildColorScheme(),
    mood_atmosphere: `Professional, ${product.style.toLowerCase()}, aspirational fashion aesthetic`,
    depth_of_field: viewType === "detail"
      ? "Very shallow, selective focus on key details"
      : "Shallow depth of field with full subject in focus",
    focus: viewType === "detail"
      ? "Sharp focus on material texture and construction"
      : "Sharp focus across entire product",
    camera_angle: camera.angle,
    focal_length: camera.focal,
    aspect_ratio: getAspectRatio(),
    negative_prompt: buildNegativePrompt(),
    seed: 42,
    num_inference_steps: 50,
    guidance_scale: 5,
  };
}
