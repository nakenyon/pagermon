#!/bin/sh
set -e

# Initialize config from defaults on first boot, patching the DB path to the volume
if [ ! -f /data/config.json ]; then
    node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('/app/config/default.json', 'utf8'));
config.database.file = '/data/messages.db';
fs.writeFileSync('/data/config.json', JSON.stringify(config, null, 2));
console.log('Initialized /data/config.json from defaults');
"
fi

# Link the volume config into the app config directory
rm -f /app/config/config.json
ln -sf /data/config.json /app/config/config.json

exec node app.js
