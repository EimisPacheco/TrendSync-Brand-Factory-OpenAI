import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const BRIA_API_BASE = 'https://engine.prod.bria-api.com';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface GenerateImageRequest {
  prompt: string;
  negative_prompt?: string;
  aspect_ratio?: string;
  steps_num?: number;
  guidance_scale?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const briaApiKey = Deno.env.get('BRIA_API_KEY');
    if (!briaApiKey) {
      throw new Error('BRIA_API_KEY environment variable is not set');
    }

    const url = new URL(req.url);
    const statusCheckUrl = url.searchParams.get('statusCheckUrl');

    if (statusCheckUrl) {
      const response = await fetch(statusCheckUrl, {
        method: 'GET',
        headers: {
          'api_token': briaApiKey,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return new Response(
          JSON.stringify({ error: 'Status check failed', details: errorText }),
          {
            status: response.status,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          }
        );
      }

      const result = await response.json();

      return new Response(
        JSON.stringify(result),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    const body: GenerateImageRequest = await req.json();

    const requestBody = {
      prompt: body.prompt,
      model_version: 'FIBO',
      negative_prompt: body.negative_prompt || '',
      aspect_ratio: body.aspect_ratio || '4:5',
      steps_num: body.steps_num || 50,
      guidance_scale: body.guidance_scale || 5,
      sync: false,
    };

    const response = await fetch(`${BRIA_API_BASE}/v2/image/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api_token': briaApiKey,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(
        JSON.stringify({ error: 'Failed to generate image', details: errorText }),
        {
          status: response.status,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    const result = await response.json();

    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});