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
        }).catch((err) => {
            // Reporting the version is informational. It used to be the gate on
            // the upgrade itself, so a transient SQLITE_BUSY here meant
            // migrations were never even attempted - which is how one instance
            // ended up running new code against an old schema.
            logger.main.warn('Could not read current database version: ' + err);
        }).then(() => {
            logger.main.info('Checking for database upgrades')
            return runMigrations()
        })
    }
}

// A pending schema upgrade that cannot be applied is not something to log and
// move on from: the app then serves new code against an old schema, where reads
// look healthy and writes fail on columns that were never added. So retry, and
// only give up loudly.
//
// Two distinct failures both surface here as "locked":
//
//  * SQLITE_BUSY while taking the lock. sqlite permits one writer, and the
//    connect-sqlite3 session store writes to the same database file during
//    startup. busy_timeout (knexfile.js) deliberately does not help here -
//    sqlite returns SQLITE_BUSY immediately, ignoring the timeout, when a
//    transaction that has already read tries to upgrade to a write while
//    another connection holds one. Retrying from scratch is the only fix.
//  * "Migration table is already locked" - knex_migrations_lock still set by a
//    process killed mid-migration, which never clears itself.
//
// The first resolves by waiting. The second never does, so after waiting once
// the lock is treated as stale and cleared.
var MIGRATION_RETRIES = 3;

function runMigrations(attempt) {
    var tries = attempt || 1;

    return db.migrate
        .latest()
        .then(reportMigrations)
        .catch((err) => {
            var message = String((err && err.message) || err);
            var staleLock = message.indexOf('already locked') !== -1;
            var busy = message.indexOf('SQLITE_BUSY') !== -1 || message.indexOf('database is locked') !== -1;

            if (!staleLock && !busy) return migrationFailed(err);

            if (tries < MIGRATION_RETRIES) {
                // Waiting also covers the legitimate case of a second instance
                // against a shared MySQL database being mid-migration; stealing
                // the lock from it would run two migrations at once.
                logger.main.warn(
                    'Database migration blocked (' +
                        (busy ? 'database busy' : 'lock held') +
                        ') - retrying in 10s, attempt ' +
                        tries +
                        ' of ' +
                        MIGRATION_RETRIES
                );
                return new Promise((resolve) => setTimeout(resolve, 10000)).then(() =>
                    runMigrations(tries + 1)
                );
            }

            if (staleLock) {
                logger.main.warn(
                    'Migration lock still held after ' +
                        MIGRATION_RETRIES +
                        ' attempts - treating it as stale (left by a process killed mid-migration) and clearing it'
                );
                return db.migrate
                    .forceFreeMigrationsLock()
                    .then(() => db.migrate.latest())
                    .then(reportMigrations)
                    .catch((retryErr) => migrationFailed(retryErr));
            }

            return migrationFailed(err);
        });
}

// knex resolves migrate.latest() to [batchNumber, appliedMigrationNames]. The
// previous code read result[0] as a status code - comparing the batch number
// against 1 and 2 - so an upgrade applied in batch 3 or later logged nothing at
// all, and a database that was already current but on batch 1 claimed to have
// upgraded. Report on the list of files actually applied instead.
function reportMigrations(result) {
    var applied = (result && result[1]) || [];
    if (applied.length) {
        logger.main.info('Database upgrades complete: applied ' + applied.join(', '));
    } else {
        logger.main.info('Database upgrade not required');
    }
}

// A migration that cannot be applied leaves the schema behind the code, so make
// it impossible to miss rather than a single line among the boot noise.
function migrationFailed(err) {
    logger.main.error('************************************************************');
    logger.main.error('DATABASE UPGRADE FAILED: ' + err);
    logger.main.error('The application is running against an out-of-date schema.');
    logger.main.error('Expect errors when saving users, messages or settings.');
    logger.main.error('Fix the error above and restart to complete the upgrade.');
    logger.main.error('************************************************************');
}

module.exports = {
    init: init
}
