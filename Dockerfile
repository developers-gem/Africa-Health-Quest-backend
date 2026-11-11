ARG NODE_IMAGE=public.ecr.aws/docker/library/node:22-alpine

# --- Build Stage ---
FROM ${NODE_IMAGE} AS build
WORKDIR /app

RUN npm install -g npm@11.21.1

# Copy everything including the packages/ folder
COPY . .

# Install dependencies (npm workspaces will link local packages automatically)
RUN npm install

# Build the shared packages first, then the backend
RUN npm run build --workspaces --if-present && npm run build

# Prune dev dependencies for production
RUN npm prune --omit=dev --ignore-scripts

# --- Production Stage ---
FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app

# Copy production node_modules, package.json, compiled dist, and built packages
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/packages ./packages

# Create storage directory and set permissions
RUN mkdir -p /app/var/media && chown -R node:node /app/var

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/health || exit 1

CMD ["node", "dist/server.js"]
