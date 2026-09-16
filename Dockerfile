FROM node:24.19.0-bookworm-slim AS build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /suite
RUN npm install --global pnpm@12.4.1
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm typecheck && pnpm lint && pnpm --filter @suite/api build && pnpm --filter @suite/worker build && pnpm --filter @suite/web build

FROM node:24.19.0-bookworm-slim AS api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310
WORKDIR /suite
COPY --from=build --chown=node:node /suite/apps/api/dist ./dist
USER node
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4310/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","dist/main.mjs"]

FROM node:24.19.0-bookworm-slim AS worker
ENV NODE_ENV=production
WORKDIR /suite
COPY --from=build --chown=node:node /suite/apps/worker/dist ./dist
USER node
CMD ["node","dist/main.mjs"]

FROM nginx:stable-alpine@sha256:dc5069ad14f19660b141b21236140b91656bf89bbc3e2417c70ae650cd66104c AS web
COPY --from=build /suite/apps/web/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
