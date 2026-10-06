# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e

FROM --platform=$BUILDPLATFORM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS base

WORKDIR /app

# Corepack authenticates the npm archive against packageManager's committed
# SHA-512 hash before the downloaded CLI executes.
COPY package.json ./
ENV PATH="/opt/corepack-shims:${PATH}"
RUN mkdir -p /opt/corepack-shims \
    && corepack enable npm --install-directory /opt/corepack-shims \
    && npm --version | grep -Fx "11.20.0"

FROM base AS deps

COPY package*.json .npmrc ./
COPY scripts/verify-install-scripts.mjs scripts/verify-esbuild.mjs ./scripts/
RUN npm run verify:dependency-policy
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --ignore-scripts
RUN npm audit signatures \
    && npm audit --omit=dev --audit-level=high
RUN npm run install:trusted

FROM deps AS postgres-tests

COPY . .
CMD ["npm", "run", "test:postgres"]

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS production-deps

WORKDIR /app

COPY package*.json .npmrc ./
ENV PATH="/opt/corepack-shims:${PATH}"
RUN mkdir -p /opt/corepack-shims \
    && corepack enable npm --install-directory /opt/corepack-shims \
    && npm --version | grep -Fx "11.20.0"
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=dev --ignore-scripts

FROM deps AS verify

# Repository-wide verification exercises the portable deployment installers.
# Keep their host-tool dependencies in this build-only stage; they are not
# copied into the distroless runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends jq openssl \
    && rm -rf /var/lib/apt/lists/*

COPY . .
RUN --network=none npm run typecheck
RUN --network=none npm run lint
RUN --network=none npm run format:check
RUN --network=none npm run test:coverage
RUN --network=none npm run build

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e AS runtime

STOPSIGNAL SIGTERM

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=production-deps /app/package*.json ./
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=verify /app/dist ./dist
COPY --from=verify /app/scripts/generate-lti-private-key.mjs ./scripts/generate-lti-private-key.mjs
COPY --from=verify /app/LICENSE /app/NOTICE /app/COMMERCIAL-LICENSE.md /app/CONTRIBUTING.md /app/THIRD-PARTY-NOTICES.md ./

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["dist/server/server/main.js"]
