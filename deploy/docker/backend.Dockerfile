FROM node:22.19.0-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22.19.0-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production PORT=4173
COPY package.json package-lock.json ./
# The CLI ships as a stub plus platform-native optional deps; prune the unused platform copies, then keep a version gate so a stub cannot ship and break every Agent run.
RUN npm ci --omit=dev \
    && npm prune --omit=dev --omit=optional \
    && node_modules/@anthropic-ai/claude-code/bin/claude.exe --version \
    && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
USER node
EXPOSE 4173
CMD ["node", "server/local.mjs"]
