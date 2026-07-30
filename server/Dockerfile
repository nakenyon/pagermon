# Build stage — install native deps (sqlite3 requires compilation on Alpine)
FROM node:18-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# py3-setuptools is required, not optional: node-gyp 8.x (bundled with Node 18's
# npm) imports distutils, which Python 3.12 removed per PEP 632. setuptools
# vendors it back. Without this the sqlite3 build fails with
# "ModuleNotFoundError: No module named 'distutils'" on any base image whose
# Alpine release ships Python >= 3.12 - which node:18-alpine already does on
# linux/arm/v7, and will eventually on the other architectures too.
RUN apk add --no-cache python3 py3-setuptools make g++ gcc musl-dev && \
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
