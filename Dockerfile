# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS base

RUN npm install -g npm@11.18.0

WORKDIR /app

FROM base AS deps

COPY package*.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci

FROM deps AS postgres-tests

COPY . .
CMD ["npm", "run", "test:postgres"]

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS production-deps

# npm is platform-independent JavaScript. Install the pinned CLI once on the
# native build platform instead of repeating its network install through QEMU.
COPY --from=base /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm

WORKDIR /app

COPY package*.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=dev

FROM deps AS verify

# Repository-wide verification exercises the portable deployment installers.
# Keep their host-tool dependencies in this build-only stage; they are not
# copied into the distroless runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends jq openssl \
    && rm -rf /var/lib/apt/lists/*

COPY . .
RUN npm run typecheck
RUN npm run lint
RUN npm run format:check
RUN npm run test:coverage
RUN npm run build

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:af85d11ce7ef10172855a6e3649e3e8125b1b9e3ca41849ec2918036f05cb212 AS runtime

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
