const nconf = require('nconf');

const dbtype = nconf.get('database:type');

exports.up = (db) => {
    if (dbtype === 'oracledb') {
        return db.schema.hasTable('messages').then((exists) => {
            if (!exists) {
                return db.schema.createTable('messages', (table) => {
                    if (dbtype === 'mysql') {
                        table.charset('utf8');
                        table.collate('utf8_general_ci');
                    }
                    table.collate('utf8_general_ci');
                    table.increments('id').primary().unique().notNullable();
                    table.string('address', [255]).notNullable();
                    table.string('message', [1000]).notNullable();
                    table.string('source', [255]).notNullable();
                    table.integer('timestamp');
                    table.integer('alias_id').unsigned().references('id').inTable('capcodes');
                    table.index(['address', 'id'], 'msg_index');
                    table.index(['id', 'alias_id'], 'msg_alias');
                    table.index(['timestamp', 'alias_id'], 'msg_timestamp');
                });
            }
            return db.schema
                .table('messages', (table) => {
                    table.dropColumn('message');
                    table.dropColumn('source');
                })
                .then(() =>
                    db.schema.table('messages', (table) => {
                        table.string('message', [1000]);
                        table.string('source', [255]);
                    })
                );
        });
    }
    return new Promise((resolve) => {
        resolve('Not Required');
    });
};

exports.down = () => {};
