const nconf = require('nconf');

const dbtype = nconf.get('database:type');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
        return knex.schema.createTable('feeders', table => {
                if (dbtype === 'mysql') {
                        table.charset('utf8');
                        table.collate('utf8_general_ci');
                }
                table.increments('id')
                        .primary()
                        .unique()
                        .notNullable();
                table.string('apikey', [255]).notNullable();
                table.string('name').notNullable();
                table.text('description');
                table.timestamp('last_message');
                table.boolean('heartbeat_enabled');
                table.timestamp('last_heartbeat');
                table.integer('heartbeat_interval');
                table.timestamps(true, true);
        });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
        return knex.schema.dropTableIfExists('feeders');
};
