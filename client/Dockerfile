# node:18-bookworm-slim gives us Node 18 on Debian, where multimon-ng is packaged
FROM node:18-bookworm-slim

# Debian's packaged librtlsdr is the old upstream driver and doesn't know about
# RTL-SDR Blog dongles (V3/V4 - R820T2/R828D tuners): it can still open the
# device and stream samples, but without the Blog-specific tuner init/gain
# tables it silently produces signal too degraded to demodulate, with no
# errors anywhere. Build osmocom/rtl-sdr from source instead - Blog V4
# support (RTLSDRBlog/Blog V4 dongle-model detection, R828D tuner) landed in
# commit 1261fbb and is included as of the v2.0.2 release tag. Pinned to
# that exact commit rather than tracking master, since this fork's history
# has diverged enough from upstream pagermon that we won't be rebasing to
# pick up upstream rtl-sdr driver changes - if V4 support is ever dropped or
# broken upstream, pinning is what protects us from silently building it.
# See https://www.rtl-sdr.com/V4/
ARG RTL_SDR_REF=d9a4082f00f2cdbdf454dad820c2607462d70aea
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates build-essential cmake git libusb-1.0-0-dev pkg-config \
    multimon-ng \
    && git clone https://github.com/osmocom/rtl-sdr /tmp/rtl-sdr \
    && cd /tmp/rtl-sdr && git checkout "$RTL_SDR_REF" && mkdir build && cd build \
    && cmake ../ -DINSTALL_UDEV_RULES=ON \
    && make -j"$(nproc)" && make install && ldconfig \
    && cd / && rm -rf /tmp/rtl-sdr \
    && apt-get purge -y --auto-remove build-essential cmake git pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

VOLUME ["/data"]

ENTRYPOINT ["/docker-entrypoint.sh"]
