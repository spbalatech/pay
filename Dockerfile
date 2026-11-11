# Aegis console: UI and API (Next.js pages, server actions, /api/webhooks/paypal)
# in one container. Postgres runs separately; pass its URL as DATABASE_URL.
#
#   docker build -t aegis .
#   docker run -p 3000:3000 -e DATABASE_URL=postgresql://... aegis
#
# On first boot against an empty database it applies the schema, loads the
# offline demo data and runs the agents once (scripts/demo-boot.ts). Restarts
# keep whatever is already there.

FROM node:22-bookworm-slim AS base
# Prisma's query engine needs OpenSSL. curl and wget are for health checks run
# from outside the image (Coolify's health check calls one of them).
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl wget \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
# Inlined into the browser bundle at build time, so it must be a build argument.
ARG NEXT_PUBLIC_AG_GRID_LICENSE_KEY=""
ENV NEXT_PUBLIC_AG_GRID_LICENSE_KEY=$NEXT_PUBLIC_AG_GRID_LICENSE_KEY
RUN npx prisma generate && npx next build

# The first boot can take minutes (seed + one agent pass with AI), hence the
# long start period on the health check.
# The runtime keeps the full node_modules: the boot step needs the Prisma CLI
# (migrations) and tsx (seed and agent scripts).
FROM base AS run
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=600s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/webhooks/paypal').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["sh", "-c", "npx prisma migrate deploy && npm run demo:boot && exec npx next start -H 0.0.0.0 -p ${PORT}"]
