# Multi-stage build for Next.js frontend - FIXED
FROM --platform=linux/amd64 node:20-slim AS deps
WORKDIR /app

# Install build deps for native modules
RUN apt-get update && apt-get install -y \
    python3 python3-pip make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --include=optional --legacy-peer-deps

# Stage 2: Builder - REBUILD NATIVE MODULES HERE
FROM --platform=linux/amd64 node:20-slim AS builder
WORKDIR /app

# Install build deps AGAIN for builder stage
RUN apt-get update && apt-get install -y \
    python3 python3-pip make g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy source FIRST, then install/rebuild
COPY package.json package-lock.json* ./
RUN npm ci --include=optional --legacy-peer-deps

# Copy app code
COPY . .

# Accept build arguments for environment variables
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_VEO_SERVICE_URL
ARG NEXT_PUBLIC_VOICE_AGENT_URL
ARG GEMINI_API_KEY

# Set environment variables for build
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_VEO_SERVICE_URL=$NEXT_PUBLIC_VEO_SERVICE_URL
ENV NEXT_PUBLIC_VOICE_AGENT_URL=$NEXT_PUBLIC_VOICE_AGENT_URL
ENV GEMINI_API_KEY=$GEMINI_API_KEY

# CRITICAL: Rebuild LightningCSS for THIS platform
RUN npm rebuild lightningcss --build-from-source \
    && npm rebuild @tailwindcss/postcss7-compat @tailwindcss/postcss8-compat \
    && npx next telemetry disable

# Build Next.js
RUN npm run build

# Stage 3: Runner
FROM --platform=linux/amd64 node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

# Add tini for proper signal handling
RUN apt-get update && apt-get install -y tini && rm -rf /var/lib/apt/lists/* 

# Non-root user
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Copy ONLY standalone build output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME="0.0.0.0" 

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
