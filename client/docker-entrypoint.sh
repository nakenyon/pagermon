#!/bin/sh
set -e

# Initialize config from defaults on first boot, applying env var overrides
if [ ! -f /data/config.json ]; then
    node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('/app/config/default.json', 'utf8'));
if (process.env.PAGERMON_SERVER)     config.hostname   = process.env.PAGERMON_SERVER;
if (process.env.PAGERMON_API_KEY)    config.apikey     = process.env.PAGERMON_API_KEY;
if (process.env.PAGERMON_IDENTIFIER) config.identifier = process.env.PAGERMON_IDENTIFIER;
fs.writeFileSync('/data/config.json', JSON.stringify(config, null, 2));
console.log('Initialized /data/config.json from defaults');
"
fi

# Link the volume config into the app config directory
rm -f /app/config/config.json
ln -sf /data/config.json /app/config/config.json

FREQ="${RTL_FREQ:-453.600M}"
GAIN="${RTL_GAIN:-28}"
SQUELCH="${RTL_SQUELCH:-2}"
DEVICE="${RTL_DEVICE:-0}"
PROTOCOL="${MULTIMON_PROTOCOL:-POCSAG1200}"

rtl_fm -d "$DEVICE" -E dc -F 0 -g "$GAIN" -l "$SQUELCH" -A fast -f "$FREQ" -s22050 - 2>/dev/null | \
    multimon-ng -q -b1 -c -a "$PROTOCOL" -f alpha -t raw /dev/stdin 2>/dev/null | \
    node reader.js
