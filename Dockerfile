# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
# Install on the target Linux architecture, including Sharp/SWC optional binaries.
RUN npm ci --include=optional --no-audit --no-fund

FROM dependencies AS builder
COPY . .
# Public, non-secret build inputs. Static metadata/headers require a rebuild.
ARG SITE_URL=""
ARG SITE_INDEXING_ALLOWED="false"
ENV SITE_URL=$SITE_URL SITE_INDEXING_ALLOWED=$SITE_INDEXING_ALLOWED
RUN NEXT_STANDALONE=true npm run build

FROM base AS runner
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=8080
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
# Liveness only: static public route, no database, provider call or session.
# Cloud Run probes must be configured separately; Docker HEALTHCHECK is not imported.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/robots.txt',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
