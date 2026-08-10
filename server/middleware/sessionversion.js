// Evicts sessions that predate the account's most recent password change.
//
// Without this, resetting a password does not actually lock anyone out: sessions
// live in the session store keyed only by user id, so an attacker holding a
// stolen cookie keeps their access even after the owner recovers the account.
// That would make the reset feature close to useless in the case it exists for.
//
// The scheme is a version stamp rather than a store sweep: a session records the
// users.pwchangedat value it saw at login, and any session whose stamp is behind
// the current value is destroyed on its next request. That works identically for
// all three session stores and needs no ability to enumerate sessions.
//
// The session that performs the change updates its own stamp (see
// stamp() callers in routes/auth.js) and so survives.

var logger = require('../log');

// Called at login and after a self-service password change.
function stamp(req, user) {
    if (req.session) req.session.pwstamp = Number(user && user.pwchangedat) || 0;
}

function check(req, res, next) {
    if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) return next();

    var current = Number(req.user.pwchangedat) || 0;
    var seen = Number(req.session && req.session.pwstamp) || 0;

    if (current <= seen) return next();

    logger.auth.info(
        'Session: invalidating session for ' + req.user.username + ' - password changed since login'
    );

    var username = req.user.username;
    req.logout();
    return req.session.destroy(function (err) {
        if (err) logger.auth.error('Session: destroy failed for ' + username + ': ' + err);
        // JSON for the SPA's $resource calls, a redirect for page loads. The
        // Angular interceptor in auth.main.js already turns a 401 into a bounce
        // to the login page.
        if (req.xhr || (req.get('accept') || '').indexOf('json') !== -1) {
            return res.status(401).json({ status: 'failed', error: 'Session expired, please log in again' });
        }
        return res.redirect('/auth/login');
    });
}

module.exports = { stamp: stamp, check: check };
