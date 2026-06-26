# ── Dependencies ─────────────────────────────────────────
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY api/package.json api/
COPY dash/package.json dash/
COPY status/package.json status/
COPY landing/package.json landing/
RUN bun install --frozen-lockfile

# ── Production ───────────────────────────────────────────
# We run TypeScript directly with Bun (bun:sqlite means no native modules to
# compile), so there's no separate build step for the API.
FROM oven/bun:1-slim AS production
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
COPY packages ./packages
COPY api ./api

# Run as the unprivileged built-in `bun` user; only /app/data is writable.
RUN mkdir -p /app/data && chown -R bun:bun /app
USER bun

EXPOSE 3000
VOLUME /app/data

CMD ["bun", "run", "api/src/index.ts"]
