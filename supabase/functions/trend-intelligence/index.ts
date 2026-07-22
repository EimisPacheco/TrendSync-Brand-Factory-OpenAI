import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface TrendRequest {
  region: string;
  season: string;
  demographic: string;
  categories: string[];
}

function responseText(payload: { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }): string {
  return payload.output
    ?.flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text ?? "")
    .join("") ?? "";
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("OpenAI response did not contain a JSON object");
  return JSON.parse(cleaned.slice(start, end + 1));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY environment variable is not set");

    const { region, season, demographic, categories }: TrendRequest = await req.json();
    if (!region || !season) {
      return new Response(JSON.stringify({ error: "Region and season are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `Search the web for current fashion trends for ${demographic || "fashion consumers"} in ${region} for ${season}.
Focus on these categories: ${(categories?.length ? categories : ["apparel"]).join(", ")}.
Return only a JSON object with colors, silhouettes, materials, themes, and summary. Each array item must contain name, confidence (0-100), and description. Colors may also contain hex.`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_TREND_MODEL") ?? "gpt-5.6-terra",
        input: prompt,
        tools: [{ type: "web_search" }],
        reasoning: { effort: "low" },
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      return new Response(JSON.stringify({ error: "OpenAI trend search failed", details: result }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      insights: extractJson(responseText(result)),
      source: "openai-web-search",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
