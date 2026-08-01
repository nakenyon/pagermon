// Message rotation - implemented as a continuously-enforced retention horizon.
//
// Upstream shipped the rotationEnabled/rotateDays/rotateKeep config keys and the
// admin UI for them in 2017 but never the feature itself (the settings page
// carried a "not yet implemented" warning). The semantics here are the
// logrotate-style reading of those keys: intervals of rotateDays days, keep
// rotateKeep intervals - i.e. messages older than rotateDays * rotateKeep days
// are deleted. A purge against a moving horizon is idempotent, so there is no
// rotation "event" and no last-run state to persist; the job simply runs every
// hour and deletes whatever has aged out.
//
// Note: deleting rows does not shrink a sqlite file - the freed space is reused
// for new messages. Deliberately no VACUUM here: it takes a full-database lock
// and can run for a long time on large files.

var logger = require('../log');

// Returns a promise resolving to the number of deleted rows (0 when disabled,
// misconfigured, or nothing has aged out). db and nconf are passed in rather
// than required here so tests can drive this against the test database.
function purge(db, nconf) {
    var enabled = nconf.get('messages:rotationEnabled');
    var days = Number(nconf.get('messages:rotateDays'));
    var keep = Number(nconf.get('messages:rotateKeep'));

    if (enabled !== true) {
        logger.main.debug('Rotation: disabled, skipping');
        return Promise.resolve(0);
    }
    if (!Number.isInteger(days) || days <= 0 || !Number.isInteger(keep) || keep <= 0) {
        logger.main.warn('Rotation: invalid rotateDays/rotateKeep (' + days + '/' + keep + '), skipping');
        return Promise.resolve(0);
    }

    var horizonSeconds = days * keep * 24 * 60 * 60;
    var cutoff = Math.floor(Date.now() / 1000) - horizonSeconds;

    return db('messages')
        .where('timestamp', '<', cutoff)
        .del()
        .then(function (count) {
            if (count > 0) {
                logger.main.info('Rotation: purged ' + count + ' messages older than ' + (days * keep) + ' days');
            } else {
                logger.main.debug('Rotation: nothing to purge');
            }
            return count;
        })
        .catch(function (err) {
            logger.main.error('Rotation: purge failed: ' + err);
            return 0;
        });
}

// Registers the hourly cron job. Config is read inside each tick, so changes
// made in the admin settings UI take effect without a restart (admin saves
// call nconf.load() on the shared instance).
function schedule(db, nconf) {
    var CronJob = require('cron').CronJob;
    // minute 15 to stay clear of top-of-hour activity
    new CronJob('0 15 * * * *', function () {
        purge(db, nconf);
    }, null, true);
    logger.main.info('Rotation: hourly retention job scheduled');
}

module.exports = { purge: purge, schedule: schedule };
