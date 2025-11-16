const nconf = require('nconf');

const dbtype = nconf.get('database:type');

exports.up = (db) =>
    db.schema.hasTable('capcodes').then((exists) => {
        if (!exists) {
            return db.schema.createTable('capcodes', (table) => {
                if (dbtype === 'mysql') {
                    table.charset('utf8');
                    table.collate('utf8_general_ci');
                }
                table.increments('id').primary().unique().notNullable();
                table.string('address', [255]).notNullable();
                table.text('alias').notNullable();
                table.text('agency');
                table.text('icon');
                table.text('color');
                table.text('pluginconf');
                table.integer('ignore').defaultTo(0);
                table.unique(['id', 'address'], 'cc_pk_idx');
            });
        }
        return new Promise((resolve) => {
            resolve('Not Required');
        });
    });

exports.down = (db) => db.schema.dropTable('capcodes');
