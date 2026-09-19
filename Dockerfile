# Build the static client bundle. This stage exists purely to produce
# dist/ — nothing from it reaches the runtime image below except that.
FROM node:24-alpine AS build

WORKDIR /app

# package.json + package-lock.json first so the dependency layer is cached
# independently of source changes. --ignore-scripts: canvas (a devDependency
# that only tests import) would otherwise download a prebuilt binary or try a
# from-source build that has no toolchain on alpine.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# Runtime: a Node process now, not Caddy — see server/index.ts. It serves
# the built dist/ *and* the API/MCP/OAuth routes *and* the SQLite database,
# all from one process. See compose.yml's comment on why this app has a
# backend at all now, when it didn't before.
FROM node:24-alpine AS runtime

WORKDIR /app

# A second, production-only install — the build stage's node_modules carries
# vite/vitest/React's whole dev toolchain, none of which this stage needs.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# server/ and scripts/ run unbundled, straight through Node's native
# TypeScript support (see server/index.ts's own comment on why there's no
# compile step for them) — so the image needs their actual source, not
# built output. src/lib/ comes along too: server/queries.ts and
# server/mcp.ts reuse several of its pure functions and types directly (see
# their own comments) instead of duplicating scoring/coaching logic
# server-side. Nothing else under src/ (components, App.tsx) is ever
# imported from server code.
COPY server ./server
COPY scripts ./scripts
COPY src/lib ./src/lib
COPY --from=build /app/dist ./dist

# Belt-and-suspenders for a bare `docker run` with no bind mount — compose.yml
# mounts the real ./data over this and hub's deploy workflow creates that
# mount point as uid 1000 before the container ever starts (see its
# docs/new-project.md), which is what actually matters in production.
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.ts"]
