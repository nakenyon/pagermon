// Housekeeping for the user_tokens table.
//
// Expired and already-redeemed tokens are dead weight: they can never be
// redeemed again (lib/usertokens.js checks both before accepting one), so this
// job is about not accumulating rows - and about not keeping a record of who
// requested a reset, and from which IP, for longer than it is useful.
//
// Following cron/messageRotation.js: db injected rather than required so tests
// can drive it against the test database, and a purge against a moving horizon
// is idempotent, so there is no last-run state to persist.

var logger = require('../log');
var usertokens = require('../lib/usertokens');

// Resolves to the number of rows deleted. Never rejects - a failed cleanup is
// worth a log line, not a crashed process.
function purge(db) {
    return usertokens
        .purge(db)
        .then(function (count) {
            if (count > 0) {
                logger.main.info('Tokens: purged ' + count + ' expired or used tokens');
            } else {
                logger.main.debug('Tokens: nothing to purge');
            }
            return count;
        })
        .catch(function (err) {
            logger.main.error('Tokens: purge failed: ' + err);
            return 0;
        });
}

function schedule(db) {
    var CronJob = require('cron').CronJob;
    // Daily at 03:20. Tokens live for an hour at most, so there is nothing to
    // gain from running this more often.
    new CronJob('0 20 3 * * *', function () {
        purge(db);
    }, null, true);
    logger.main.info('Tokens: daily cleanup job scheduled');
}

module.exports = { purge: purge, schedule: schedule };
