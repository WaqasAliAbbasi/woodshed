# Build the static Vite app, then serve it from Caddy. No runtime dependencies,
# no state, so a distroless-style two-stage build is all there is to it.
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

FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /usr/share/caddy