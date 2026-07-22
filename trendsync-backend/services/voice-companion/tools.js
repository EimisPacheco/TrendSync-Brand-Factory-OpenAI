/**
 * Tool definitions for the TrendSync Voice Design Companion (Node.js port).
 *
 * Re-implements the 7 design tools (shared/design_tools.py) and 3 voice-only
 * tools (generate_ad_video, navigate_to_page, start_collection_generation)
 * as Zod-typed `tool({...})` objects.
 *
 * Each tool's `execute` calls the Python main backend over HTTP. The voice
 * service does NOT re-implement OpenAI/Fal/Brand-Guardian logic — it routes
 * to the existing Python endpoints, keeping a single source of truth for
 * AI logic (Agent A scope: only the voice surface is replaced).
 */

const { z } = require('zod');
const axios = require('axios');

const MAIN_BACKEND_URL = (process.env.MAIN_BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');
const HTTP_TIMEOUT_MS = 120_000;

const http = axios.create({
  baseURL: MAIN_BACKEND_URL,
  timeout: HTTP_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
  maxContentLength: 100 * 1024 * 1024,
  maxBodyLength: 100 * 1024 * 1024,
});

// Helper: SDK-style tool() factory
function tool(config) {
  return config;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function getProductContext(ctx) {
  return {
    name: ctx.product_name || '',
    category: ctx.product_category || '',
    subcategory: ctx.product_subcategory || '',
    colors: ctx.product_colors || [],
    materials: ctx.product_materials || [],
  };
}

function summarizeContext(ctx) {
  const p = getProductContext(ctx);
  return (
    `Product: ${p.name || 'Unknown'} | ` +
    `Category: ${p.category}${p.subcategory ? ' / ' + p.subcategory : ''} | ` +
    `Colors: ${JSON.stringify(p.colors)} | Materials: ${JSON.stringify(p.materials)}`
  );
}

function brandColorsSummary(brandStyle) {
  const palette = brandStyle?.colorPalette || [];
  if (!palette.length) return '';
  return palette
    .slice(0, 5)
    .map((c) => `${c.name} (${c.hex})`)
    .join(', ');
}

// --------------------------------------------------------------------------
// 1. analyze_product_image — purely contextual; the LLM provides the visual
//    analysis itself using the product image attached to the session.
// --------------------------------------------------------------------------

const analyzeProductImageTool = tool({
  name: 'analyze_product_image',
  description:
    'Analyze the current product image visually and give specific design feedback. ' +
    'Call this when the user asks for opinions, suggestions, or creative direction about the ' +
    'product they are currently viewing. The tool returns the product context (name, category, ' +
    'colors, materials, brand palette) for the LLM to combine with what it sees in the attached image.',
  parameters: z.object({
    question: z.string().describe('What the user is asking about the design'),
  }),
  async execute({ question }, ctx) {
    const ctxSummary = summarizeContext(ctx);
    const brandColors = brandColorsSummary(ctx.brand_style);
    const hasImage = Boolean(ctx.image_base64);
    return {
      action: 'design_advice',
      status: 'success',
      has_image: hasImage,
      product_context: ctxSummary,
      brand_colors: brandColors,
      question,
      message:
        `Product context: ${ctxSummary}. ` +
        (brandColors ? `Brand palette: ${brandColors}. ` : '') +
        `Image attached: ${hasImage ? 'yes' : 'no'}. Now give your visual analysis based on what you see in the image.`,
    };
  },
});

// --------------------------------------------------------------------------
// 2. edit_product_image — POST /edit-image on the Python main backend.
// --------------------------------------------------------------------------

const editProductImageTool = tool({
  name: 'edit_product_image',
  description:
    'Edit the current product image with a specific change. Call this when the user wants to ' +
    'modify the existing image. Examples: "Make the collar wider", "Change the color to navy blue", ' +
    '"Add a belt", "Change the fabric texture to linen".',
  parameters: z.object({
    edit_instruction: z.string().describe('Plain-language description of the edit'),
  }),
  async execute({ edit_instruction }, ctx) {
    if (!ctx.image_base64) {
      return {
        action: 'image_updated',
        status: 'error',
        message: 'No product image available to edit. Please make sure you are viewing a product.',
      };
    }
    try {
      const { data } = await http.post('/edit-image', {
        image_base64: ctx.image_base64,
        edit_instruction,
      });
      const newB64 = data?.image_base64 || data?.edited_image_base64 || '';
      if (newB64) {
        ctx.__queueImage__?.({ image_base64: newB64, edit_instruction });
        ctx.image_base64 = newB64;
      }
      return {
        action: 'image_updated',
        status: newB64 ? 'success' : 'error',
        has_new_image: Boolean(newB64),
        message: newB64
          ? `Applied edit: ${edit_instruction}`
          : 'Image edit returned no result.',
      };
    } catch (e) {
      return {
        action: 'image_updated',
        status: 'error',
        message: e.message || 'Image edit failed.',
      };
    }
  },
});

// --------------------------------------------------------------------------
// 3. make_brand_compliant — chained edit + validate via main backend.
// --------------------------------------------------------------------------

const makeBrandCompliantTool = tool({
  name: 'make_brand_compliant',
  description:
    'Automatically adjust the product image to match brand guidelines. Call when the user asks ' +
    'to make the design on-brand. Examples: "Make it brand compliant", "Apply brand colors".',
  parameters: z.object({}),
  async execute(_args, ctx) {
    if (!ctx.image_base64) {
      return {
        action: 'brand_compliant',
        status: 'error',
        message: 'No product image available to adjust.',
      };
    }
    const palette = ctx.brand_style?.colorPalette || [];
    if (!palette.length) {
      return {
        action: 'brand_compliant',
        status: 'error',
        message:
          'No brand colors configured. Please set up brand colors in the Brand Style Editor first.',
      };
    }
    try {
      const brandColors = palette
        .slice(0, 4)
        .map((c) => `${c.name} (${c.hex})`)
        .join(', ');
      const editInstruction =
        `Adjust the colors of this product to match the brand palette: ${brandColors}. ` +
        'Keep the same structure, silhouette, and design details.';
      const editRes = await http.post('/edit-image', {
        image_base64: ctx.image_base64,
        edit_instruction: editInstruction,
      });
      const newB64 = editRes.data?.image_base64 || editRes.data?.edited_image_base64 || '';

      let complianceScore = 0;
      try {
        const valRes = await http.post('/validate', {
          prompt: { description: ctx.product_name || '', color_scheme: brandColors },
          brand_style: ctx.brand_style || {},
        });
        complianceScore = valRes.data?.compliance_score ?? 0;
      } catch (_err) {
        // validation is best-effort
      }

      if (newB64) {
        ctx.__queueImage__?.({ image_base64: newB64, compliance_score: complianceScore });
        ctx.image_base64 = newB64;
      }
      return {
        action: 'brand_compliant',
        status: newB64 ? 'success' : 'error',
        has_new_image: Boolean(newB64),
        compliance_score: complianceScore,
        message: `Design adjusted to brand palette (${brandColors}). Compliance: ${complianceScore}%.`,
      };
    } catch (e) {
      return {
        action: 'brand_compliant',
        status: 'error',
        message: e.message || 'Brand-compliance adjustment failed.',
      };
    }
  },
});

// --------------------------------------------------------------------------
// 4. fetch_trend_data — POST /trends on the Python main backend.
// --------------------------------------------------------------------------

const fetchTrendDataTool = tool({
  name: 'fetch_trend_data',
  description:
    'Fetch real-time fashion trend data (Gemini + Google Search grounding). Call when the user ' +
    'asks about trending colors, materials, styles, or season-specific trends.',
  parameters: z.object({
    query: z.string().describe('Free-text trend question'),
    season: z.string().optional().describe('e.g. "Summer 2025"'),
    region: z.string().optional().describe('e.g. "EU", "US", "global"'),
    demographic: z.string().optional().describe('e.g. "Gen Z", "Millennials", "Luxury"'),
  }),
  async execute({ query, season, region, demographic }) {
    const ql = (query || '').toLowerCase();
    let trendSource = 'regional';
    if (ql.includes('celeb')) trendSource = 'celebrity';
    if (!season) {
      if (ql.includes('summer')) season = 'Summer 2025';
      else if (ql.includes('fall') || ql.includes('autumn')) season = 'Fall 2025';
      else if (ql.includes('winter')) season = 'Winter 2025';
      else if (ql.includes('spring')) season = 'Spring 2025';
    }
    if (!demographic) {
      if (ql.includes('gen z')) demographic = 'Gen Z';
      else if (ql.includes('luxury')) demographic = 'Luxury';
      else if (ql.includes('streetwear')) demographic = 'Streetwear';
      else demographic = 'Millennials';
    }
    if (!region) region = 'global';

    try {
      const { data } = await http.post('/trends', {
        season: season || '',
        region,
        demographic,
        trend_source: trendSource,
      });
      const colors = (data?.colors || []).slice(0, 4).map((c) => c.name).filter(Boolean).join(', ');
      const styles = (data?.silhouettes || []).slice(0, 3).map((s) => s.name).filter(Boolean).join(', ');
      const materials = (data?.materials || []).slice(0, 3).map((m) => m.name).filter(Boolean).join(', ');
      return {
        action: 'trend_data',
        status: 'success',
        trending_colors: colors,
        trending_styles: styles,
        trending_materials: materials,
        summary: data?.summary || '',
        message:
          `${season || 'Current'} trends for ${region}: ` +
          `Top colors are ${colors}. Popular styles: ${styles}. Key materials: ${materials}.`,
      };
    } catch (e) {
      return { action: 'trend_data', status: 'error', message: e.message || 'Trend fetch failed.' };
    }
  },
});

// --------------------------------------------------------------------------
// 5. validate_brand_compliance — POST /validate on the Python main backend.
// --------------------------------------------------------------------------

const validateBrandComplianceTool = tool({
  name: 'validate_brand_compliance',
  description:
    'Check how well a product design complies with brand guidelines. Call when the user asks for ' +
    'a compliance score, validation, or guideline check.',
  parameters: z.object({
    product_description: z.string().optional().default(''),
    color_scheme: z.string().optional().default(''),
  }),
  async execute({ product_description, color_scheme }, ctx) {
    if (!ctx.brand_style || !Object.keys(ctx.brand_style).length) {
      return {
        action: 'validation',
        status: 'error',
        message: 'No brand style configured. Set up your brand in the Brand Style Editor.',
      };
    }
    try {
      const { data } = await http.post('/validate', {
        prompt: { description: product_description, color_scheme },
        brand_style: ctx.brand_style,
      });
      const score = data?.compliance_score ?? 0;
      const violations = data?.violations || [];
      const critical = violations.filter((v) => v.severity === 'critical').length;
      const warnings = violations.filter((v) => v.severity === 'warning').length;
      const parts = [];
      if (critical) parts.push(`${critical} critical`);
      if (warnings) parts.push(`${warnings} warnings`);
      const violationSummary = parts.length ? parts.join(', ') : 'minor suggestions only';

      let badge = 'Needs work';
      if (score >= 90) badge = 'Excellent';
      else if (score >= 75) badge = 'Good';
      else if (score >= 60) badge = 'Acceptable';

      return {
        action: 'validation',
        status: 'success',
        compliance_score: score,
        badge,
        is_valid: data?.is_valid ?? score >= 75,
        violation_summary: violationSummary,
        total_violations: violations.length,
        message: `Compliance: ${score}% (${badge}). ${violationSummary}`,
      };
    } catch (e) {
      return { action: 'validation', status: 'error', message: e.message || 'Validation failed.' };
    }
  },
});

// --------------------------------------------------------------------------
// 6. generate_image_variation — POST /generate-image on the Python backend.
// --------------------------------------------------------------------------

const generateImageVariationTool = tool({
  name: 'generate_image_variation',
  description:
    'Generate a completely new product image from scratch. Call when the user wants a fresh ' +
    'image (not an edit), e.g. "Generate this dress in silk" or "Show me a maxi version".',
  parameters: z.object({
    variation_description: z.string(),
    category: z.string().optional().default('apparel'),
  }),
  async execute({ variation_description, category }, ctx) {
    try {
      const { data } = await http.post('/generate-image', {
        product_description: variation_description,
        category,
        brand_style: ctx.brand_style || {},
      });
      const newB64 = data?.image_base64 || '';
      if (newB64) {
        ctx.__queueImage__?.({ image_base64: newB64, description: variation_description });
        ctx.image_base64 = newB64;
      }
      return {
        action: 'image_updated',
        status: newB64 ? 'success' : 'error',
        has_new_image: Boolean(newB64),
        message: newB64
          ? `Generated new variation: ${variation_description}`
          : 'Image generation returned no result.',
      };
    } catch (e) {
      return { action: 'image_updated', status: 'error', message: e.message || 'Image generation failed.' };
    }
  },
});

// --------------------------------------------------------------------------
// 7. save_design — frontend signal only (matches design_tools.save_design_signal).
// --------------------------------------------------------------------------

const saveDesignTool = tool({
  name: 'save_design',
  description:
    'Save the current design modifications to the collection. Call when the user says they want ' +
    'to save, keep, or finalize the current design.',
  parameters: z.object({}),
  async execute(_args, ctx) {
    const productName = ctx.product_name || 'this product';
    return {
      action: 'save_design',
      status: 'success',
      product_name: productName,
      message: `Design for '${productName}' saved to the collection!`,
    };
  },
});

// --------------------------------------------------------------------------
// 8. generate_ad_video — POST /generate-ad-video.
// --------------------------------------------------------------------------

const generateAdVideoTool = tool({
  name: 'generate_ad_video',
  description:
    'Start an ad video with the configured Fal provider for the current product. Call when the user asks for a ' +
    'cinematic ad, promo video, or product video.',
  parameters: z.object({
    campaign_brief: z.string(),
    ad_style: z.string().optional().default('cinematic'),
  }),
  async execute({ campaign_brief, ad_style }, ctx) {
    try {
      const { data } = await http.post('/generate-ad-video', {
        product: { name: ctx.product_name || 'Current product', description: campaign_brief },
        brand_id: ctx.brand_id || 'default',
        campaign_brief,
        ad_style,
      });
      const adId = data?.ad_id || '';
      return {
        action: 'generate_ad_video',
        status: 'started',
        ad_id: adId,
        campaign_brief,
        ad_style,
        message:
          `I've started generating your ${ad_style} ad video for: '${campaign_brief}'. ` +
          `This will take a few minutes. The video ID is ${adId} — ` +
          `I'll let you know when it's ready, or you can check the Video Ad tab.`,
      };
    } catch (e) {
      return { action: 'generate_ad_video', status: 'error', message: e.message || 'Video generation failed.' };
    }
  },
});

// --------------------------------------------------------------------------
// 9. navigate_to_page — pure local mapping (matches Python version).
// --------------------------------------------------------------------------

const NAV_MAP = {
  dashboard: '/dashboard',
  'brand style': '/brand-style',
  'brand editor': '/brand-style',
  'brand guardian': '/brand-guardian',
  validation: '/brand-guardian',
  collection: '/collection',
  collections: '/collection',
  trends: '/trends',
  'trend intelligence': '/trends',
  settings: '/settings',
};

const navigateToPageTool = tool({
  name: 'navigate_to_page',
  description:
    'Navigate the user to a specific page in the app. Examples: "Go to trends", ' +
    '"Open brand editor", "Show me the collection", "Take me to settings".',
  parameters: z.object({
    page_name: z.string(),
  }),
  async execute({ page_name }) {
    const key = (page_name || '').toLowerCase().trim();
    const route = NAV_MAP[key];
    if (route) {
      return {
        action: 'navigate',
        status: 'success',
        page: page_name,
        route,
        message: `Navigating to ${page_name}.`,
      };
    }
    return {
      action: 'navigate',
      status: 'unknown_page',
      page: page_name,
      available_pages: Object.keys(NAV_MAP),
      message: `I don't recognize '${page_name}'. Available pages: ${Object.keys(NAV_MAP).join(', ')}.`,
    };
  },
});

// --------------------------------------------------------------------------
// 10. start_collection_generation — POST /generate-collection.
// --------------------------------------------------------------------------

const startCollectionGenerationTool = tool({
  name: 'start_collection_generation',
  description:
    'Start generating a new fashion collection (trends → planning → images). Call when the user ' +
    'asks for a new collection.',
  parameters: z.object({
    season: z.string().optional().default(''),
    region: z.string().optional().default('Global'),
    demographic: z.string().optional().default('Millennials'),
    product_count: z.number().int().optional().default(6),
  }),
  async execute({ season, region, demographic, product_count }, ctx) {
    try {
      const { data } = await http.post('/generate-collection', {
        brand_id: ctx.brand_id || 'default',
        season,
        region,
        demographic,
        categories: ['tops', 'bottoms', 'dresses'],
        product_count,
        trend_source: 'regional',
      });
      const collectionId = data?.collection_id || '';
      return {
        action: 'start_collection',
        status: 'started',
        collection_id: collectionId,
        season,
        region,
        demographic,
        product_count,
        message:
          `I've started generating a ${season || 'new'} collection for ${demographic} in ${region} ` +
          `with ${product_count} products. Collection ID: ${collectionId}.`,
      };
    } catch (e) {
      return { action: 'start_collection', status: 'error', message: e.message || 'Collection generation failed.' };
    }
  },
});

// --------------------------------------------------------------------------
// Export tool registry
// --------------------------------------------------------------------------

const tools = [
  analyzeProductImageTool,
  editProductImageTool,
  makeBrandCompliantTool,
  fetchTrendDataTool,
  validateBrandComplianceTool,
  generateImageVariationTool,
  saveDesignTool,
  generateAdVideoTool,
  navigateToPageTool,
  startCollectionGenerationTool,
];

// --------------------------------------------------------------------------
// Convert Zod schemas to OpenAI tool/function JSON schema (subset).
// --------------------------------------------------------------------------

function zodFieldToJson(field) {
  if (!field || !field._def) return { type: 'string' };
  const def = field._def;
  switch (def.typeName) {
    case 'ZodString':
      return { type: 'string', ...(def.description && { description: def.description }) };
    case 'ZodNumber':
      return { type: 'number', ...(def.description && { description: def.description }) };
    case 'ZodBoolean':
      return { type: 'boolean', ...(def.description && { description: def.description }) };
    case 'ZodArray':
      return {
        type: 'array',
        items: zodFieldToJson(def.type),
        ...(def.description && { description: def.description }),
      };
    case 'ZodObject':
      return {
        type: 'object',
        properties: zodObjectToProps(field),
        ...(def.description && { description: def.description }),
      };
    case 'ZodEnum':
      return {
        type: 'string',
        enum: def.values,
        ...(def.description && { description: def.description }),
      };
    case 'ZodOptional':
      return zodFieldToJson(def.innerType);
    case 'ZodDefault':
      return { ...zodFieldToJson(def.innerType), default: def.defaultValue() };
    default:
      return { type: 'string' };
  }
}

function zodObjectToProps(schema) {
  if (!schema || !schema._def || schema._def.typeName !== 'ZodObject') return {};
  const shape = schema._def.shape ? schema._def.shape() : {};
  const properties = {};
  for (const [k, v] of Object.entries(shape)) {
    properties[k] = zodFieldToJson(v);
  }
  return properties;
}

function zodObjectRequired(schema) {
  if (!schema || !schema._def || schema._def.typeName !== 'ZodObject') return [];
  const shape = schema._def.shape ? schema._def.shape() : {};
  const required = [];
  for (const [k, v] of Object.entries(shape)) {
    const t = v?._def?.typeName;
    if (t !== 'ZodOptional' && t !== 'ZodDefault') required.push(k);
  }
  return required;
}

function toolsToOpenAIRealtimeFormat(toolList = tools) {
  return toolList.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: {
      type: 'object',
      properties: zodObjectToProps(t.parameters),
      required: zodObjectRequired(t.parameters),
    },
  }));
}

module.exports = {
  tools,
  toolsToOpenAIRealtimeFormat,
};
