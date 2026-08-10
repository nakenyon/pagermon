// Shared cookie flags, so the session cookie and the CSRF cookie cannot drift
// apart - a session cookie marked `secure` alongside a CSRF cookie that is not
// would break logins over HTTPS in a way that is tedious to diagnose.

var siteurl = require('./siteurl');

// Whether to mark cookies `secure` (browser refuses to send them over plain
// HTTP).
//
// Derived from the configured site URL rather than hardcoded, because PagerMon
// is commonly reached directly over http on a LAN as well as through a
// TLS-terminating proxy. Setting this on for an instance served over http locks
// everyone out, so SECURE_COOKIES exists as an explicit override in both
// directions.
function secure(conf) {
    var override = process.env.SECURE_COOKIES;
    if (typeof override === 'string' && override.trim() !== '') {
        return /^(1|true|yes|on)$/i.test(override.trim());
    }
    return siteurl.isHttps(conf);
}

// sameSite 'lax' is the workhorse here: it stops a cross-site form POST from
// carrying the session cookie at all, which covers the realistic CSRF attack on
// its own. 'strict' would break following a password-reset link from an email
// client, since the first request would arrive without the session.
function base(conf) {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: secure(conf),
    };
}

module.exports = { secure: secure, base: base };
