#
#	Build & install packages
#
FROM node:22-alpine

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

# 
#	Arguments
#
ARG BUILD_DATE
ARG NODE_ENV
ARG NPM_ARGS
ARG TAG
ARG VCS_REF
ARG VCS_SRC
ARG VERSION

#
#	Labels
#	@see https://github.com/opencontainers/image-spec/blob/master/annotations.md
#	@see https://semver.org/
#
LABEL org.opencontainers.image.authors="PagerMon Team" \
      org.opencontainers.image.created=${BUILD_DATE} \
      org.opencontainers.image.description="PagerMon Server" \
      org.opencontainers.image.documentation="https://github.com/pagermon/pagermon" \
      org.opencontainers.image.revision=${VCS_REF} \
      org.opencontainers.image.source=${VCS_SRC} \
      org.opencontainers.image.title="PagerMon Server" \
      org.opencontainers.image.url="https://github.com/pagermon/pagermon"\
      org.opencontainers.image.vendor="PagerMon Team" \
      org.opencontainers.image.version=${VERSION}

#
#	Environment variables
#	Don't forget to set NODE_ENV
#
ENV APP_NAME=PagerMon \
    APP_VERSION=${VERSION} \
    NODE_ENV=${NODE_ENV:-production}

#
#	Install app in container
#
COPY . .

# TODO: Change to ENV mounts or create config on the fly
RUN cp config/docker-default.json config/config.json

EXPOSE 3000

CMD ["node", "app.js"] 