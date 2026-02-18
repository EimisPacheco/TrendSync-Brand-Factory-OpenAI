import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// Inline custom proxy plugin for multiple APIs
function apiProxyPlugin(): Plugin {
  return {
    name: 'api-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // Handle /api/bria/* and /api/resend/* requests
        const isBria = req.url?.startsWith('/api/bria');
        const isResend = req.url?.startsWith('/api/resend');

        if (!isBria && !isResend) {
          return next();
        }

        const apiName = isBria ? 'Bria' : 'Resend';
        console.log(`\n🔄 ${apiName} Proxy Plugin Activated!`);
        console.log('📤 Incoming request:', req.method, req.url);

        try {
          // Read the request body
          let body = '';
          const chunks: Buffer[] = [];

          req.on('data', chunk => {
            chunks.push(chunk);
            body += chunk.toString();
          });

          await new Promise((resolve) => req.on('end', resolve));

          // For large bodies, use Buffer.concat instead of string concatenation
          const fullBody = chunks.length > 0 ? Buffer.concat(chunks) : Buffer.from('');
          const bodyString = fullBody.toString('utf-8');

          // Check if this is an image-to-image request
          const isImageToImageRequest = bodyString.includes('"images"') && bodyString.includes('cloudfront.net');

          console.log('📤 Request body length:', bodyString.length);
          if (isImageToImageRequest) {
            console.log('🖼️ Image-to-Image request detected');
            // For image-to-image requests, only log limited info to avoid console overflow
            const bodyPreview = bodyString.substring(0, 200) + '...[truncated]...';
            console.log('📤 Request body preview:', bodyPreview);
          } else {
            console.log('📤 Request body preview (first 500 chars):', bodyString.substring(0, 500));
          }
          console.log('📤 All incoming headers:', req.headers);

          let targetUrl: string;
          let fetchHeaders: Record<string, string>;

          if (isBria) {
            // Build Bria API URL
            const briaPath = req.url.replace('/api/bria', '');
            targetUrl = `https://engine.prod.bria-api.com${briaPath}`;

            // Get api_token from request headers
            const apiToken = (req.headers['api_token'] as string) || (req.headers['api-token'] as string);
            console.log('🔑 API Token found:', apiToken ? `${apiToken.substring(0, 8)}...${apiToken.substring(apiToken.length - 4)}` : '❌ MISSING!');

            fetchHeaders = {
              'Content-Type': 'application/json',
              'api_token': apiToken,
            };
          } else {
            // Build Resend API URL
            const resendPath = req.url.replace('/api/resend', '');
            targetUrl = `https://api.resend.com${resendPath}`;

            // Get Authorization token from request headers
            const authToken = (req.headers['authorization'] as string);
            console.log('🔑 Resend Auth Token found:', authToken ? 'Bearer ***' : '❌ MISSING!');

            fetchHeaders = {
              'Content-Type': 'application/json',
              'Authorization': authToken,
            };
          }

          console.log('📤 Forwarding to:', targetUrl);
          console.log('📤 Headers being sent:', fetchHeaders);

          // Add timeout for fetch request - longer for image-to-image requests
          const controller = new AbortController();
          const timeoutDuration = isImageToImageRequest ? 60000 : 30000; // 60s for image-to-image, 30s otherwise
          const timeout = setTimeout(() => controller.abort(), timeoutDuration);

          console.log(`⏱️ Timeout set to ${timeoutDuration}ms`);

          // Use the original buffer for the body to avoid string encoding issues
          const response = await fetch(targetUrl, {
            method: req.method,
            headers: {
              ...fetchHeaders,
              'Content-Length': fullBody.length.toString(),
            },
            body: req.method !== 'GET' && req.method !== 'HEAD' ? fullBody : undefined,
            signal: controller.signal,
          }).finally(() => clearTimeout(timeout));

          console.log(`📥 ${apiName} response status:`, response.status, response.statusText);
          console.log(`📥 ${apiName} response headers:`, Object.fromEntries(response.headers.entries()));

          const responseText = await response.text();
          console.log(`📥 ${apiName} response body (first 500 chars):`, responseText.substring(0, 500));

          // Send response back to client
          res.writeHead(response.status, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(responseText);

          console.log('✅ Proxy completed successfully\n');

        } catch (error: any) {
          console.error('❌ Proxy error:', error.message);
          console.error('❌ Error type:', error.name);
          console.error('❌ Error stack:', error.stack);

          // Provide more context in error response
          const errorResponse = {
            error: error.message,
            type: error.name,
            details: {
              api: apiName,
              url: targetUrl,
              method: req.method,
              bodyLength: fullBody.length,
            },
            ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
          };

          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(errorResponse));
        }
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    apiProxyPlugin(), // Custom proxy for Bria and Resend APIs
  ],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  define: {
    // Add Node.js global polyfills for browser
    'process.env': {},
    'process.platform': '"browser"',
    'process.version': '"v18.0.0"',
    'process.versions': '{}',
    'process.nextTick': 'setTimeout',
    'global': 'globalThis',
  },
});
