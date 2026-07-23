# Build stage — install native deps (sqlite3 requires compilation on Alpine)
FROM node:18-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN apk add --no-cache python3 make g++ gcc musl-dev && \
    npm ci --omit=dev

# Runtime stage
FROM node:18-alpine
RUN apk add --no-cache sqlite

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

VOLUME ["/data"]
EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
