FROM node:22-slim AS base
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/web/node_modules ./packages/web/node_modules
COPY tsconfig.base.json ./
COPY packages/web/ packages/web/
RUN pnpm --filter @energy-control/web build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy standalone server + .next runtime
COPY --from=build /app/packages/web/.next/standalone ./

# Copy static assets into the path Next.js expects
COPY --from=build /app/packages/web/.next/static ./packages/web/.next/static

# Standalone traces don't resolve pnpm symlinks — copy real node_modules
COPY --from=deps /app/node_modules ./node_modules

EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
