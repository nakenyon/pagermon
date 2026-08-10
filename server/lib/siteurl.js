// The external base URL of this PagerMon instance, used to build absolute links
// in outbound email.
//
// Deliberately NOT derived from the incoming request. Building a reset link from
// req.get('host') is host-header injection: an attacker requests a reset for
// someone else's account with a forged Host header, and the victim receives a
// genuine-looking email whose link points at the attacker's server. So the value
// has to be configured out-of-band, and callers treat a null return as "the
// feature that needs this stays off".
//
// Also deliberately not falling back to the HOSTNAME env var. HOSTNAME is
// overloaded already (cookie domain in app.js, Discord embed link in
// plugins/Discord.js) and is a bare domain in some deployments and a full URL in
// others - too ambiguous to build a security-sensitive link from.

var nconf = require('nconf');

// PAGERMON_URL wins so a container can be pointed at the right hostname without
// editing config.json; otherwise global:siteUrl from the admin settings UI.
// Returns a normalised origin with no trailing slash, or null when unset or
// unusable.
function resolve(conf) {
    var source = conf || nconf;
    var raw = process.env.PAGERMON_URL || source.get('global:siteUrl');

    if (!raw || typeof raw !== 'string') return null;
    raw = raw.trim();
    if (!raw) return null;

    // A scheme is required rather than assumed - guessing https:// for a value
    // that is actually served over http produces links that simply fail.
    if (!/^https?:\/\//i.test(raw)) return null;

    try {
        var parsed = new URL(raw);
        if (!parsed.hostname) return null;
        return (parsed.origin + parsed.pathname).replace(/\/+$/, '');
    } catch (e) {
        return null;
    }
}

// True when the site is reached over TLS, which is what decides whether the
// session and CSRF cookies get the `secure` flag.
function isHttps(conf) {
    var url = resolve(conf);
    return url !== null && url.toLowerCase().indexOf('https://') === 0;
}

// Joins a path onto the site URL. Returns null when no site URL is configured,
// so callers cannot accidentally send a relative link in an email.
function build(path, conf) {
    var base = resolve(conf);
    if (!base) return null;
    if (!path) return base;
    return base + (path.charAt(0) === '/' ? path : '/' + path);
}

module.exports = { resolve: resolve, isHttps: isHttps, build: build };
