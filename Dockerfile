ARG NODE_IMAGE=public.ecr.aws/docker/library/node:22-alpine

# --- Build Stage ---
FROM ${NODE_IMAGE} AS build
WORKDIR /app

RUN npm install -g npm@11.21.1

# Copy all files
COPY . .

# Install dependencies without premature lifecycle scripts
RUN npm install --ignore-scripts

# Explicitly download @types/node
RUN npm install @types/node --no-save --ignore-scripts

# Copy @types/node into every package so TypeScript finds it directly
RUN for p in packages/*; do mkdir -p "$p/node_modules/@types" && cp -r node_modules/@types/node "$p/node_modules/@types/"; done

# Build the 3 shared packages, then compile the backend directly
RUN npm run build:packages && npx tsc -p tsconfig.build.json

# Remove development dependencies
RUN npm prune --omit=dev --ignore-scripts

# --- Production Stage ---
FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app

# Copy production node_modules, package.json, dist, and packages
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/packages ./packages

# Create media directory and set permissions
RUN mkdir -p /app/var/media && chown -R node:node /app/var

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/health || exit 1

CMD ["node", "dist/server.js"]
