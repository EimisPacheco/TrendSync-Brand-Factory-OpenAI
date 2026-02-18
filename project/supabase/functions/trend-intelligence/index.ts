import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

    const perplexityApiKey = Deno.env.get("PERPLEXITY_API_KEY");

    if (!perplexityApiKey) {
      return new Response(
        JSON.stringify({ error: "PERPLEXITY_API_KEY environment variable is not configured. Please add your API key to proceed." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const prompt = buildTrendPrompt(region, season, demographic, categories);

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${perplexityApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          {
            role: "system",
            content: "You are a fashion trend analyst. Respond only with valid JSON matching the requested structure."
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(
        JSON.stringify({
          error: `Perplexity API error (${response.status}): ${errorText || response.statusText}`
        }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || "";

    if (!content) {
      return new Response(
        JSON.stringify({ error: "Perplexity API returned empty response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let insights: TrendInsights;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
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
      JSON.stringify({ insights, source: "perplexity" }),
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
  return `Analyze current fashion trends for ${season} in ${region} targeting ${demographic || "general audience"}.

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