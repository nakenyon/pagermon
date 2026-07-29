# PagerMon (dockerized fork)

> **Most of this fork was written by an AI agent.** The containerization, CI
> pipeline, added themes, announcement banner and recent bug fixes were produced by
> Claude working in this repository under human direction. Upstream
> [PagerMon](https://github.com/pagermon/pagermon) — the application itself — is the
> work of its human authors. See [About this fork](#about-this-fork).

![Tests](https://img.shields.io/github/actions/workflow/status/nakenyon/pagermon/tests.yml?branch=main&label=Tests)
![Images](https://img.shields.io/github/actions/workflow/status/nakenyon/pagermon/docker-publish.yml?branch=main&label=Images)
![License](https://img.shields.io/github/license/nakenyon/pagermon.svg?style=flat)

PagerMon is an API driven client/server framework for parsing and displaying pager
messages from multimon-ng.

It is built around POCSAG messages, but should easily support other message types as
required.

The UI is built around a Node/Express/Angular/Bootstrap stack, while the client
scripts are Node scripts that receive piped input.

This fork packages it to run entirely in containers. There are no bare-metal
instructions here — if you want the traditional `npm install` / `pm2` setup, use
[upstream](https://github.com/pagermon/pagermon).

## About this fork

Upstream PagerMon has not cut a release since 0.3.13 in September 2023. This fork
exists to run it in Docker, and diverged far enough along the way to be worth
describing honestly.

**Produced by an AI agent**, under human review and direction:

* Server and client Docker images, and the compose setup that runs them
* The client image building `rtl_fm` from current osmocom/rtl-sdr sources rather
  than Debian's packaged librtlsdr, which silently produces undemodulatable signal
  on RTL-SDR Blog V3/V4 dongles
* Driving the whole radio chain from environment variables instead of a hand-edited
  shell script
* CI: per-image path filtering, tag-driven releases, CalVer versioning
* Two extra themes, and the announcement banner feature across all four
* Reviving the server test suite (it had never been run in this fork) and fixing the
  two real auth bugs it surfaced

**Inherited from upstream**, unchanged in substance: the application itself — the
message pipeline, API, database layer, plugin system, admin UI and the original
themes. That is other people's work, and the large majority of the code here.

If you are evaluating this fork, that distinction matters: the application is
battle-tested software by human authors; the packaging around it is not, and has
been exercised mainly by one deployment.

### Credits

* **[Dave McKenzie](https://github.com/davidmckenzie)** — original author of
  PagerMon (initial commit, June 2017).
* **The upstream [contributors](https://github.com/pagermon/pagermon/graphs/contributors)** —
  Daniel Williams, eopo, Nathanial Marsh, DanrwAU, Maxwell Watermolen and others,
  who built nearly everything this fork runs on.
* **[bullseye555](https://github.com/bullseye555)** — Credit for all of the themes that you see integrated in this fork. 

PagerMon is released into the public domain under the Unlicense, so none of this
attribution is legally required. It is given because it should be.

## Features

* Capcode aliasing with colors and [FontAwesome](https://fontawesome.io/icons/) icons
* API driven extensible architecture
* Multi-user support
* SQLite or MySQL database backing
* Configurable via UI
* Pagination and searching
* Filtering by capcode or agency
* Duplicate message filtering
* Native POCSAG / FLEX / EAS Client Support
* Keyword highlighting
* WebSockets support - messages are delivered to clients in near realtime
* Native browser notifications
* Admin-editable announcement banner, shown on the login page and above the message
  list, with info/warning/critical severities — intended for maintenance windows
* Plugin Support - Current Plugins:
    * [Pushover](https://pushover.net/) near realtime muti-device notification service
    * [Prowl](https://prowlapp.com) near realtime iOS notification service with Apple Watch support
    * [Telegram](https://telegram.org/) near realtime cloud based multi-device messaging
    * [Discord](https://discordapp.com/) near realtime cloud based messaging service
    * [Gotify](https://gotify.net/) Self-Hosted messaging service
    * [Twitter](https://www.twitter.com/)
    * [Microsoft Teams](https://products.office.com/en-us/microsoft-teams/group-chat-software) Team colaboration platform
    * [Slack](https://slack.com/) Team colabortation platform
    * SMTP Email Support for conventional SMTP email notifications
    * Regex Filters - Filter incoming messages via regex
    * Regex Replace - Modify incoming messages via regex
    * Message Repeat - Repeat incoming messages to another pagermon server

### Themes

Four themes ship in the image, selectable under `/admin/settings`:

| Theme | |
|---|---|
| `default` | upstream's original light theme |
| `Dark` | dark treatment of the default layout |
| `Compact Dark` | denser layout, dark |
| `Compact Default` | denser layout, light |

Each theme carries its own copy of `views/global/` and the admin templates, so a
feature added to one has to be added to all four.

### Screenshots

![main view](http://i.imgur.com/QWKoJjb.jpeg)

![desktop view](http://i.imgur.com/Zik74Dl.jpeg)

![alias edit](http://i.imgur.com/gus8QTe.jpeg)

## Running it

### Using the prebuilt images

Multi-arch images are published to GHCR on every build:

```
ghcr.io/nakenyon/pagermon-server
ghcr.io/nakenyon/pagermon-client
```

Tags: `:YYYY.M.D` and `:latest` for releases, `:main` for every trunk build, and
`:sha-xxxxxxx` for any individual commit. **Pin to a release tag** for anything you
care about — `:main` moves whenever trunk does.

A minimal server-only compose file:

```yaml
services:
  pagermon-server:
    image: ghcr.io/nakenyon/pagermon-server:latest
    container_name: pagermon-server
    ports:
      - "3000:3000"
    volumes:
      - ./data/server:/data
    environment:
      - NODE_ENV=production
      - TZ=America/Chicago
    restart: unless-stopped
```

The server keeps its config and sqlite database in `/data`. On first boot it seeds
`config.json` from defaults, and on every boot it repoints `database.file` at
`/data/messages.db` so a config copied in from elsewhere can't silently send it to
the wrong database.

### Building from source

The repo's `docker-compose.yml` builds both images and wires up two full
server+client pairs, as a template for running multiple RTL-SDR dongles against
separate instances on one host:

``` bash
cp .env.example .env
# edit .env: set API keys, RTL frequencies/device indices, TZ, etc.

docker compose up -d --build
```

Delete the second pair if you only need one instance, or copy the block again for a
third.

- Server data (config, sqlite db) persists in `./data/server<N>`.
- The client needs the RTL-SDR USB dongle passed through via `devices:` — see
  [client/README.md](client/README.md) for every `RTL_*`/`MULTIMON_*` environment
  variable and the `rtl_fm`/`multimon-ng` flag it maps to.
- After the server is up, log in at `http://localhost:<port>` (default `admin` /
  `changeme`), change the password, and generate an API key under `/admin/settings`
  — that's the value that goes in `.env` as `API_KEY1` (it must match what the
  corresponding client sends as `PAGERMON_API_KEY`).

``` bash
# Rebuild after pulling changes
docker compose up -d --build

# Follow logs
docker compose logs -f pagermon-server1

# Stop everything
docker compose down
```

**Tip:** you probably want to set up Docker log rotation - see
[here](https://success.docker.com/article/how-to-setup-log-rotation-post-installation).

### Multiple dongles on one host

Each client container needs its own dongle — an RTL-SDR can only be opened by one
process at a time, so two containers pointed at the same `RTL_DEVICE` will leave the
second crash-looping on `usb_claim_interface error -6`.

Dongle indices are assigned by USB enumeration order and can shuffle across reboots.
If your dongles are interchangeable that doesn't matter. If it does, give each one a
unique serial with `rtl_eeprom -s` and use that as `RTL_DEVICE` instead of an index.

### Migrating an existing bare-metal install

To move an existing (non-Docker) server over instead of starting fresh:

1. Stop the bare-metal service.
2. Copy your existing `config/config.json` and `messages.db` into the
   instance's data directory, e.g. `./data/server1/config.json` and
   `./data/server1/messages.db`.
3. `docker compose up -d`.

The entrypoint always repoints `database.file` at `/data/messages.db` on
every boot (regardless of what it was set to in the file you copied in),
so your existing sqlite database is what gets used - nothing gets
silently reset to a fresh one. Everything else in `config.json` (users,
API keys, session secret, plugin settings) carries over as-is.

## Branches

- `main` is the trunk and the default branch. Everything is built and released
  from here.
- `master` is a read-only mirror of upstream `pagermon/pagermon`. Nothing is
  developed on it. To pull upstream changes in, fast-forward `master` from
  `upstream/master`, then merge `master` into `main`.

## Versioning

This fork uses CalVer, tagged `vYYYY.M.D` — upstream has not cut a release since
0.3.13 in September 2023, and this fork has diverged far enough that continuing
its SemVer line would be misleading. See the
[tags on this repository](https://github.com/nakenyon/pagermon/tags).

To cut a release:

```bash
# updates package.json and package-lock.json together - a hand edit desyncs
# them and breaks the npm ci step in tests.yml
cd server && npm version YYYY.M.D --no-git-tag-version && cd ..
cd client && npm version YYYY.M.D --no-git-tag-version && cd ..
# add a section to CHANGELOG.md, commit, then:
git tag -a vYYYY.M.D -m "YYYY.M.D" && git push origin main --follow-tags
```

Write the month and day **unpadded**. `docker/metadata-action` parses the tag as
semver to derive the image tag, and semver forbids leading zeros — `v2026.7.29`
works, `v2026.07.29` fails silently and publishes no version tag at all.

The version is read from `server/package.json` at runtime, so it does not need
bumping anywhere else.

## Support

Bugs and feature requests for **this fork** can be logged via its
[GitHub issues](https://github.com/nakenyon/pagermon/issues).

Please don't take questions about this fork to upstream's community — the
containerization, CI and themes here are not theirs, and they can't support them.
For questions about PagerMon itself, upstream is the right place.

## Contributing

Contributors should submit a pull request against `main`. `CHANGELOG.md` is to be
updated on each pull request.

If a database schema change is required, this must be done using KnexJS Migration
files.

The server test suite runs on Node 18 and is expected to stay green. You don't need
Node installed — run it in the same base image the server is built from:

``` bash
docker run --rm -v "$PWD/server:/app" -w /app node:18-bookworm-slim \
  sh -c 'npm ci && npm run test-text'
```

The tests use their own sqlite database at `server/test/messages.db`. If a run is
interrupted it can leave the knex migration lock set, which shows up as
`Migration table is already locked` on the next run — delete that file to clear it.

## License

This project is licensed under The Unlicense - because fuck licenses. Do what you want with it. :>

## Acknowledgments

* [multimon-ng](https://github.com/EliasOenal/multimon-ng)
* [jSAME](https://github.com/MaxwellDPS/jsame)
* [osmocom/rtl-sdr](https://github.com/osmocom/rtl-sdr)
