// Reader health is independent of retained paging messages and capcodes.
exports.up = async function (db) {
    if (!await db.schema.hasTable('reader_health')) {
        await db.schema.createTable('reader_health', t => {
            t.string('key_id', 36).primary();
            t.integer('enabled').notNullable().defaultTo(0);
            t.bigInteger('started_at').notNullable();
            t.bigInteger('last_received');
            t.string('incident_id', 36);
        });
    }
    if (!await db.schema.hasTable('reader_incidents')) {
        await db.schema.createTable('reader_incidents', t => {
            t.string('id', 36).primary();
            t.string('key_id', 36).notNullable().index();
            t.string('reader_name', 255).notNullable();
            t.bigInteger('last_received');
            t.bigInteger('started_at').notNullable();
            t.bigInteger('detected_at').notNullable();
            t.bigInteger('recovered_at');
            t.string('status', 20).notNullable();
            t.text('targets').notNullable();
        });
    }
    if (!await db.schema.hasTable('reader_deliveries')) {
        await db.schema.createTable('reader_deliveries', t => {
            t.string('id', 36).primary();
            t.string('incident_id', 36).notNullable().index();
            t.string('target', 80).notNullable();
            t.string('kind', 12).notNullable();
            t.string('status', 20).notNullable();
            t.integer('attempts').notNullable().defaultTo(0);
            t.bigInteger('next_attempt').notNullable();
            t.bigInteger('updated_at').notNullable();
            t.string('error', 255);
            t.unique(['incident_id', 'target', 'kind'], 'reader_delivery_unique');
            t.index(['status', 'next_attempt'], 'reader_delivery_pending');
        });
    }
};

exports.down = async function (db) {
    await db.schema.dropTableIfExists('reader_deliveries');
    await db.schema.dropTableIfExists('reader_incidents');
    await db.schema.dropTableIfExists('reader_health');
};
