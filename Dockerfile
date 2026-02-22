FROM node:20-alpine AS builder

# better-sqlite3 needs build tools
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install all dependencies (including devDependencies for build)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Production stage
FROM node:20-alpine

RUN apk add --no-cache python3 make g++ curl

WORKDIR /app

COPY package*.json ./
RUN npm ci --production && \
    apk del python3 make g++

# Copy compiled output and static assets
COPY --from=builder /app/dist ./dist
COPY src/db/schema.sql ./dist/db/schema.sql
COPY src/public/ ./dist/public/

# Create data directory
RUN mkdir -p /app/data && \
    chown -R node:node /app

USER node

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3100/health || exit 1

CMD ["node", "dist/index.js"]
