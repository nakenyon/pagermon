#!/bin/sh
set -e

# Initialize config from defaults on first boot
if [ ! -f /data/config.json ]; then
    cp /app/config/default.json /data/config.json
fi

# Re-apply env var overrides on every boot, so compose changes always take
# effect instead of only being read once on first boot
node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('/data/config.json', 'utf8'));
if (process.env.PAGERMON_SERVER)     config.hostname   = process.env.PAGERMON_SERVER;
if (process.env.PAGERMON_API_KEY)    config.apikey     = process.env.PAGERMON_API_KEY;
if (process.env.PAGERMON_IDENTIFIER) config.identifier = process.env.PAGERMON_IDENTIFIER;
fs.writeFileSync('/data/config.json', JSON.stringify(config, null, 2));
"

# Link the volume config into the app config directory
rm -f /app/config/config.json
ln -sf /data/config.json /app/config/config.json

######################################################################
# rtl_fm env vars
#   RTL_FREQ      -f  frequency to tune to, e.g. 460.400M      (default: 453.600M)
#   RTL_DEVICE    -d  dongle index (0, 1, ...) or serial string (default: 0)
#   RTL_SQUELCH   -l  squelch level, 0 disables                (default: 0)
#   RTL_GAIN      -g  tuner gain in dB                         (default: unset -> automatic gain)
#   RTL_PPM       -p  ppm frequency correction                 (default: unset -> 0)
#   RTL_BIAS_TEE      "true" enables bias-T power (-T) for powered antennas (default: unset -> off)
#   RTL_FM_EXTRA_ARGS any additional raw rtl_fm flags, space-separated, appended verbatim
######################################################################
run_rtl_fm() {
    FREQ="${RTL_FREQ:-453.600M}"
    DEVICE="${RTL_DEVICE:-0}"
    SQUELCH="${RTL_SQUELCH:-0}"

    set -- -d "$DEVICE" -E dc -F 0 -l "$SQUELCH" -A fast -f "$FREQ" -s22050
    [ -n "$RTL_GAIN" ] && set -- "$@" -g "$RTL_GAIN"
    [ -n "$RTL_PPM" ] && set -- "$@" -p "$RTL_PPM"
    [ "$RTL_BIAS_TEE" = "true" ] && set -- "$@" -T
    [ -n "$RTL_FM_EXTRA_ARGS" ] && set -- "$@" $RTL_FM_EXTRA_ARGS
    set -- "$@" -

    rtl_fm "$@"
}

######################################################################
# multimon-ng env vars
#   MULTIMON_PROTOCOL    -a  demodulator to enable, e.g. POCSAG1200    (default: POCSAG1200)
#   MULTIMON_B            -b  POCSAG BCH error-correction level, 0 disables (default: 2, multimon-ng's own default)
#   MULTIMON_INVERT       -i  "true" inverts input samples - try this if a signal is present but nothing decodes (default: unset -> off)
#   MULTIMON_HIDE_EMPTY   -e  "false" shows empty POCSAG messages too (default: true)
#   MULTIMON_QUIET         -q  "true" silences the startup banner/demodulator list (default: unset -> off, so `docker logs` shows device/tuner detection)
#   MULTIMON_VERBOSITY    -v  verbosity level, e.g. 1 for decode stats  (default: unset)
#   MULTIMON_EXTRA_ARGS       any additional raw multimon-ng flags, space-separated, appended verbatim
######################################################################
run_multimon() {
    PROTOCOL="${MULTIMON_PROTOCOL:-POCSAG1200}"

    set -- -c -a "$PROTOCOL" -f alpha -t raw
    [ -n "$MULTIMON_B" ] && set -- "$@" -b "$MULTIMON_B"
    [ "$MULTIMON_INVERT" = "true" ] && set -- "$@" -i
    [ "${MULTIMON_HIDE_EMPTY:-true}" = "true" ] && set -- "$@" -e
    [ "$MULTIMON_QUIET" = "true" ] && set -- "$@" -q
    [ -n "$MULTIMON_VERBOSITY" ] && set -- "$@" -v "$MULTIMON_VERBOSITY"
    [ -n "$MULTIMON_EXTRA_ARGS" ] && set -- "$@" $MULTIMON_EXTRA_ARGS
    set -- "$@" /dev/stdin

    multimon-ng "$@"
}

run_rtl_fm | run_multimon | node reader.js
