var fs = require('fs');
var logger = require('./log');
var moment = require('moment');
var nconf = require('nconf');
var confFile = './config/config.json';
var db = require('./knex/knex.js');
nconf.file({file: confFile});
nconf.load();

// initialize the database if it does not already exist
function init() {
    // One-time neutralization of the stale rotation flag. Upstream shipped
    // rotationEnabled: true in its defaults since 2017 while the feature was
    // unimplemented, so any config written before rotation actually existed
    // says "enabled" without the admin ever choosing it - including databases
    // and configs imported from upstream installs. Honoring that stale flag
    // would purge history on first boot. Reset it once, then respect whatever
    // the admin sets in the settings UI from here on.
    if (!nconf.get('messages:rotationReset2026')) {
        if (nconf.get('messages:rotationEnabled')) {
            logger.main.info('Rotation: disabling stale rotationEnabled flag - message rotation did not exist when this config was written. Re-enable it in admin settings to opt in.');
            nconf.set('messages:rotationEnabled', false);
        }
        nconf.set('messages:rotationReset2026', true);
        nconf.save();
    }

    var dbtype = nconf.get('database:type')
    //This is here for compatibility with old versions. Will set the DB type then exit. 
    if (dbtype == null || dbtype == 'sqlite') {
        nconf.set('database:type', 'sqlite3');
        nconf.set('database:file', './messages.db');
        nconf.save()
        logger.main.error('Error reading database type. Defaulting to SQLITE3. Killing application')
        process.exit(1)
    }
    if (dbtype == 'sqlite3') {
        // Legacy Datbase handling - force an upgrade and or remove the old version numbers
        db.raw(`pragma user_version;`).then(function (res) {
            // Check if database is currently v0.2.3 if not force upgrade to that first
            if (res[0].user_version < 20181118 && res[0].user_version != 0) {
                logger.main.info("Current Legacy DB version: " + res[0].user_version);
                logger.main.error("Unsupported Upgrade Version - Upgrade Pagermon Database to v0.2.3 BEFORE upgrading to v0.3.0");
                process.exit(1)
            } else if (res[0].user_version >= 20181118) {
            // If the database has a legacy version number from 0.3.0 - remove it    
                logger.main.info("Current Legacy DB version: " + res[0].user_version);
                var vervar = 'pragma user_version = 0;'
                db.raw(vervar)
                .then((result) => {
                        logger.main.debug('Removing legacy DB version infomation')
                })
                .catch((err) => {
                    logger.main.error('Error removing legacy DB version infomation' + err)
                })
            }
        })
    }
    if(process.env.NODE_ENV != 'test') { 
        db.migrate.currentVersion().then((result) => {
            logger.main.info("Current DB version: " + result);
            logger.main.info('Checking for database upgrades')
            db.migrate.latest()
            .then((result) => {
                if (result[0] === 1) {
                    logger.main.info('Database upgrades complete')
                } else if (result[0] === 2) {
                    logger.main.info('Database upgrade not required')
                }
            })
            .catch((err) => {
                logger.main.error('Error upgrading database:' + err)
            })
        }).catch((err) => {
            logger.main.error('Error retrieving database version' + err)
        })
    }   
}

module.exports = {
    init: init
}
