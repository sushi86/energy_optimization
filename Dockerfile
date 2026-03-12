FROM node:22-slim AS base
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=deps /app/packages/web/node_modules ./packages/web/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
RUN pnpm --filter @energy-control/shared build
RUN pnpm --filter @energy-control/api build
RUN pnpm --filter @energy-control/web build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# API built output
COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/packages/api/package.json ./packages/api/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/

# Web built output (full .next, not standalone)
COPY --from=build /app/packages/web/.next ./packages/web/.next
COPY --from=build /app/packages/web/package.json ./packages/web/
COPY --from=build /app/packages/web/next.config.ts ./packages/web/

# All node_modules
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=deps /app/packages/web/node_modules ./packages/web/node_modules
COPY package.json pnpm-workspace.yaml ./

COPY <<'EOF' /app/start.sh
#!/bin/bash
node /app/packages/api/dist/index.js &
cd /app/packages/web && npx next start --port 3001 &
wait -n
exit $?
EOF
RUN chmod +x /app/start.sh

EXPOSE 3001 3002
CMD ["/app/start.sh"]
