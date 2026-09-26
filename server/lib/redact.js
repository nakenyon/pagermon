// Keeps passwords, API keys, webhook URLs and other credentials out of the logs
// at every log level.
//
// Two layers:
//   - object()/url()/query() are used where the code dumps a structure (plugin
//     config, request bodies, knex bindings) so the log still shows its shape
//     with the secret values masked
//   - scrub() runs on every line in log.js as a safety net: it masks any value
//     currently held in a secret config field, anything written as
//     `secretField: 'value'` (inspect or JSON, including JSON escaped inside a
//     knex binding), and formats that are secrets on their own (bcrypt hashes,
//     chat webhook URLs, Telegram bot tokens, reset/verify links)
//
// Requires nconf only, never ../log, because log.js depends on this module.

var nconf = require('nconf');

var MASK = '[REDACTED]';

// Field names that hold a credential. Anchored at the end so that e.g.
// sessionSecret, pushAPIKEY, bottoken and encPass match but keyId,
// passwordReset and minPasswordLength do not. group/chat are the Pushover and
// Prowl user keys and Telegram chat id; mailto is the alias recipient, which for
// Pushover's email gateway lets anyone who has it alert the whole group.
var KEY_SOURCE = '(?:[A-Za-z_]*(?:pass(?:word)?|secret|token|api_?key|providerkey|fakey|userkey|webhook(?:uri)?)|key|group|chat(?:id)?|mailto|url|uri|repeaturi|repeatuuid)';
var KEY_RE = new RegExp('^' + KEY_SOURCE + '$', 'i');
// Fields whose value is a URL: the host stays visible so the log still says
// where a request went, the path and query (where the token lives) do not.
var URL_KEY_RE = /^(?:url|uri|repeaturi|webhook(?:uri)?)$/i;

// Config values shorter than this are not scrubbed by value, so a trivially
// short setting can't blank out ordinary words across the log.
var MIN_VALUE_LENGTH = 8;

function isSecretKey(key) {
    return typeof key === 'string' && KEY_RE.test(key);
}

function url(value) {
    if (typeof value !== 'string' || value === '') return value;
    try {
        var u = new URL(value);
        if (u.origin === 'null') return MASK;
        // A bare origin carries nothing secret, and user:pass@ is dropped by
        // .origin either way.
        if (u.pathname === '/' && !u.search && !u.hash && !u.username) return u.origin;
        return u.origin + '/' + MASK;
    } catch (e) {
        return MASK;
    }
}

function maskValue(key, value) {
    if (typeof value !== 'string' && typeof value !== 'number') return value;
    if (value === '') return value;
    if (URL_KEY_RE.test(key)) return url(String(value));
    return MASK;
}

// Deep copy of obj with every secret field masked. The original is untouched,
// since callers log the copy and keep using the real object.
function object(obj, seen) {
    if (obj === null || typeof obj !== 'object') return obj;
    seen = seen || new WeakMap();
    if (seen.has(obj)) return seen.get(obj);
    var out = Array.isArray(obj) ? [] : {};
    seen.set(obj, out);
    Object.keys(obj).forEach(function (k) {
        var v = obj[k];
        if (isSecretKey(k) && (v === null || typeof v !== 'object')) {
            out[k] = maskValue(k, v);
        } else {
            out[k] = object(v, seen);
        }
    });
    return out;
}

// A knex query event with any JSON-object binding (alias pluginconf, config
// blobs) redacted field by field; everything else is left to scrub().
function query(message) {
    if (!message || !Array.isArray(message.bindings)) return message;
    var copy = Object.assign({}, message);
    copy.bindings = message.bindings.map(function (b) {
        if (typeof b !== 'string' || (b[0] !== '{' && b[0] !== '[')) return b;
        try {
            return JSON.stringify(object(JSON.parse(b)));
        } catch (e) {
            return b;
        }
    });
    return copy;
}

// --- line-level safety net -------------------------------------------------

// Every secret currently in config, longest first so a value that contains
// another is replaced whole. Cached briefly: scrub() runs on every log line and
// config only changes when an admin saves settings.
var CACHE_MS = 5000;
var cached = null;
var cachedAt = 0;

function configSecrets() {
    var now = Date.now();
    if (cached && now - cachedAt < CACHE_MS) return cached;
    var found = new Set();
    (function walk(o, depth) {
        if (!o || typeof o !== 'object' || depth > 10) return;
        Object.keys(o).forEach(function (k) {
            var v = o[k];
            if (v && typeof v === 'object') return walk(v, depth + 1);
            if (isSecretKey(k) && typeof v === 'string' && v.length >= MIN_VALUE_LENGTH) found.add(v);
        });
    })(safeConfig(), 0);
    cached = Array.from(found).sort(function (a, b) { return b.length - a.length; });
    cachedAt = now;
    return cached;
}

function safeConfig() {
    try {
        return nconf.get();
    } catch (e) {
        return null;
    }
}

var PATTERNS = [
    // `password: 'x'` / `password: "x"` as util.inspect / %o prints it
    [new RegExp('(\\b' + KEY_SOURCE + '\\s*:\\s*)([\'"`])((?:(?!\\2)[^\\\\]|\\\\.)*)\\2', 'gi'),
        function (m, pre, q, v) { return pre + q + textMask(pre, v) + q; }],
    // "password":"x" as JSON
    [new RegExp('("' + KEY_SOURCE + '"\\s*:\\s*)"((?:[^"\\\\]|\\\\.)*)"', 'gi'),
        function (m, pre, v) { return pre + '"' + textMask(pre, v) + '"'; }],
    // \"password\":\"x\" as JSON inside a JSON string (knex bindings)
    [new RegExp('(\\\\"' + KEY_SOURCE + '\\\\"\\s*:\\s*)\\\\"(.*?)\\\\"', 'gi'),
        function (m, pre, v) { return pre + '\\"' + textMask(pre, v) + '\\"'; }],
    // bcrypt password hashes
    [/\$2[abxy]?\$\d{2}\$[./A-Za-z0-9]{53}/g, MASK],
    // chat webhook URLs carry their credential in the path
    [/(https?:\/\/(?:[\w-]+\.)*(?:discord(?:app)?\.com\/api\/webhooks|hooks\.slack\.com\/services|webhook\.office\.com\/webhookb2|outlook\.office\.com\/webhook))\/[^\s'"`\\]+/gi,
        '$1/' + MASK],
    // Telegram bot tokens
    [/\b(bot)?\d{6,12}:[A-Za-z0-9_-]{30,}/g, MASK],
    // single-use links as they appear in http.log and mail errors
    [/(\/auth\/(?:reset-password|verify-email)\/)[^\s?#"'`]+/g, '$1' + MASK],
    // credentials passed in a query string
    [/([?&](?:token|api_?key|key|password|secret)=)[^&\s"'`#]+/gi, '$1' + MASK]
];

// The key text captured by a pattern still has its quotes and colon attached;
// strip those to decide between a URL mask and a full one.
function textMask(pre, value) {
    if (value === '') return value;
    var key = pre.replace(/[\\"'\s:]/g, '');
    return URL_KEY_RE.test(key) ? url(value) : MASK;
}

function scrub(text) {
    if (typeof text !== 'string' || text === '') return text;
    var out = text;
    configSecrets().forEach(function (s) {
        if (out.indexOf(s) !== -1) out = out.split(s).join(MASK);
    });
    PATTERNS.forEach(function (p) {
        out = out.replace(p[0], p[1]);
    });
    return out;
}

// For tests: drop the cached config secrets so a config change is seen now.
function resetCache() {
    cached = null;
}

module.exports = {
    MASK: MASK,
    isSecretKey: isSecretKey,
    object: object,
    url: url,
    query: query,
    scrub: scrub,
    resetCache: resetCache
};
