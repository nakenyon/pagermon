# node:18-bookworm-slim gives us Node 18 on Debian, where multimon-ng is packaged
FROM node:18-bookworm-slim

# Debian's packaged librtlsdr is the old upstream driver and doesn't know about
# RTL-SDR Blog dongles (V3/V4 - R820T2/R828D tuners): it can still open the
# device and stream samples, but without the Blog-specific tuner init/gain
# tables it silently produces signal too degraded to demodulate, with no
# errors anywhere. Build the current osmocom/rtl-sdr driver from source
# instead - Blog V4 support was upstreamed there. See https://www.rtl-sdr.com/V4/
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git libusb-1.0-0-dev pkg-config \
    multimon-ng \
    && git clone https://github.com/osmocom/rtl-sdr /tmp/rtl-sdr \
    && cd /tmp/rtl-sdr && mkdir build && cd build \
    && cmake ../ -DINSTALL_UDEV_RULES=ON \
    && make -j"$(nproc)" && make install && ldconfig \
    && cd / && rm -rf /tmp/rtl-sdr \
    && apt-get purge -y --auto-remove build-essential cmake git pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY . .

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

VOLUME ["/data"]

ENTRYPOINT ["/docker-entrypoint.sh"]
