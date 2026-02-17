# 🐳 ANTIGRAVITY ENRICHER - Multi-Stage Dockerfile
# Task 10: Optimized production image

# ================================
# 🔨 STAGE 1: BUILD
# ================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++ 

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY tsconfig.build.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ================================
# 🚀 STAGE 2: PRODUCTION
# ================================
FROM node:20-alpine AS production

WORKDIR /app

# Install runtime dependencies for Puppeteer
RUN apk add --no-cache \
  chromium \
  nss \
  freetype \
  freetype-dev \
  harfbuzz \
  ca-certificates \
  ttf-freefont \
  dumb-init

# Set Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
  PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
  NODE_ENV=production

# Create non-root user for security
RUN addgroup -g 1001 antigravity && \
  adduser -S -u 1001 -G antigravity antigravity

# Copy built files from builder
# Copy built files from builder
COPY --from=builder --chown=antigravity:antigravity /app/node_modules ./node_modules
COPY --from=builder --chown=antigravity:antigravity /app/dist ./dist
COPY --from=builder --chown=antigravity:antigravity /app/package.json ./

# Ensure LANDING page is available
COPY --from=builder --chown=antigravity:antigravity /app/src/LANDING ./dist/src/LANDING

# Create data directories
RUN mkdir -p /app/data /app/output && chown -R antigravity:antigravity /app

# Switch to non-root user
USER antigravity

# Health check - verify process is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD pgrep -f "node" > /dev/null || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Default command: run server
CMD ["node", "dist/src/index.js", "server"]
