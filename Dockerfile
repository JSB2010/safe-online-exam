FROM node:24-bookworm-slim AS base

RUN npm install -g npm@11.18.0

WORKDIR /app

FROM base AS deps

COPY package*.json .npmrc ./
RUN npm ci

FROM deps AS postgres-tests

COPY . .
CMD ["npm", "run", "test:postgres"]

FROM deps AS production-deps

RUN npm prune --omit=dev

FROM deps AS verify

COPY . .
RUN npm run typecheck
RUN npm run lint
RUN npm run format:check
RUN npm run test:coverage
RUN npm run build

FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime

STOPSIGNAL SIGTERM

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=production-deps /app/package*.json ./
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=verify /app/dist ./dist

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["dist/server/server/main.js"]
