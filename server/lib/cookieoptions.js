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
//
// Resolved once and then frozen. express-session fixes the session cookie's
// flags when it is configured at boot, while the CSRF cookie is written on every
// request - so if this were re-read each time, changing the Site URL in the
// admin UI would flip one cookie to `secure` and leave the other alone. That
// combination breaks login and is thoroughly confusing to diagnose. Freezing it
// keeps the two in step, at the cost of needing a restart after changing the
// Site URL's scheme (as several other settings here already do).
var resolved = null;

function secure(conf) {
    if (resolved !== null) return resolved;

    var override = process.env.SECURE_COOKIES;
    if (typeof override === 'string' && override.trim() !== '') {
        resolved = /^(1|true|yes|on)$/i.test(override.trim());
    } else {
        resolved = siteurl.isHttps(conf);
    }
    return resolved;
}

// Tests only - lets a spec exercise both branches of the decision above.
function reset() {
    resolved = null;
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

module.exports = { secure: secure, base: base, reset: reset };
