# syntax=docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89

FROM --platform=$BUILDPLATFORM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS base

WORKDIR /app

# Corepack authenticates the npm archive against packageManager's committed
# SHA-512 hash before the downloaded CLI executes.
COPY package.json ./
ENV PATH="/opt/corepack-shims:${PATH}"
RUN mkdir -p /opt/corepack-shims \
    && corepack enable npm --install-directory /opt/corepack-shims \
    && npm --version | grep -Fx "11.19.0"

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

FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS production-deps

WORKDIR /app

COPY package*.json .npmrc ./
ENV PATH="/opt/corepack-shims:${PATH}"
RUN mkdir -p /opt/corepack-shims \
    && corepack enable npm --install-directory /opt/corepack-shims \
    && npm --version | grep -Fx "11.19.0"
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

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:fbbdda866ea71aef98c4abece17e3d61fbf820cc2ef3961522caa2478716171a AS runtime

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
