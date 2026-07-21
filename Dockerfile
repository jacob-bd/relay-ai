# Relay AI Server + Admin UI — container-friendly (env + files, no OS keychain).
# Build:  docker build -t relay-ai .
# Run:    see docs/DOCKER.md / docker-compose.yml

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsup.config.ts ./
COPY src ./src
COPY assets ./assets
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV RELAY_AI_HOME=/data
ENV RELAY_AI_UI_MODE=server
ENV RELAY_AI_UI_PORT=8787

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 8787 17645
VOLUME ["/data"]

ENTRYPOINT ["node", "dist/cli.js"]
# Admin UI (providers / favorites / gateway). Start the API from the Server tab.
CMD ["ui", "--server"]
