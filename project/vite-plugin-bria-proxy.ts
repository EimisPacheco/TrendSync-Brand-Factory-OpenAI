import type { Plugin } from 'vite';

/**
 * Custom Vite plugin to proxy Bria API requests
 * This gives us full control over the request/response handling
 */
export function briaProxyPlugin(): Plugin {
  return {
    name: 'bria-api-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // Only handle /api/bria/* requests
        if (!req.url?.startsWith('/api/bria')) {
          return next();
        }

        console.log('\n🔄 Bria Proxy Plugin');
        console.log('📤 Incoming request:', req.method, req.url);

        try {
          // Read the request body
          let body = '';
          req.on('data', chunk => {
            body += chunk.toString();
          });

          await new Promise((resolve) => req.on('end', resolve));

          console.log('📤 Request body:', body);
          console.log('📤 Request headers:', req.headers);

          // Build Bria API URL
          const briaPath = req.url.replace('/api/bria', '');
          const briaUrl = `https://engine.prod.bria-api.com${briaPath}`;

          console.log('📤 Forwarding to:', briaUrl);

          // Get api_token from request headers
          const apiToken = req.headers['api_token'] as string || req.headers['api-token'] as string;

          console.log('🔑 API Token found:', apiToken ? `${apiToken.substring(0, 8)}...` : 'MISSING!');

          // Forward request to Bria API
          // CRITICAL: Send ONLY the exact headers that Node.js sends
          // The proxy was adding extra headers (X-Forwarded-*, User-Agent, etc.)
          // that triggered a buggy code path in Bria's API
          const fetchHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            'api_token': apiToken,
          };

          console.log('📤 Headers being sent to Bria:', fetchHeaders);

          const response = await fetch(briaUrl, {
            method: req.method,
            headers: fetchHeaders,
            body: body || undefined,
          });

          console.log('📥 Bria response status:', response.status);
          console.log('📥 Bria response headers:', Object.fromEntries(response.headers.entries()));

          const responseText = await response.text();
          console.log('📥 Bria response body:', responseText.substring(0, 200) + '...');

          // Send response back to client
          res.writeHead(response.status, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(responseText);

        } catch (error: any) {
          console.error('❌ Proxy error:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
    },
  };
}
