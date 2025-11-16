const nconf = require('nconf');

const dbtype = nconf.get('database:type');

exports.up = (db) => {
    if (dbtype === 'oracledb') {
        return db.schema.raw(`CREATE INDEX search_idx ON "messages"("message")
    INDEXTYPE IS CTXSYS.CONTEXT PARAMETERS
    ('FILTER CTXSYS.NULL_FILTER')`);
    }
    return new Promise((resolve) => {
        resolve('Not Required');
    });
};

exports.down = () => {};
