const nconf = require('nconf');

const dbtype = nconf.get('database:type');
exports.up = (db) => {
    if (dbtype === 'mysql') {
        return db.schema
            .table('messages', (table) => {
                table.dropForeign('alias_id');
            })
            .then(() =>
                db.schema
                    .table('messages', (table) => {
                        table.dropColumn('alias_id');
                    })
                    .then(() =>
                        db.schema
                            .table('messages', (table) => {
                                table
                                    .integer('alias_id')
                                    .unsigned()
                                    .references('id')
                                    .inTable('capcodes')
                                    .onDelete('SET NULL');
                            })
                            .then(() => {
                                nconf.set('database:aliasRefreshRequired', 1);
                                nconf.save();
                                return Promise.resolve();
                            })
                    )
            );
    }
    return new Promise((resolve) => {
        resolve('Not Required');
    });
};

exports.down = () => {};
