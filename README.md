# [PagerMon](https://hrng.io/)
![Discord](https://img.shields.io/discord/533900375066017812.svg?style=plastic)
![GitHub issues](https://img.shields.io/github/issues-raw/pagermon/pagermon.svg?style=plastic)
![GitHub pull requests](https://img.shields.io/github/issues-pr/pagermon/pagermon.svg?style=plastic)
![GitHub](https://img.shields.io/github/license/pagermon/pagermon.svg?style=plastic)
![GitHub stars](https://img.shields.io/github/stars/pagermon/pagermon.svg?style=plastic)
![GitHub forks](https://img.shields.io/github/forks/pagermon/pagermon.svg?style=plastic)
![GitHub tag (latest SemVer)](https://img.shields.io/github/tag/pagermon/pagermon.svg?label=release&style=plastic)
![GitHub commit activity](https://img.shields.io/github/commit-activity/m/pagermon/pagermon.svg?style=plastic)
![GitHub contributors](https://img.shields.io/github/contributors/pagermon/pagermon.svg?style=plastic)
![GitHub Workflow Status (branch)](https://img.shields.io/github/actions/workflow/status/pagermon/pagermon/server.js.yml?branch=master&label=Build%20master)
![GitHub Workflow Status (branch)](https://img.shields.io/github/actions/workflow/status/pagermon/pagermon/server.js.yml?branch=develop&label=Build%20develop)

PagerMon is an API driven client/server framework for parsing and displaying pager messages from multimon-ng.

It is built around POCSAG messages, but should easily support other message types as required.

The UI is built around a Node/Express/Angular/Bootstrap stack, while the client scripts are Node scripts that receive piped input.

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
* Pretty HTML5
* Native browser notifications
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
* May or may not contain cute puppies

### Planned Features

* Horizontal scaling
* Enhanced message filtering
* Bootstrap 4 + Angular 2 support
* Enhanced alias control
* Graphing

### Screenshots

![main view](http://i.imgur.com/QWKoJjb.jpeg)

![desktop view](http://i.imgur.com/Zik74Dl.jpeg)

![alias edit](http://i.imgur.com/gus8QTe.jpeg)

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

* [nodejs](https://nodejs.org/) 12.x or higher
* sqlite3
* Probably some other stuff

#### Recommended

* [nvm](https://github.com/creationix/nvm#installation)
* nginx or some kind of reverse proxy for SSL offloading

## Running the server

### Local setup

1) Copy server/process-default.json to server/process.json and modify according to your environment
2) Launch the app from the Terminal:

```
    $ sudo apt-get install npm sqlite3
    $ npm install npm@latest -g
    $ npm install pm2 -g
    $ cd server
    $ npm install
    $ export NODE_ENV=production
    $ pm2 start process.json
```
3) To start on boot, let pm2 handle it:
```
    $ sudo pm2 startup
    $ pm2 save
```
4) You probably want to rotate logs, too:
```
    $ pm2 install pm2-logrotate
    $ sudo pm2 logrotate -u user
```
5) Now login via the website, default port is 3000, default credentials are 'admin' / 'changeme'
6) Head to /admin, change your password, and generate some API keys
6) Grab your API keys and drop them in the PagerMon client, then you're good to go!

Alternatively a production ready setup guide is available here
https://github.com/pagermon/pagermon/wiki/Tutorial---Production-Ready-Ubuntu,-PM2,-Nginx-Reverse-Proxy,-Let's-Encrypt-SSL,-Pagermon-server

### Docker

This fork ships a `docker-compose.yml` that runs the server and client as
separate containers, each with their own image (`server/Dockerfile` and
`client/Dockerfile`). Prebuilt multi-arch images are also published to
GHCR on every push - see `.github/workflows/docker-publish.yml`.

#### Quick start

``` bash
cp .env.example .env
# edit .env: set API keys, RTL frequencies/device indices, TZ, etc.

docker compose up -d --build
```

This starts two full server+client pairs (`pagermon-server1`/`pagermon-client1`
and `pagermon-server2`/`pagermon-client2`) as a template for running multiple
RTL-SDR dongles/frequencies against separate PagerMon instances on one host.
Delete the second pair if you only need one instance, or copy the block again
for a third.

- Server data (config, sqlite db) persists in `./data/server<N>`.
- The client needs the RTL-SDR USB dongle passed through via `devices:` -
  see `client/README.md` for all of the `RTL_*`/`MULTIMON_*` environment
  variables and what `rtl_fm`/`multimon-ng` flags they map to.
- After the server is up, log in at `http://localhost:<port>` (default
  `admin` / `changeme`), change the password, and generate an API key under
  `/admin/settings` - that's the value that goes in `.env` as `API_KEY1`
  (must match what the corresponding client sends as `PAGERMON_API_KEY`).

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

#### Migrating an existing bare-metal install

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

## Running the client

### Local setup


#### Prerequisites
These programs/libraries are required for Pagermon Client to work

* [RTL-SDR](https://www.rtl-sdr.com/rtl-sdr-quick-start-guide/) - RTL-SDR tools/libraries to access RTL-SDR dongle
* [RTL-SDR dongle](https://www.rtl-sdr.com/buy-rtl-sdr-dvb-t-dongles/)  - You can get these from Ebay, Amazon or other stores (Has to have RTL2832U chip)
* [nodejs](https://nodejs.org/en/) - JavaScript Programming Language (Only if installing separate from server)
* [npm](https://www.npmjs.com/) - Javascript Package Manager (Only if installing separate from server)
* [Git Client](https://git-scm.com/) - Github.com client for getting source code (Only if installing separate from server) 

To install the Prerequisites run
`sudo apt install nodejs npm git rtl-sdr`

#### Installing Pagermon Client
Run the following commands from Terminal:
```
git clone https://github.com/pagermon/pagermon.git
cd pagermon/client
npm install
```
edit `reader.sh` and edit frequency and rtl_device number, Edit Multimon-ng command
```Bash
rtl_fm -d 0 -E dc -F 0 -A fast -f 148.5875M -s22050 - |
multimon-ng -q -b1 -c -a POCSAG512 -f alpha -t raw /dev/stdin |
node reader.js
```
`-d 0` - change this to your rtl_device number using rtl_test

`-f 148.5875M` - change this to the frequency you are decoding

#### Multimon-ng Command examples
##### POCSAG
> multimon-ng -q -b1 -c -a POCSAG512 -f alpha -t raw /dev/stdin

##### FLEX
>  multimon-ng -a FLEX -t raw /dev/stdin

##### EAS
> multimon-ng -a EAS -t raw /dev/stdin


#### Configuring Pagermon Client
Before running Pagermon Client you have to configure it to send the decoded info to the pagermon server.

copy default.json to config.json 
```
cp config/default.json config/config.json 
```

Edit config.json with your favorite editor
```
{
  "apikey": "changeme",
  "hostname": "http://127.0.0.1:3000",
  "identifier": "TEST",
  "sendFunctionCode": false,
  "useTimestamp": true,
  "EAS": {
    "excludeEvents": [],
    "includeFIPS": [],
    "addressAddType": true
  }
}

```

#### Pager Options

**apikey:**  This is the API key generate on the Pagermon Server http://serverip/admin/settings

**hostname:** The host name or IP of the Pagermon server (If you run Pagermon Server and Client on same PC then you can put this as `http://127.0.0.1:3000`

**identifier:** This will show up in the source column on the server web page good for when you have multiple sources and want to know which one the pager message is coming from

**sendFunctionCode:** This will appand the function code to the address of the message **true** or **false**

**useTimestamp:** This will use the time in the message **true** or **false**

#### EAS Options
**excludeEvents:** Allows a list of [Events](https://github.com/MaxwellDPS/jsame#event-codes) to exclude ie `["RWT","RMT","SVA"]`

**includeFIPS:** Allows you to filter on a list of FIPS to alert on ie `["031109", "031000"]`

**addressAddType:** Will append the event code to the address so `KOAX-WXR` would become KOAX-WXR-W for `ZCZC-WXR-TOR-031109+0015-3650000-KOAX/NWS -` **true** or **false**


## PagermonPi - Raspberry Pi Image
Check out our Raspberry Pi Image for Pi3 & Pi4 which has Pagermon pre-loaded on it.

Check out the following links:

[Releases](https://github.com/pagermon/pagermon/releases) for the latest version
[Wiki](https://github.com/pagermon/pagermon/wiki/PagermonPi-Image-For-Raspberry-Pi) for PagermonPi support

## Support

General PagerMon support can be requested in the #support channel of the PagerMon discord server.

[Click Here](https://discord.gg/3VK7gSD) to join

Bugs and Feature requests can be logged via the GitHub issues page. 

## Contributing

All are welcome to contribute. Contributors should submit a pull request with the requested changes.

CHANGELOG.md is to be updated on each pull request.

If a pull request is the first pull request since a [release](https://github.com/pagermon/pagermon/releases), then the version number should be bumped in `CHANGELOG.md`, `server/app.js`, and `server/package.json`.

If a database schema change is required, this must be done using KnexJS Migration files. **Insert Instructions for this here**

## Versioning

We use [SemVer](http://semver.org/) for versioning. For the versions available, see the [tags on this repository](https://github.com/pagermon/pagermon/tags).

## Authors

See the list of [contributors](https://github.com/pagermon/pagermon/contributors) who participated in this project.

## License

This project is licensed under The Unlicense - because fuck licenses. Do what you want with it. :>

## Acknowledgments

* [multimon-ng](https://github.com/EliasOenal/multimon-ng)
* [jSAME](https://github.com/MaxwellDPS/jsame)
