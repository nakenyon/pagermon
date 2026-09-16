var knex = require('knex');

function openSource(path) {
  return knex({
    client: 'sqlite3',
    connection: { filename: path },
    useNullAsDefault: true,
    pool: {
      afterCreate: function (conn, done) {
        conn.run('PRAGMA query_only = ON', function (err) {
          if (err) return done(err, conn);
          conn.run('PRAGMA busy_timeout = 15000', function (timeoutErr) {
            done(timeoutErr, conn);
          });
        });
      }
    }
  });
}

function closeSource(db) {
  if (!db) return Promise.resolve();
  return db.destroy();
}

module.exports = {
  openSource: openSource,
  closeSource: closeSource
};
