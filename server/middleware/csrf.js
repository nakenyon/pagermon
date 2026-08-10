// CSRF protection for the /auth routes.
//
// Implemented as a double-submit against a per-session secret rather than with
// csurf, which is deprecated and unmaintained. The mechanism:
//
//   1. a random secret is stored in the session (server side, unreadable to a
//      cross-origin attacker) and mirrored into a non-httpOnly XSRF-TOKEN cookie
//   2. state-changing requests must echo it back in an X-XSRF-TOKEN header
//
// An attacker on another origin can make the browser send the cookie but cannot
// read it, so cannot set the header - the same-origin policy is what does the
// work. sameSite=lax on the session cookie is a second, independent layer.
//
// XSRF-TOKEN / X-XSRF-TOKEN are AngularJS $http's built-in defaults, so the
// existing $resource calls in auth.main.js satisfy this with no client changes.

var crypto = require('crypto');
var logger = require('../log');
var cookieoptions = require('../lib/cookieoptions');

var COOKIE = 'XSRF-TOKEN';
var HEADER = 'x-xsrf-token';

// Safe methods must not be rejected: they are also how the cookie gets issued in
// the first place.
var SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// Creates the session secret if absent and (re)publishes the cookie. Exported so
// the login handler can call it directly after session.regenerate(), which
// discards the old secret.
function ensure(req, res) {
    if (!req.session) return null;

    if (!req.session.csrfSecret) {
        req.session.csrfSecret = crypto.randomBytes(32).toString('base64url');
    }

    var options = cookieoptions.base();
    res.cookie(COOKIE, req.session.csrfSecret, {
        // Must be readable by JavaScript - that is the entire point of the
        // double-submit pattern, and Angular reads it to build the header.
        httpOnly: false,
        sameSite: options.sameSite,
        secure: options.secure,
        path: '/',
    });

    return req.session.csrfSecret;
}

// Publishes the cookie on safe requests. Mount before verify().
function issue(req, res, next) {
    if (SAFE_METHODS.indexOf(req.method) !== -1) ensure(req, res);
    next();
}

function tokensMatch(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    var left = Buffer.from(a, 'utf8');
    var right = Buffer.from(b, 'utf8');
    // timingSafeEqual throws on a length mismatch, and the lengths are not
    // secret, so compare them first.
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

// Rejects state-changing requests without a matching token.
function verify(req, res, next) {
    if (SAFE_METHODS.indexOf(req.method) !== -1) return next();

    var secret = req.session && req.session.csrfSecret;
    // Falling back to the body lets a plain HTML form participate; the header is
    // what Angular sends.
    var presented = req.get(HEADER) || (req.body && req.body._csrf);

    if (!secret || !tokensMatch(secret, presented)) {
        logger.auth.warn('CSRF: rejected ' + req.method + ' ' + req.originalUrl + ' from ' + req.ip);
        return res.status(403).send({ status: 'failed', error: 'Invalid or missing CSRF token' });
    }

    return next();
}

module.exports = { ensure: ensure, issue: issue, verify: verify, COOKIE: COOKIE, HEADER: HEADER };
