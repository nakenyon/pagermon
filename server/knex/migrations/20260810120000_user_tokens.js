// Single-use, expiring tokens for self-service password reset and for verifying
// a changed email address.
//
// One table serves both purposes (distinguished by `purpose`) so there is one
// issue/consume module and one cleanup job rather than two of each.
//
// Only the SHA-256 of a token is stored - never the token itself - so read
// access to the database does not yield usable reset links. `tokenhash` is
// unique, which doubles as the lookup index.
//
// Timestamps are unix seconds in bigInteger columns rather than datetime, both
// to match `messages.timestamp` and because datetime handling differs across
// the three supported back ends (sqlite3 / mysql / oracledb). Note this runs on
// knex 0.16, so keep the schema syntax conservative.

exports.up = function (db, Promise) {
    return db.schema.hasTable('user_tokens').then(function (exists) {
        if (!exists) {
            return db.schema.createTable('user_tokens', table => {
                table.charset('utf8');
                table.collate('utf8_general_ci');
                table.increments('id').primary().notNullable();
                table.integer('userid').notNullable().index();
                table.string('purpose', 32).notNullable();
                table.string('tokenhash', 64).notNullable().unique();
                // For email_change this holds the address awaiting confirmation.
                table.string('payload', 255);
                table.bigInteger('expires').notNullable();
                table.bigInteger('usedat');
                table.bigInteger('created').notNullable();
                // Wide enough for an IPv6 address, or IPv4-mapped IPv6 as Node
                // reports it behind a proxy.
                table.string('requestip', 45);
            });
        }
        return Promise.resolve('Not Required');
    }).then(function () {
        // Bumped whenever a password changes. Sessions carry the value they saw
        // at login, so anything older is rejected - a reset evicts an attacker
        // who already holds a session cookie.
        return db.schema.hasColumn('users', 'pwchangedat').then(function (exists) {
            if (!exists) {
                return db.schema.table('users', table => {
                    table.bigInteger('pwchangedat');
                });
            }
            return Promise.resolve('Not Required');
        });
    });
};

exports.down = function (db, Promise) {
    return db.schema.dropTableIfExists('user_tokens').then(function () {
        return db.schema.hasColumn('users', 'pwchangedat').then(function (exists) {
            if (exists) {
                return db.schema.table('users', table => {
                    table.dropColumn('pwchangedat');
                });
            }
            return Promise.resolve('Not Required');
        });
    });
};
