// Recomputes messages.alias_id from the capcodes table: for each message, the
// most specific capcode - within that message's own system - whose address
// pattern the message's address matches.
//
// REPLACE(address,'_','%') DESC is what makes "most specific" work: it sorts
// literal digits above the '_' wildcard.
//
// The system predicate is not optional. A CAPCODE address is only unique within
// a paging system, so without `capcodes.system_id = messages.system_id` an edit
// to one system's alias silently re-points another system's messages at it -
// the single most damaging thing this feature can get wrong, because it is a
// quiet data corruption rather than an error.
//
// Measured against a copy of a real 47,827-row messages.db before the system
// column existed: the single whole-table UPDATE takes ~2.7s. Splitting it into
// one statement per distinct address (450 of them) produced byte-identical
// alias_id values but took ~5.2s, and held the write lock for the whole run -
// so the original shape stays. sqlite keeps the small capcodes table in page
// cache and the per-row subquery is cheap; the statement overhead of the
// alternative is not. The added system_id equality is served by the leading
// column of cc_system_address_idx and does not regress that measurement.
//
// This lives here because there were two divergent copies of it - one in
// routes/api.js and one in the mysql cron in app.js - and the system predicate
// has to be in both.

var db = require('../knex/knex.js');
var nconf = require('nconf');

// opts:
//   address  - limit to one message address; omit to refresh everything.
//   systemId - limit to one system's messages. Pass it whenever only one
//              system's capcodes changed, to bound the blast radius; the
//              correlated predicate keeps the result correct either way.
function refreshAliasIds(opts) {
    // Back-compat: the old signature took a bare address string.
    if (typeof opts === 'string' || typeof opts === 'number') opts = { address: opts };
    opts = opts || {};

    var dbtype = nconf.get('database:type');

    return db('messages')
        .update('alias_id', function () {
            this.select('id')
                .from('capcodes')
                .where(db.ref('messages.address'), 'like', db.ref('capcodes.address'))
                // Correlated: only capcodes belonging to the same system as the
                // message being updated.
                .andWhere('capcodes.system_id', db.ref('messages.system_id'))
                .modify(function (queryBuilder) {
                    if (dbtype == 'oracledb')
                        queryBuilder.orderByRaw(`REPLACE("address", '_', '%') DESC`);
                    else
                        queryBuilder.orderByRaw(`REPLACE(address, '_', '%') DESC`);
                })
                .limit(1);
        })
        .modify(function (queryBuilder) {
            if (typeof opts.address !== 'undefined' && opts.address !== null)
                queryBuilder.where(db.ref('messages.address'), '=', opts.address);
            if (typeof opts.systemId !== 'undefined' && opts.systemId !== null)
                queryBuilder.where('messages.system_id', '=', opts.systemId);
        });
}

module.exports = refreshAliasIds;
module.exports.refreshAliasIds = refreshAliasIds;
