var nconf = require('nconf');
var confFile = './config/config.json';
var logger = require('./log');
var loglevel = nconf.get('global:loglevel');

if(loglevel === 'debug') {
  var debugon = true
} else {
  var debugon = false
}

var dbtype = nconf.get('database:type');

//in order to create migration files, client must be hardcoded to 'sqlite3' otherwise it won't work. 
var dbconfig = {
    client: dbtype,
    connection: {},
    useNullAsDefault: true,
    debug: debugon,
    migrations: {
      tableName: 'knex_migrations',
      directory: __dirname + '/knex/migrations'
    },
    seeds: {
      directory: __dirname + '/knex/seeds'
    },
    // sqlite allows one writer at a time and, by default, a blocked write fails
    // immediately with SQLITE_BUSY rather than waiting. That is a poor fit here:
    // the connect-sqlite3 session store opens the *same* database file as the
    // application and writes its sessions table during startup, so boot-time
    // writes collide. busy_timeout makes sqlite wait up to 15s instead, which
    // covers ordinary contention - message ingest against an active session
    // store being the common case.
    //
    // Note this does NOT rescue knex's migration lock, and measurement confirms
    // it: sqlite returns SQLITE_BUSY immediately, ignoring busy_timeout, when a
    // deferred transaction that has already read tries to upgrade to a write
    // while another connection holds one. Waiting there could never succeed, so
    // sqlite refuses rather than deadlock. The retry in db.js is what handles
    // that case.
    pool: {
      afterCreate: function (conn, done) {
        if (dbtype !== 'sqlite3') return done(null, conn);
        return conn.run('PRAGMA busy_timeout = 15000', function (err) {
          done(err, conn);
        });
      }
    },
    log: {
      warn(message) {
        logger.db.info(JSON.stringify(message))
      },
      error(message) {
        logger.db.error(JSON.stringify(message))
      },
      deprecate(message) {
        logger.db.info(JSON.stringify(message))
      },
      debug(message) {
        logger.db.debug(JSON.stringify(message))
      },
    }
}
if(process.env.NODE_ENV === 'test') {
  dbconfig.connection.filename = './test/messages.db'
}else if (dbtype == 'sqlite3') {
  dbconfig.connection.filename = nconf.get('database:file');
} else if (dbtype == 'mysql') {
  dbconfig.connection.host = nconf.get('database:server');
  dbconfig.connection.port = nconf.get('database:port');
  dbconfig.connection.user = nconf.get('database:username');
  dbconfig.connection.password = nconf.get('database:password');
  dbconfig.connection.database = nconf.get('database:database');
} else if (dbtype == 'oracledb') {
  dbconfig.connection.connectString = nconf.get('database:connectString');
  dbconfig.connection.user = nconf.get('database:username');
  dbconfig.connection.password = nconf.get('database:password');
  dbconfig.fetchAsString = ['clob'];
}

//this is required because of the silly way knex migrations handle environments 
module.exports = Object.assign({}, dbconfig, {
  test: dbconfig,
  development: dbconfig,
  staging: dbconfig,
  production: dbconfig,
});
