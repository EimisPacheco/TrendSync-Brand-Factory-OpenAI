import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("BRIA_API_KEY");
    if (!apiKey) throw new Error("BRIA_API_KEY environment variable is not set");

    const body = await req.json();
    if (!body?.prompt?.trim()) throw new Error("prompt is required");

    const briaResponse = await fetch("https://engine.prod.bria-api.com/v2/image/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        api_token: apiKey,
      },
      body: JSON.stringify({
        prompt: body.prompt,
        model_version: "FIBO",
        negative_prompt: body.negative_prompt ?? "",
        aspect_ratio: body.aspect_ratio ?? "4:5",
        steps_num: body.steps_num ?? 50,
        guidance_scale: body.guidance_scale ?? 5,
        sync: body.sync ?? false,
      }),
    });

    return new Response(await briaResponse.text(), {
      status: briaResponse.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
