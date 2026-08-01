# PagerMon-Client

Client component of the PagerMon server. It reads demodulated pager traffic from
`rtl_fm` piped through `multimon-ng` and posts decoded messages to a PagerMon
server.

> **Most of this fork was written by an AI agent.** The containerization and the
> environment-variable configuration described below were produced by Claude working
> in this repository under human direction. Upstream
> [PagerMon](https://github.com/pagermon/pagermon) is the work of its human authors.
> See the [root README](../README.md#about-this-fork).

This fork runs the client in a container. There are no bare-metal instructions here
— for the traditional `npm install` and hand-edited `reader.sh` setup, use
[upstream](https://github.com/pagermon/pagermon).

### Behaviour worth knowing

Identifier should be a small string that will show up in the 'source' column of the messages display.

Some environments send additional information via the "Function Code" in the pager message. Change `sendFunctionCode` to `true` to send this appended to the end of the address of each message. E.g. `POCSAG512: Address: 1000022  Function: 3  Alpha: test` would land on the server with an address of `10000223`.

Some environments prepend pager messages with a timestamp - by default reader.js will trim these from the message and use them as the timestamp for the message. If you do not wish for this to happen, set `useTimestamp` to `false`. Only a limited type of timestamps are currently supported - if you wish to add a time format, submit an issue with some example messages.

These live in `config.json` inside the container's `/data` volume; the three
connection settings below are applied over it from the environment on every boot.

### Running in Docker

The client image builds `rtl_fm` and `multimon-ng` from source (not the
Debian-packaged `rtl-sdr`, which doesn't include RTL-SDR Blog V3/V4 dongle
support) and drives them entirely through environment variables - no config
file editing needed for the radio side. See `docker-compose.yml` for a
working example.

**PagerMon connection**

| Variable              | Maps to             | Default   |
|------------------------|--------------------|-----------|
| `PAGERMON_SERVER`      | `config.hostname`   | -         |
| `PAGERMON_API_KEY`     | `config.apikey`     | -         |
| `PAGERMON_IDENTIFIER`  | `config.identifier` | -         |

**Timezone**

| Variable | Meaning | Default |
|----------|---------|---------|
| `TZ`     | Container timezone, e.g. `America/Chicago` | UTC |

Set this to the timezone your pager network transmits in. It is not cosmetic:
when `useTimestamp` is enabled (the default), `reader.js` parses a timestamp
embedded in the pager message with `moment()` — which interprets it in *local*
time — before converting to an epoch. With `TZ` unset the container runs as UTC,
so those messages are stored shifted by your UTC offset. Messages without an
embedded timestamp are unaffected, since they are stamped on arrival.

**rtl_fm**

| Variable            | Flag | Meaning                                      | Default        |
|----------------------|------|-----------------------------------------------|----------------|
| `RTL_FREQ`          | `-f` | Frequency to tune to, e.g. `460.400M`         | `453.600M`     |
| `RTL_DEVICE`        | `-d` | Dongle index (`0`, `1`, ...) or serial string | `0`            |
| `RTL_SQUELCH`       | `-l` | Squelch level, `0` disables                   | `0`            |
| `RTL_GAIN`          | `-g` | Tuner gain in dB                              | unset (automatic gain) |
| `RTL_PPM`           | `-p` | PPM frequency correction                      | unset (`0`)    |
| `RTL_BIAS_TEE`      | `-T` | `"true"` enables bias-T power for powered antennas | unset (off) |
| `RTL_FM_EXTRA_ARGS` |      | Any extra raw `rtl_fm` flags, space-separated | unset          |

**multimon-ng**

| Variable                | Flag | Meaning                                                        | Default        |
|--------------------------|------|-----------------------------------------------------------------|----------------|
| `MULTIMON_PROTOCOL`     | `-a` | Demodulator to enable, e.g. `POCSAG1200`                        | `POCSAG1200`   |
| `MULTIMON_B`            | `-b` | POCSAG BCH error-correction level, `0` disables                | `2`            |
| `MULTIMON_INVERT`       | `-i` | `"true"` inverts input samples - try this if a signal is present but nothing decodes | unset (off) |
| `MULTIMON_HIDE_EMPTY`   | `-e` | `"false"` shows empty POCSAG messages too                       | `true`         |
| `MULTIMON_QUIET`        | `-q` | `"true"` silences the startup banner/demodulator list           | unset (off, so `docker logs` shows device/tuner detection at boot) |
| `MULTIMON_VERBOSITY`    | `-v` | Verbosity level, e.g. `1` for decode stats                      | unset          |
| `MULTIMON_EXTRA_ARGS`   |      | Any extra raw `multimon-ng` flags, space-separated              | unset          |

**Running several demodulators at once:** `MULTIMON_PROTOCOL` emits a single `-a`
flag. If you don't know a system's baud rate, enable more through the raw-args
escape hatch:

```
MULTIMON_PROTOCOL=POCSAG512
MULTIMON_EXTRA_ARGS=-a POCSAG1200 -a POCSAG2400
```

If a signal is clearly present at the configured frequency (confirm with
`rtl_power`) but nothing ever decodes, check in this order: frequency/protocol
match the actual system, `RTL_GAIN`/`RTL_SQUELCH` aren't cutting off real
signal, then try `MULTIMON_INVERT=true`.

### Import.js

The `import.js` script can be used to import capcode aliases from PDW filters.ini or a generic CSV file. Run it inside the client container:

Usage:
    `docker compose exec -T pagermon-client1 node import.js --pdw < filters.ini`
    `docker compose exec -T pagermon-client1 node import.js < aliases.csv`

CSV must have columns in any order of the following: 
    `id,address,alias,agency,color,icon,ignore,pluginconf`

Only address, alias, and agency are mandatory. The file should have column headers. E.g.:

```
alias,address,something,color,agency,junk
Warringah - UNID,1370%,words,darkgreen,RFS,description or something that isnt imported
```


## Contributing

Contributors should submit a pull request against `main`. See the
[root README](../README.md#contributing).

## Versioning

This fork uses CalVer, tagged `vYYYY.M.D` — see the
[tags on this repository](https://github.com/nakenyon/pagermon/tags) and the
[root README](../README.md#versioning) for the release process.

## Authors

PagerMon was originally written by [Dave McKenzie](https://github.com/davidmckenzie)
and built by upstream's
[contributors](https://github.com/pagermon/pagermon/graphs/contributors). This fork
adds containerization on top of their work.

## License

This project is licensed under The Unlicense - because fuck licenses. Do what you want with it. :>

## Acknowledgments

* [multimon-ng](https://github.com/EliasOenal/multimon-ng)
* [osmocom/rtl-sdr](https://github.com/osmocom/rtl-sdr)
