const nconf = require('nconf');

const dbtype = nconf.get('database:type');

exports.up = (db) => {
    if (dbtype === 'sqlite3') {
        return db.raw(`
            CREATE VIRTUAL TABLE IF NOT EXISTS messages_search_index USING fts3(message, alias, agency);
            `);
    }
    if (dbtype === 'mysql') {
        return Promise.all([
            db.raw(`
                ALTER TABLE messages ADD FULLTEXT (message, source, address);
            `),
            db.raw(`
                ALTER TABLE capcodes ADD FULLTEXT (alias, agency);
            `),
        ]);
    }
    return new Promise((resolve) => {
        resolve('Not Required');
    });
};

exports.down = (db) => db.schema.dropTable('messages_search_index');
