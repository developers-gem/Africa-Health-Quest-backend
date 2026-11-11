ARG NODE_IMAGE=public.ecr.aws/docker/library/node:22-alpine

# --- Build Stage ---
FROM ${NODE_IMAGE} AS build
WORKDIR /app

RUN npm install -g npm@11.21.1

# Copy package.json
COPY package*.json ./

# Install dependencies with npm install (since package-lock.json is not present)
RUN npm install

# Copy the source code and configuration files
COPY . .

# Build TypeScript
RUN npm run build

# Remove development dependencies
RUN npm prune --omit=dev --ignore-scripts

# --- Production Stage ---
FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app

# Copy production node_modules and built dist folder
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist

# Create storage directory
RUN mkdir -p /app/var/media && chown -R node:node /app/var

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/health || exit 1

CMD ["node", "dist/server.js"]
# Production image for the backend. Build from the repository root:
#   docker build -f apps/backend/Dockerfile -t ahq-backend .
ARG NODE_IMAGE=public.ecr.aws/docker/library/node:22-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /repo
RUN npm install -g npm@11.21.1
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/api-contracts/package.json packages/api-contracts/
COPY packages/game-content/package.json packages/game-content/
COPY apps/backend/package.json apps/backend/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts --workspace @ahq/backend --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared-types packages/shared-types
COPY packages/api-contracts packages/api-contracts
COPY packages/game-content packages/game-content
COPY apps/backend apps/backend
RUN npm run build -w @ahq/shared-types && npm run build -w @ahq/api-contracts \
 && npm run build -w @ahq/game-content && npm run build -w @ahq/backend \
 && npm prune --omit=dev --ignore-scripts --workspace @ahq/backend

FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared-types/package.json ./node_modules/@ahq/shared-types/package.json
COPY --from=build /repo/packages/shared-types/dist ./node_modules/@ahq/shared-types/dist
COPY --from=build /repo/packages/api-contracts/package.json ./node_modules/@ahq/api-contracts/package.json
COPY --from=build /repo/packages/api-contracts/dist ./node_modules/@ahq/api-contracts/dist
COPY --from=build /repo/packages/game-content/package.json ./node_modules/@ahq/game-content/package.json
COPY --from=build /repo/packages/game-content/dist ./node_modules/@ahq/game-content/dist
COPY --from=build /repo/apps/backend/package.json ./package.json
COPY --from=build /repo/apps/backend/dist ./dist
RUN mkdir -p /app/var/media && chown -R node:node /app/var
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "dist/server.js"]
