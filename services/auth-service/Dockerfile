FROM node:20-alpine AS base
LABEL maintainer="collabflow-team"
LABEL service="auth-service"

# Create app user (non-root for security)
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

# ── Dependencies stage ─────────────────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# ── Production stage ───────────────────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY package.json ./

# Set ownership to non-root user
RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3001

# Healthcheck built into the image
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["node", "src/index.js"]
