# syntax=docker/dockerfile:1

##############################
# Stage 1 — deps: install once, reused by every later stage via cache
##############################
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

##############################
# Stage 2 — test: fails the build if the suite doesn't pass, never ships to the final image
##############################
FROM deps AS test
WORKDIR /app
COPY . .
RUN npm test

##############################
# Stage 3 — prod-deps: production-only node_modules, no devDependencies bloat
##############################
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

##############################
# Stage 4 — runtime: the actual image that ships. Depends on `test` passing
# (via the build DAG) without carrying its node_modules or dev tooling.
##############################
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Non-root: the base image ships a `node` user/group already.
USER node

COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node server.js ./
COPY --chown=node:node src ./src

# Referenced only so the `test` stage is part of this build's dependency
# graph — `docker build` won't skip it even though runtime doesn't COPY
# anything from it.
COPY --from=test /app/package.json /tmp/.test-stage-ran

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||5000)+'/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
