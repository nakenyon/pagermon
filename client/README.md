# PagerMon-Client

Client component of the PagerMon server.

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

* [nodejs](https://nodejs.org/)
* [rtl_fm](https://github.com/osmocom/rtl-sdr)
* or [keenard's fork of rtl_fm](https://github.com/keenerd/rtl-sdr)
* [multimon-ng](https://github.com/EliasOenal/multimon-ng)

### Installing

```
cd client
npm install
cp config/default.json config/config.json
```

Edit config/config.json to suit your environment. Identifier should be a small string that will show up in the 'source' column of the messages display.

Some environments send additional information via the "Function Code" in the pager message. Change `sendFunctionCode` to `true` to send this appended to the end of the address of each message. E.g. `POCSAG512: Address: 1000022  Function: 3  Alpha: test` would land on the server with an address of `10000223`.

Some environments prepend pager messages with a timestamp - by default reader.js will trim these from the message and use them as the timestamp for the message. If you do not wish for this to happen, set `useTimestamp` to `false`. Only a limited type of timestamps are currently supported - if you wish to add a time format, submit an issue with some example messages.

Check the samples dir for example usage.

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

If a signal is clearly present at the configured frequency (confirm with
`rtl_power`) but nothing ever decodes, check in this order: frequency/protocol
match the actual system, `RTL_GAIN`/`RTL_SQUELCH` aren't cutting off real
signal, then try `MULTIMON_INVERT=true`.

### Import.js

The `import.js` script can be used to import capcode aliases from PDW filters.ini or a generic CSV file.

Usage: 
    `cat filters.ini | node import.js --pdw`
    `cat aliases.csv | node import.js`

CSV must have columns in any order of the following: 
    `id,address,alias,agency,color,icon,ignore,pluginconf`

Only address, alias, and agency are mandatory. The file should have column headers. E.g.:

```
alias,address,something,color,agency,junk
Warringah - UNID,1370%,words,darkgreen,RFS,description or something that isnt imported
```


## Contributing

All are welcome to contribute.

## Versioning

We use [SemVer](http://semver.org/) for versioning. For the versions available, see the [tags on this repository](https://github.com/davidmckenzie/pagermon/tags). 

## Authors

See the list of [contributors](https://github.com/davidmckenzie/pagermon/contributors) who participated in this project.

## License

This project is licensed under The Unlicense - because fuck licenses. Do what you want with it. :>

## Acknowledgments

* multimon-ng
