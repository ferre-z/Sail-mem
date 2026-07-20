# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* tsconfig.json ./
COPY src ./src
COPY drizzle.config.ts ./
RUN npm install --no-audit --no-fund --include=dev typescript \
 && npm run build \
 && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache curl tini && \
    addgroup -S sail && adduser -S sail -G sail
ENV NODE_ENV=production \
    SAIL_MEM_STORAGE=sqlite \
    SAIL_MEM_SQLITE_PATH=/data/sail-mem.db
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
RUN mkdir -p /data && chown -R sail:sail /data
VOLUME ["/data"]
EXPOSE 3000
USER sail
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/mcp/cli.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1
