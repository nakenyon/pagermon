# node:18-bookworm-slim gives us Node 18 on Debian, where rtl-sdr and multimon-ng are packaged
FROM node:18-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    rtl-sdr \
    multimon-ng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY . .

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

VOLUME ["/data"]

ENTRYPOINT ["/docker-entrypoint.sh"]
