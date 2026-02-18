import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { GoogleGenAI } from "npm:@google/genai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const PROJECT_ID = Deno.env.get("GOOGLE_CLOUD_PROJECT") ?? "project-ca52e7fa-d4e3-47fa-9df";
const LOCATION = Deno.env.get("GOOGLE_CLOUD_LOCATION") ?? "us-central1";

interface TrendRequest {
  region: string;
  season: string;
  demographic: string;
  categories: string[];
}

interface TrendingItem {
  name: string;
  confidence: number;
  description: string;
}

interface TrendInsights {
  colors: TrendingItem[];
  silhouettes: TrendingItem[];
  materials: TrendingItem[];
  themes: TrendingItem[];
  summary: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { region, season, demographic, categories }: TrendRequest = await req.json();

    if (!region || !season) {
      return new Response(
        JSON.stringify({ error: "Region and season are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ai = new GoogleGenAI({
      vertexai: true,
      project: PROJECT_ID,
      location: LOCATION,
    });

    const prompt = buildTrendPrompt(region, season, demographic, categories);

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        temperature: 0.3,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
        tools: [{ googleSearch: {} }],
      },
    });

    const content = result.text;

    if (!content) {
      return new Response(
        JSON.stringify({ error: "Gemini API returned empty response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let insights: TrendInsights;
    try {
      let jsonContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const jsonMatch = jsonContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return new Response(
          JSON.stringify({ error: "Failed to extract JSON from AI response. Response was: " + content }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      insights = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      return new Response(
        JSON.stringify({
          error: `Failed to parse AI response as JSON: ${parseError.message}. Raw response: ${content}`
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ insights, source: "vertex-ai" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: `Unexpected error: ${error.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function buildTrendPrompt(region: string, season: string, demographic: string, categories: string[]): string {
  return `Search for and analyze current fashion trends for ${season} in ${region} targeting ${demographic || "general audience"}.

Focus on these categories: ${categories.join(", ") || "apparel, footwear, accessories"}.

Provide your analysis as JSON with this exact structure:
{
  "colors": [{"name": "Color Name", "confidence": 85, "description": "Why this color is trending"}],
  "silhouettes": [{"name": "Silhouette type", "confidence": 80, "description": "Why this shape is popular"}],
  "materials": [{"name": "Material name", "confidence": 75, "description": "Why this material is in demand"}],
  "themes": [{"name": "Theme name", "confidence": 70, "description": "Design theme description"}],
  "summary": "Brief overall trend summary for this market"
}

Include 3-5 items per category. Confidence should be 0-100 based on data strength.`;
}
