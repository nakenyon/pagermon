// Issue and redeem the single-use tokens backing password reset and email-change
// verification. See knex/migrations/20260810120000_user_tokens.js for the schema.
//
// Rules this module enforces, all of which matter for the reset flow to be safe:
//   - the raw token exists only in the return value of issue() and in the email
//     that is sent; the database only ever holds its SHA-256
//   - issuing a token invalidates any earlier outstanding token of the same
//     purpose, so a forwarded old email stops working
//   - redemption is atomic, so a token cannot be spent twice by concurrent
//     requests
//   - a token is worthless if the account has since been disabled
//
// db is passed in rather than required so tests can drive this against the test
// database.

var crypto = require('crypto');
var logger = require('../log');

var PASSWORD_RESET = 'password_reset';
var EMAIL_CHANGE = 'email_change';

// 256 bits. Not guessable, and base64url is safe to drop straight into a URL
// path without escaping.
function generate() {
    return crypto.randomBytes(32).toString('base64url');
}

function hash(token) {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

// Issues a token for `userid`, first clearing any outstanding one of the same
// purpose.
//
// opts.throttleSeconds guards against a single account being mail-bombed by
// repeated requests. express-brute (used on the routes) keys on IP alone, so a
// distributed attempt would slip past it; this is the per-account counterpart.
//
// Resolves to { token, id } on success, or { throttled: true } when a token was
// issued for this user too recently. The raw token is returned exactly once and
// is never logged.
function issue(db, userid, purpose, ttlSeconds, opts) {
    var options = opts || {};
    var now = nowSeconds();

    return Promise.resolve()
        .then(function () {
            if (!options.throttleSeconds) return null;
            return db('user_tokens')
                .where({ userid: userid, purpose: purpose })
                .whereNull('usedat')
                .where('expires', '>', now)
                .where('created', '>', now - options.throttleSeconds)
                .first('id');
        })
        .then(function (recent) {
            if (recent) {
                logger.auth.info('Token: throttled ' + purpose + ' request for user ' + userid);
                return { throttled: true };
            }

            // Supersede rather than accumulate: only the newest link works.
            return db('user_tokens')
                .where({ userid: userid, purpose: purpose })
                .whereNull('usedat')
                .del()
                .then(function () {
                    var token = generate();
                    return db('user_tokens')
                        .insert({
                            userid: userid,
                            purpose: purpose,
                            tokenhash: hash(token),
                            payload: options.payload || null,
                            expires: now + ttlSeconds,
                            created: now,
                            requestip: options.ip || null,
                        })
                        .then(function (inserted) {
                            var id = Array.isArray(inserted) ? inserted[0] : inserted;
                            logger.auth.info(
                                'Token: issued ' + purpose + ' id ' + id + ' for user ' + userid
                            );
                            return { token: token, id: id };
                        });
                });
        });
}

// Redeems a token. Resolves to { ok: true, row, user } or { ok: false, reason }.
// `reason` is for the log only - callers must not surface which check failed,
// since that would tell an attacker whether a guessed token existed.
function consume(db, purpose, rawToken) {
    if (typeof rawToken !== 'string' || !rawToken.length) {
        return Promise.resolve({ ok: false, reason: 'missing' });
    }

    var now = nowSeconds();

    return db('user_tokens')
        .where({ tokenhash: hash(rawToken), purpose: purpose })
        .first()
        .then(function (row) {
            if (!row) return { ok: false, reason: 'unknown' };
            if (row.usedat) return { ok: false, reason: 'already used' };
            if (Number(row.expires) <= now) return { ok: false, reason: 'expired' };

            // Marking used is the atomic step: the whereNull means only one of
            // two concurrent redemptions can update a row, and the loser sees a
            // count of 0.
            return db('user_tokens')
                .where('id', row.id)
                .whereNull('usedat')
                .update({ usedat: now })
                .then(function (count) {
                    if (count !== 1) return { ok: false, reason: 'already used' };

                    return db('users')
                        .where('id', row.userid)
                        .first()
                        .then(function (user) {
                            if (!user) return { ok: false, reason: 'user gone' };
                            // Checked at redemption, not just at issue: an admin
                            // may have disabled the account in between.
                            if (user.status !== 'active') {
                                return { ok: false, reason: 'user disabled' };
                            }
                            return { ok: true, row: row, user: user };
                        });
                });
        });
}

// Drops tokens that can no longer be redeemed. Used by the cleanup cron job and
// safe to call at any time.
function purge(db) {
    return db('user_tokens')
        .where('expires', '<', nowSeconds())
        .orWhereNotNull('usedat')
        .del();
}

module.exports = {
    issue: issue,
    consume: consume,
    purge: purge,
    nowSeconds: nowSeconds,
    PASSWORD_RESET: PASSWORD_RESET,
    EMAIL_CHANGE: EMAIL_CHANGE,
};
