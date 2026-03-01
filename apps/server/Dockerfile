FROM node:22-slim AS builder
WORKDIR /app

RUN npm install -g pnpm

# Copy full workspace (needed for monorepo install)
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @gander/shared build
RUN pnpm --filter server exec prisma generate
RUN pnpm --filter server build

# --- runner stage ---
FROM node:22-slim AS runner
WORKDIR /app

# Hoisted workspace node_modules
COPY --from=builder /app/node_modules ./node_modules

# Server-specific node_modules (includes @prisma/client with native engine)
COPY --from=builder /app/apps/server/node_modules ./apps/server/node_modules

# Compiled JS output
COPY --from=builder /app/apps/server/dist ./apps/server/dist

# Prisma schema + migrations (needed by migrate deploy at startup)
COPY --from=builder /app/apps/server/prisma ./apps/server/prisma

# Shared package source (in case any shared types are imported at runtime)
COPY --from=builder /app/packages ./packages

COPY apps/server/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app/apps/server
EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
