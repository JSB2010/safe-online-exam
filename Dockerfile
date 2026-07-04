FROM node:22-bookworm-slim AS deps

WORKDIR /app

COPY package*.json .npmrc ./
RUN npm ci

FROM deps AS verify

COPY . .
RUN npm run typecheck
RUN npm run lint
RUN npm run format:check
RUN npm run test:coverage
RUN npm run build

FROM verify AS production-deps

RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=production-deps /app/package*.json ./
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=production-deps /app/dist ./dist

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server/server/main.js"]
