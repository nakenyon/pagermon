#!/bin/sh
set -e

# Initialize config from defaults on first boot
if [ ! -f /data/config.json ]; then
    node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('/app/config/default.json', 'utf8'));
fs.writeFileSync('/data/config.json', JSON.stringify(config, null, 2));
console.log('Initialized /data/config.json from defaults');
"
fi

# Force the DB path to the volume on every boot, not just first boot - a
# config.json supplied/copied in from elsewhere (a different install, an
# older image version) may point database.file somewhere else entirely,
# in which case sqlite silently opens that path instead (resolved against
# WORKDIR if relative), ignoring whatever messages.db actually sits in
# the mounted volume.
node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('/data/config.json', 'utf8'));
config.database.file = '/data/messages.db';
fs.writeFileSync('/data/config.json', JSON.stringify(config, null, 2));
"

# Link the volume config into the app config directory
rm -f /app/config/config.json
ln -sf /data/config.json /app/config/config.json

exec node app.js
