// Paging systems.
//
// A CAPCODE address is only unique within a paging system, so every capcode and
// every message is scoped to one. This module owns the single question "which
// system does this request belong to", so that ingest, session-admin posts, the
// capcode admin form and CSV import cannot answer it differently.
//
// Resolution order:
//
//   1. API key with allowSourceOverride, and a posted `source` naming one of
//      the key's permitted systems -> that system.
//   2. API key with a `system` configured -> that system.
//   3. Session user supplying an explicit system -> that system.
//   4. Otherwise -> the default system.
//
// Rule 4 is the upgrade guarantee, not a convenience: an API key with no system
// configured is the state every install is in immediately after the multi-system
// migration and before anyone edits config.json. Such a post must land in the
// default system - never be rejected, never be stored with a null system_id.
//
// The table is tiny (one row per paging network) and read on every ingest, so it
// is cached in memory. Anything that writes to `systems` must call invalidate().

var db = require('../knex/knex.js');
var logger = require('../log');

var cache = null;

// Resolves to the full list of systems, cached. The cache holds the promise
// rather than the result so concurrent ingests share one query instead of
// starting several.
function all() {
    if (!cache) {
        cache = db('systems')
            .select('id', 'name', 'label', 'color', 'enabled', 'is_default', 'sortorder')
            .orderBy('sortorder', 'asc')
            .catch(function (err) {
                // Do not leave a rejected promise in the cache - the next call
                // would keep returning the same failure.
                cache = null;
                throw err;
            });
    }
    return cache;
}

function invalidate() {
    cache = null;
}

function enabled() {
    return all().then(function (rows) {
        return rows.filter(function (row) { return row.enabled != 0; });
    });
}

// Name match is deliberately case-insensitive and whitespace-trimmed: these
// values are typed into config.json by hand and arrive from readers as a free
// text `source` field.
function normalise(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
}

function byName(name) {
    if (!name) return Promise.resolve(null);
    var wanted = normalise(name);
    if (!wanted) return Promise.resolve(null);
    return all().then(function (rows) {
        return rows.find(function (row) { return normalise(row.name) === wanted; }) || null;
    });
}

function byId(id) {
    var wanted = parseInt(id, 10);
    if (!Number.isInteger(wanted)) return Promise.resolve(null);
    return all().then(function (rows) {
        return rows.find(function (row) { return Number(row.id) === wanted; }) || null;
    });
}

// The default system. Falls back to the lowest id if no row is flagged, which
// can only happen if someone has edited the table by hand - returning nothing
// there would fail ingest, which is worse than picking the oldest system.
function defaultSystem() {
    return all().then(function (rows) {
        if (!rows.length) return null;
        var flagged = rows.find(function (row) { return row.is_default == 1; });
        if (flagged) return flagged;
        logger.main.warn('No system is marked as default - falling back to the lowest system id');
        return rows.slice().sort(function (a, b) { return Number(a.id) - Number(b.id); })[0];
    });
}

// Resolves the system for an incoming message post. `body` is req.body; `user`
// is req.user, which for an API key is the object built in auth/local.js.
//
// Returns the system row, or null only if no systems exist at all (a database
// that predates the migration, which the caller must treat as an error).
function resolveForPost(user, body) {
    body = body || {};
    var apikey = user && user.apikey;

    // 1. API key permitted to select among several systems via the reader's
    //    `source` field. Only names in the key's own list are accepted, so a
    //    reader cannot post into a system its key was not granted.
    if (apikey && user.allowSourceOverride && Array.isArray(user.systems) && user.systems.length && body.source) {
        var wanted = normalise(body.source);
        var permitted = user.systems.some(function (name) { return normalise(name) === wanted; });
        if (permitted) {
            return byName(body.source).then(function (row) {
                if (row) return row;
                logger.main.warn('API key "' + (user.name || '?') + '" permits source "' + body.source +
                    '" but no such system exists - falling back to the key default');
                return fallbackForKey(user, body);
            });
        }
    }

    return fallbackForKey(user, body);
}

function fallbackForKey(user, body) {
    var apikey = user && user.apikey;

    // 2. The key's own system.
    if (apikey && user.system) {
        return byName(user.system).then(function (row) {
            if (row) return row;
            logger.main.warn('API key "' + (user.name || '?') + '" names system "' + user.system +
                '", which does not exist - falling back to the default system');
            return defaultSystem();
        });
    }

    // 3. A session user posting explicitly. Not available to API keys: the key
    //    is the authority on its own system, and honouring a body field there
    //    would let any reader write into any system.
    if (!apikey && body && (body.system_id || body.system)) {
        var lookup = body.system_id ? byId(body.system_id) : byName(body.system);
        return lookup.then(function (row) {
            return row || defaultSystem();
        });
    }

    // 4. The default. This is the path every install takes until an API key is
    //    given a system.
    return defaultSystem();
}

// Convenience for callers that only want the id.
function resolveIdForPost(user, body) {
    return resolveForPost(user, body).then(function (row) {
        return row ? row.id : null;
    });
}

// Parses a `system` query parameter - comma-separated ids - into an array of
// integers. An empty or absent value means "all systems" and yields null, which
// callers must treat as "apply no filter" rather than "match nothing".
function parseFilter(value) {
    if (value == null || value === '') return null;
    var raw = Array.isArray(value) ? value : String(value).split(',');
    var ids = raw
        .map(function (v) { return parseInt(String(v).trim(), 10); })
        .filter(function (v) { return Number.isInteger(v); });
    return ids.length ? ids : null;
}

module.exports = {
    all: all,
    enabled: enabled,
    byId: byId,
    byName: byName,
    defaultSystem: defaultSystem,
    resolveForPost: resolveForPost,
    resolveIdForPost: resolveIdForPost,
    parseFilter: parseFilter,
    invalidate: invalidate
};
