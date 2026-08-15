# TETHER — multi-stage Docker build.
# Stage 1 (verify): bundle + validate + fuzz + solve + determinism. If any gate
# fails, the image build fails and Dokploy never deploys it.
# Stage 2 (serve): nginx serves public/ only — no Node in the final image.

# ---- Stage 1: verification gate ----
FROM node:20-alpine AS verify
WORKDIR /build
COPY package.json ./
COPY public ./public
COPY levels ./levels
COPY tools ./tools
COPY tests ./tests
# `npm run verify` = bundle && validate && headless && solve && determinism && test
RUN npm run verify

# ---- Stage 2: static serving ----
FROM nginx:1.27-alpine AS serve
COPY --from=verify /build/public /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ || exit 1
