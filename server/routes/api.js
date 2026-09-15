var express = require('express');
var bodyParser = require('body-parser');
var router = express.Router();
var basicAuth = require('express-basic-auth');
var bcrypt = require('bcryptjs');
var util = require('util');
var _ = require('underscore');
var pluginHandler = require('../plugins/pluginHandler');
var logger = require('../log');
var db = require('../knex/knex.js');
var converter = require('json-2-csv');

var nconf = require('nconf');

var confFile = './config/config.json';
nconf.file({ file: confFile });
nconf.load();

router.use(bodyParser.json());       // to support JSON-encoded bodies
router.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
}));

const passport = require('../auth/local');
var authHelper = require('../middleware/authhelper')
var passwordpolicy = require('../lib/passwordpolicy')
// Shared with the mysql alias-refresh cron in app.js. It used to be duplicated
// in both, and the system predicate it now carries has to be in both.
var refreshAliasIds = require('../lib/aliasrefresh')
var systems = require('../lib/systems')

// The projection sent to non-admin viewers when HideCapcode is on: everything
// except `address`, which is the capcode being hidden.
//
// This existed as five hand-maintained copies of the same object literal - two
// on read paths and three in the socket emit block - which is how a field added
// to one ends up missing from another. The system fields are carried here
// because clients filter and badge on them; they are not sensitive, and a row
// without them cannot be matched against the viewer's system selection.
function withoutCapcode(row) {
  return {
    "id": row.id,
    "message": row.message,
    "source": row.source,
    "timestamp": row.timestamp,
    "alias_id": row.alias_id,
    "alias": row.alias,
    "agency": row.agency,
    "icon": row.icon,
    "color": row.color,
    "ignore": row.ignore,
    "system_id": row.system_id,
    "system_name": row.system_name,
    "system_label": row.system_label,
    "system_color": row.system_color
  };
}

router.use(function (req, res, next) {
  res.locals.login = req.isAuthenticated();
  res.locals.user = req.user || false;
  next();
});

// Per-request pagination state.
//
// This was a single module-level object mutated in place by both list handlers,
// so two overlapping requests read and wrote each other's currentPage, limit and
// offset - a page of results could be computed with another request's offset.
// Adding a system filter makes that more likely, not less, because a filtered
// and an unfiltered request differ in msgCount. Each request now gets its own.
function newInitData() {
  return {
    limit: nconf.get('messages:defaultLimit'),
    replaceText: nconf.get('messages:replaceText'),
    currentPage: 0,
    pageCount: 0,
    msgCount: 0,
    offset: 0
  };
}

// auth variables
var HideCapcode = nconf.get('messages:HideCapcode');
var apiSecurity = nconf.get('messages:apiSecurity');
var dbtype = nconf.get('database:type');

// dupe init
var msgBuffer = [];


router.route('/messages')
  .get(authHelper.isLoggedInMessages, function (req, res, next) {
    nconf.load();
    console.time('init');
    var pdwMode = nconf.get('messages:pdwMode');
    var adminShow = nconf.get('messages:adminShow');
    var maxLimit = nconf.get('messages:maxLimit');
    var defaultLimit = nconf.get('messages:defaultLimit');
    var HideCapcode = nconf.get('messages:HideCapcode');
    var initData = newInitData();
    // null means "no filter", not "match nothing" - see lib/systems.parseFilter.
    var systemFilter = systems.parseFilter(req.query.system);

    if (typeof req.query.page !== 'undefined') {
      var page = parseInt(req.query.page, 10);
      if (page > 0) {
        initData.currentPage = page - 1;
      } else {
        initData.currentPage = 0;
      }
    }
    if (req.query.limit && req.query.limit <= maxLimit) {
      initData.limit = parseInt(req.query.limit, 10);
    } else {
      initData.limit = parseInt(defaultLimit, 10);
    }
    if (pdwMode) {
      if (adminShow && req.isAuthenticated() && req.user.role == 'admin') {
        var subquery = db.from('capcodes').where('ignore', '=', 1).select('id')
      } else {
        var subquery = db.from('capcodes').where('ignore', '=', 0).select('id')
      }
    } else {
      var subquery = db.from('capcodes').where('ignore', '=', 1).select('id')
    }
    db.from('messages').where(function () {
      if (pdwMode) {
        if (adminShow && req.isAuthenticated() && req.user.role == 'admin') {
          this.from('messages').where('alias_id', 'not in', subquery).orWhereNull('alias_id')
        } else {
          this.from('messages').where('alias_id', 'in', subquery)
        }
      } else {
        this.from('messages').where('alias_id', 'not in', subquery).orWhereNull('alias_id')
      }
    })
      // The same filter must be applied to the count and to the page below, or
      // pageCount describes a different result set than the one returned.
      .modify(function (queryBuilder) {
        if (systemFilter) queryBuilder.whereIn('messages.system_id', systemFilter);
      })
      .count('* as msgcount')
      .then(function (initcount) {
        var count = initcount[0]
        if (count) {
          initData.msgCount = count.msgcount;
          initData.pageCount = Math.ceil(initData.msgCount / initData.limit);
          if (initData.currentPage > initData.pageCount) {
            initData.currentPage = 0;
          }
          initData.offset = initData.limit * initData.currentPage;
          if (initData.offset < 0) {
            initData.offset = 0;
          }
          initData.offsetEnd = initData.offset + initData.limit;
          console.timeEnd('init');
          console.time('sql');

          var result = [];
          var rowCount

          db.from('messages')
            .select('messages.*', 'capcodes.alias', 'capcodes.agency', 'capcodes.icon', 'capcodes.color', 'capcodes.ignore', db.raw('CASE WHEN NOT capcodes.address = messages.address THEN 1 ELSE 0 END as wildcard'),
              'systems.name as system_name', 'systems.label as system_label', 'systems.color as system_color')
            .modify(function (queryBuilder) {
              if (pdwMode) {
                if (adminShow && req.isAuthenticated() && req.user.role == 'admin') {
                  queryBuilder.leftJoin('capcodes', 'capcodes.id', '=', 'messages.alias_id').where('capcodes.ignore', 0).orWhereNull('capcodes.ignore')
                } else {
                  queryBuilder.innerJoin('capcodes', 'capcodes.id', '=', 'messages.alias_id').where('capcodes.ignore', 0)
                }
              } else {
                queryBuilder.leftJoin('capcodes', 'capcodes.id', '=', 'messages.alias_id').where('capcodes.ignore', 0).orWhereNull('capcodes.ignore')
              }
              queryBuilder.leftJoin('systems', 'systems.id', '=', 'messages.system_id')
              if (systemFilter) queryBuilder.whereIn('messages.system_id', systemFilter);
            })
            .orderBy('messages.timestamp', 'desc')
            .limit(initData.limit)
            .offset(initData.offset)
            .then(rows => {
              rowCount = rows.length
              for (row of rows) {
                //outRow = JSON.parse(newrow);
                if (HideCapcode) {
                  if (!req.isAuthenticated() || (req.isAuthenticated() && req.user.role == 'user')) {
                    row = withoutCapcode(row);
                  }
                }
                if (row) {
                  result.push(row);
                } else {
                  logger.main.info('empty results');
                }
              }
            })
            .catch(err => {
              logger.main.error(err);
            })
            .finally(() => {
              if (rowCount > 0) {
                console.timeEnd('sql');
                //var limitResults = result.slice(initData.offset, initData.offsetEnd);
                console.time('send');
                res.status(200).json({ 'init': initData, 'messages': result });
                console.timeEnd('send');
              } else {
                res.status(200).json({ 'init': {}, 'messages': [] });
              }
            });
        }
      });
  })
  .post(authHelper.isAdmin, async function (req, res, next) {
    nconf.load();
    // Count valid arrivals before any duplicate/alias/plugin discard. Do not use
    // client timestamps, stored-message counts, or a session admin's request.
    const validHealthAddress = (typeof req.body.address === 'string' && req.body.address.trim()) ||
      (typeof req.body.address === 'number' && Number.isFinite(req.body.address) && req.body.address > 0);
    if (req.readerKeyId && validHealthAddress && typeof req.body.message === 'string' && req.body.message.trim()) {
      await req.app.locals.databaseReady;
      await require('../lib/readerhealth').instance().record(req.readerKeyId);
    }
    if (req.body.address && req.body.message) {
      var dbtype = nconf.get('database:type');
      var filterDupes = nconf.get('messages:duplicateFiltering');
      var dupeLimit = nconf.get('messages:duplicateLimit') || 0; // default 0
      var dupeTime = nconf.get('messages:duplicateTime') || 0; // default 0
      var pdwMode = nconf.get('messages:pdwMode');
      var adminShow = nconf.get('messages:adminShow');
      var data = req.body;
      data.pluginData = {};

      // Which paging system this message belongs to. The API key is the
      // authority; see lib/systems.js for the full resolution order and why a
      // key with no system configured must still succeed.
      var systemRow = null;
      try {
        systemRow = await systems.resolveForPost(req.user, data);
      } catch (err) {
        logger.main.error('Could not resolve system for incoming message: ' + err);
        return res.status(500).json({ message: 'Error - could not resolve paging system' });
      }
      if (!systemRow) {
        // Only reachable if the systems table is empty, i.e. the migration did
        // not complete. Storing the message with a null system_id would make it
        // invisible to every filtered view, so refuse it instead: the reader
        // will retry and the operator gets a loud error.
        logger.main.error('No paging systems are defined - refusing message. Check that database migrations completed.');
        return res.status(500).json({ message: 'Error - no paging systems defined' });
      }
      var systemId = systemRow.id;
      // Plugins can route per-system, in the same way the per-alias pluginconf
      // mechanism lets them route per-alias.
      data.pluginData.system = { id: systemRow.id, name: systemRow.name, label: systemRow.label };

      if (filterDupes) {
        // this is a bad solution and tech debt that will bite us in the ass if we ever go HA, but that's a problem for future me and that guy's a dick
        var datetime = data.datetime || 1;
        var timeDiff = datetime - dupeTime;
        // if duplicate filtering is enabled, we want to populate the message buffer and check for duplicates within the limits
        // Scoped by system: two networks sending an identical message in the
        // same window are two real pages, not a duplicate, and without this
        // they cross-suppress each other.
        var matches = _.where(msgBuffer, { message: data.message, address: data.address, system_id: systemId });
        if (matches.length > 0) {
          if (dupeTime != 0) {
            // search the matching messages and see if any match the time constrain
            var timeFind = _.find(matches, function (msg) { return msg.datetime > timeDiff; });
            if (timeFind) {
              logger.main.info(util.format('Ignoring duplicate: %o', data.message));
              return res.status(200).send('Ignoring duplicate');
            }
          } else {
            // if no dupeTime then just end the search now, we have matches
            logger.main.info(util.format('Ignoring duplicate: %o', data.message));
            return res.status(200).send('Ignoring duplicate');
          }
        }
        // no matches, maintain the array
        var dupeArrayLimit = dupeLimit;
        if (dupeArrayLimit == 0) {
          dupeArrayLimit = 25; // should provide sufficient buffer, consider increasing if duplicates appear when users have no dupeLimit
        }
        if (msgBuffer.length > dupeArrayLimit) {
          msgBuffer.shift();
        }
        msgBuffer.push({ message: data.message, datetime: data.datetime, address: data.address, system_id: systemId });
      }

      // send data to pluginHandler before proceeding
      logger.main.debug('beforeMessage start');
      pluginHandler.handle('message', 'before', data, function (response) {
        logger.main.debug(util.format('%o', response));
        logger.main.debug('beforeMessage done');
        if (response && response.pluginData) {
          // only set data to the response if it's non-empty and still contains the pluginData object
          data = response;
        }
        if (data.pluginData.ignore) {
          // stop processing
          return res.status(200).send('Ignoring filtered');
        }
        var address = data.address || '0000000';
        var message = data.message || 'null';
        var datetime = data.datetime || 1;
        var timeDiff = datetime - dupeTime;
        var source = data.source || 'UNK';
        db.from('messages')
          .select('*')
          .modify(function (queryBuilder) {
            if ((dupeLimit != 0) && (dupeTime != 0)) {
              queryBuilder.where('id', 'in', function () {
                this.select('*')
                  //this wierd subquery is to keep mysql happy
                  .from(function () {
                    this.select('id')
                      .from('messages')
                      .where('timestamp', '>', timeDiff)
                      .orderBy('id', 'desc')
                      .limit(dupeLimit)
                      .as('temp_tab')
                  })
              })
                .andWhere('message', '=', message)
                .andWhere('address', '=', address)
                .andWhere('system_id', '=', systemId)
            } else if ((dupeLimit != 0) && (dupeTime == 0)) {
              queryBuilder.where('id', 'in', function () {
                this.select('*')
                  //this wierd subquery is to keep mysql happy
                  .from(function () {
                    this.select('id')
                      .from('messages')
                      .orderBy('id', 'desc')
                      .limit(dupeLimit)
                      .as('temp_tab')
                  })
              })
                .andWhere('message', '=', message)
                .andWhere('address', '=', address)
                .andWhere('system_id', '=', systemId)
            } else if ((dupeLimit == 0) && (dupeTime != 0)) {
              queryBuilder.where('id', 'in', function () {
                this.select('id')
                  .from('messages')
                  .where('timestamp', '>', timeDiff)
              })
                .andWhere('message', '=', message)
                .andWhere('address', '=', address)
                .andWhere('system_id', '=', systemId)
            } else {
              queryBuilder.where('message', '=', message)
                .andWhere('address', '=', address)
                .andWhere('system_id', '=', systemId)
            }
          })
          .then((row) => {
            if (row.length > 0 && filterDupes) {
              logger.main.info(util.format('Ignoring duplicate: %o', message));
              res.status(200).send('Ignoring duplicate');
            } else {
              db.from('capcodes')
                .select('id', 'ignore')
                // Scoped to the posting system: the same address means
                // different agencies on different networks, so an unscoped
                // match resolves to an arbitrary one of them.
                .where('system_id', '=', systemId)
                // TODO: test this doesn't break other DBs - there's a lot of quote changes here
                .modify(function (queryBuilder) {
                  if (dbtype == 'oracledb') {
                    queryBuilder.whereRaw('? LIKE "address"', [address])
                    queryBuilder.orderByRaw(`REPLACE("address", '_', '%') DESC`);
                  } else {
                    queryBuilder.whereRaw('? LIKE address', [address])
                    queryBuilder.orderByRaw(`REPLACE(address, '_', '%') DESC`)
                  }
                })
                // Only the most specific match is used; fetching the rest and
                // discarding them was pure waste.
                .limit(1)
                .then((row) => {
                  var insert;
                  var alias_id = null;
                  if (row.length > 0) {
                    row = row[0]
                    if (row.ignore == 1) {
                      insert = false;
                      logger.main.info('Ignoring filtered address: ' + address + ' alias: ' + row.id);
                    } else {
                      insert = true;
                      alias_id = row.id;
                    }
                  } else {
                    insert = true;
                  }

                  // overwrite alias_id if set from plugin
                  if (data.pluginData.aliasId) {
                    alias_id = data.pluginData.aliasId;
                  }

                  if (insert == true) {
                    var insertmsg = { address: address, message: message, timestamp: datetime, source: source, alias_id: alias_id, system_id: systemId }
                    db('messages').insert(insertmsg).returning('id')
                      .then((result) => {
                        // emit the full message
                        var msgId;
                        if (Array.isArray(result)) {
                          msgId = result[0];
                        } else {
                          msgId = result;
                        }
                        logger.main.debug(result);

                        if (dbtype == 'oracledb') {
                          // oracle requires update of search index after insert, can't be trigger for some reason
                          db.raw(`BEGIN CTX_DDL.SYNC_INDEX('search_idx'); END;`)
                            .then((resp) => {
                              logger.main.debug('search_idx sync complete');
                              logger.main.debug(resp);
                            }).catch((err) => {
                              logger.main.error('search_idx sync failed');
                              logger.main.error(err)
                            });
                        }

                        db.from('messages')
                          .select('messages.*', 'capcodes.alias', 'capcodes.agency', 'capcodes.icon', 'capcodes.color', 'capcodes.ignore', 'capcodes.pluginconf',
                            'systems.name as system_name', 'systems.label as system_label', 'systems.color as system_color')
                          .modify(function (queryBuilder) {
                            queryBuilder.leftJoin('capcodes', 'capcodes.id', '=', 'messages.alias_id')
                            // So the socket payload carries the system and
                            // clients can filter and badge without a lookup.
                            queryBuilder.leftJoin('systems', 'systems.id', '=', 'messages.system_id')
                          })
                          .where('messages.id', '=', msgId)
                          .then((row) => {
                            if (row.length > 0) {
                              row = row[0]
                              // send data to pluginHandler after processing
                              row.pluginData = data.pluginData;

                              if (row.pluginconf) {
                                row.pluginconf = parseJSON(row.pluginconf);
                              } else {
                                row.pluginconf = {};
                              }
                              logger.main.debug('afterMessage start');
                              pluginHandler.handle('message', 'after', row, function (response) {
                                logger.main.debug(util.format('%o', response));
                                logger.main.debug('afterMessage done');
                                // remove the pluginconf object before firing socket message
                                delete row.pluginconf;
                                //begin socket handling - this is the most horrible block of spaghetti code i've seen in my life and i hate myself for being involved in it
                                if (HideCapcode) {
                                  if (pdwMode) {
                                    if (adminShow) {
                                      //If PDWMode on and AdminShow is on send always
                                      req.io.of('adminio').emit('messagePost', row);
                                      if (row.alias_id != null) {
                                        // send to normal user as well if not null alias_id
                                        rowuser = withoutCapcode(row);
                                        req.io.emit('messagePost', rowuser);
                                      }
                                    } else {
                                      // if AdminShow not on only send if not null alias_id
                                      if (row.alias_id != null) {
                                        req.io.of('adminio').emit('messagePost', row);
                                        rowuser = withoutCapcode(row);
                                        req.io.emit('messagePost', rowuser);
                                      }
                                    }
                                  } else {
                                    req.io.of('adminio').emit('messagePost', row);
                                    rowuser = withoutCapcode(row);
                                    req.io.emit('messagePost', rowuser);
                                  }
                                } else {
                                  if (pdwMode) {
                                    if (adminShow) {
                                      //If PDWMode on and AdminShow is on send always
                                      req.io.of('adminio').emit('messagePost', row);
                                      if (row.alias_id != null) {
                                        // send to normal user as well if not null alias_id
                                        req.io.emit('messagePost', row);
                                      }
                                    } else {
                                      // if AdminShow not on only send if not null alias_id
                                      if (row.alias_id != null) {
                                        req.io.of('adminio').emit('messagePost', row);
                                        req.io.emit('messagePost', row);
                                      }
                                    }
                                  } else {
                                    req.io.of('adminio').emit('messagePost', row);
                                    req.io.emit('messagePost', row);
                                  }
                                }
                              });
                            }
                            res.status(200).send('' + result);
                          })
                          .catch((err) => {
                            res.status(500).send(err);
                            logger.main.error(err)
                          })
                      })
                      .catch((err) => {
                        res.status(500).send(err);
                        logger.main.error(err)
                      })
                  } else {
                    res.status(200).send('Ignoring filtered');
                  }
                })
                .catch((err) => {
                  res.status(500).send(err);
                  logger.main.error(err)
                })
            }
          })
          .catch((err) => {
            res.status(500).send(err);
            logger.main.error(err)
          })
      })
    } else {
      res.status(500).json({ message: 'Error - address or message missing' });
    }
  });


router.route('/messages/:id')
  .get(authHelper.isLoggedInMessages, function (req, res, next) {
    nconf.load();
    var pdwMode = nconf.get('messages:pdwMode');
    var HideCapcode = nconf.get('messages:HideCapcode');
    var apiSecurity = nconf.get('messages:apiSecurity');
    var id = req.params.id;

    db.from('messages')
      .select('messages.*', 'capcodes.alias', 'capcodes.agency', 'capcodes.icon', 'capcodes.color', 'capcodes.ignore', db.raw('CASE WHEN NOT capcodes.address = messages.address THEN 1 ELSE 0 END as wildcard'),
        'systems.name as system_name', 'systems.label as system_label', 'systems.color as system_color')
      .leftJoin('capcodes', 'capcodes.id', '=', 'messages.alias_id')
      .leftJoin('systems', 'systems.id', '=', 'messages.system_id')
      .where('messages.id', id)
      .then((row) => {
        if (HideCapcode) {
          if (!req.isAuthenticated() || (req.isAuthenticated() && req.user.role == 'user')) {
            row = withoutCapcode(row[0]);
          }
        }
        if (row.ignore == 1) {
          res.status(200).json({});
        } else {
          if (pdwMode && !row.alias) {
            res.status(200).json({});
          } else {
            res.status(200).json(row);
          }
        }
      })
      .catch((err) => {
        res.status(500).send(err);
      })
  });

router.route('/messageSearch')
  .get(authHelper.isLoggedInMessages, function (req, res, next) {
    nconf.load();
    console.time('init');
    var dbtype = nconf.get('database:type');
    var pdwMode = nconf.get('messages:pdwMode');
    var adminShow = nconf.get('messages:adminShow');
    var maxLimit = nconf.get('messages:maxLimit');
    var HideCapcode = nconf.get('messages:HideCapcode');
    var apiSecurity = nconf.get('messages:apiSecurity');
    var defaultLimit = nconf.get('messages:defaultLimit');
    var initData = newInitData();
    var systemFilter = systems.parseFilter(req.query.system);

    if (typeof req.query.page !== 'undefined') {
      var page = parseInt(req.query.page, 10);
      if (page > 0) {
        initData.currentPage = page - 1;
      } else {
        initData.currentPage = 0;
      }
    }
    if (req.query.limit && req.query.limit <= maxLimit) {
      initData.limit = parseInt(req.query.limit, 10);
    } else {
      initData.limit = parseInt(defaultLimit, 10);
    }

    var rowCount;
    var query;
    var agency;
    var address;
    var alias;
    // dodgy handling for unexpected results
    if (typeof req.query.q !== 'undefined') {
      query = req.query.q;
    } else { query = ''; }
    if (typeof req.query.agency !== 'undefined') {
      agency = req.query.agency;
    } else { agency = ''; }
    if (typeof req.query.address !== 'undefined') {
      address = req.query.address;
    } else { address = ''; }
    if (typeof req.query.alias !== 'undefined') {
      alias = req.query.alias;
    } else { alias = ''; }

    // set select commands based on query type

    var data = []
    console.time('sql')
    db.select('messages.*', 'capcodes.alias', 'capcodes.agency', 'capcodes.icon', 'capcodes.color', 'capcodes.ignore', db.raw('CASE WHEN NOT capcodes.address = messages.address THEN 1 ELSE 0 END as wildcard'),
      'systems.name as system_name', 'systems.label as system_label', 'systems.color as system_color')
      .modify(function (qb) {
        if (dbtype == 'sqlite3' && query != '') {
          qb.from('messages_search_index')
            .leftJoin('messages', 'messages.id', '=', 'messages_search_index.rowid')
        } else {
          qb.from('messages');
        }
        if (pdwMode) {
          if (adminShow && req.isAuthenticated() && req.user.role == 'admin') {
            qb.leftJoin('capcodes', 'capcodes.id', '=', 'messages.alias_id');
          } else {
            qb.innerJoin('capcodes', 'capcodes.id', '=', 'messages.alias_id');
          }
        } else {
          qb.leftJoin('capcodes', 'capcodes.id', '=', 'messages.alias_id');
        }
        qb.leftJoin('systems', 'systems.id', '=', 'messages.system_id');
        if (dbtype == 'sqlite3' && query != '') {
          qb.whereRaw('messages_search_index MATCH ?', query)
        } else if (dbtype == 'mysql' && query != '') {
          //This wraps the search query in quotes so MySQL searches for the complete term rather than individual words.
          query = '"' + query + '"'
          qb.whereRaw(`MATCH(messages.message, messages.address, messages.source) AGAINST (? IN BOOLEAN MODE)`, query)
        } else if (dbtype == 'oracledb' && query != '') {
          qb.whereRaw(`CONTAINS("messages"."message", ?, 1) > 0`, query)
        } else {
          // Grouped. Without the parentheses this emitted
          //   address LIKE ? OR source = ? AND alias_id IN (...)
          // and AND binds tighter than OR, so combining an address with an
          // agency returned every message matching the address regardless of
          // agency, plus the ones the caller actually asked for.
          if (address != '')
            qb.where(function (qb2) {
              qb2.where('messages.address', 'LIKE', address).orWhere('messages.source', address);
            });
          if (agency != '')
            qb.whereIn('messages.alias_id', function (qb2) {
              qb2.select('id').from('capcodes').where('agency', agency).where('ignore', 0);
          })
          if (alias != '')
            qb.where('messages.alias_id',alias);
        }
        // Outside the branches above, so it applies to the full-text search and
        // the structured search alike. On sqlite the FTS branch already joins
        // messages, so this filters correctly after MATCH narrows the set -
        // no change to the virtual table is needed.
        if (systemFilter) qb.whereIn('messages.system_id', systemFilter);
      }).orderBy('messages.timestamp', 'desc')
      .then((rows) => {
        if (rows) {
          for (row of rows) {
            if (HideCapcode) {
              if (!req.isAuthenticated() || (req.isAuthenticated() && req.user.role == 'user')) {
                row = withoutCapcode(row);
              }
            }
            if (pdwMode) {
              if (adminShow && req.isAuthenticated() && req.user.role == 'admin' && !row.ignore || row.ignore == 0) {
                data.push(row);
              } else {
                if (row.ignore == 0)
                  data.push(row);
              }
            } else {
              if (!row.ignore || row.ignore == 0)
                data.push(row);
            }
          }
        } else {
          logger.main.info('empty results');
        }
        rowCount = data.length
        if (rowCount > 0) {
          console.timeEnd('sql');
          var result = data;
          console.time('initEnd');
          initData.msgCount = result.length;
          initData.pageCount = Math.ceil(initData.msgCount / initData.limit);
          if (initData.currentPage > initData.pageCount) {
            initData.currentPage = 0;
          }
          initData.offset = initData.limit * initData.currentPage;
          if (initData.offset < 0) {
            initData.offset = 0;
          }
          initData.offsetEnd = initData.offset + initData.limit;
          var limitResults = result.slice(initData.offset, initData.offsetEnd);
          console.timeEnd('initEnd');
          res.json({ 'init': initData, 'messages': limitResults });
        } else {
          console.timeEnd('sql');
          res.status(200).json({ 'init': {}, 'messages': [] });
        }
      })
      .catch((err) => {
        console.timeEnd('sql');
        logger.main.error(err);
        res.status(500).send(err);
      })
  });

router.route('/capcodes/init')
// DISABLED - UNKNOWN WHAT THIS WAS USED FOR 
/*  
  .get(authHelper.isAdmin, function (req, res, next) {
    //set current page if specifed as get variable (eg: /?page=2)
    if (typeof req.query.page !== 'undefined') {
      var page = parseInt(req.query.page, 10);
      if (page > 0)
        initData.currentPage = page - 1;
    }
    db.from('capcodes')
      .select('id')
      .orderBy('id', 'desc')
      .limit(1)
      .then((row) => {
        initData.msgCount = parseInt(row['id'], 10);
        //console.log(initData.msgCount);
        initData.pageCount = Math.ceil(initData.msgCount / initData.limit);
        var offset = initData.limit * initData.currentPage;
        initData.offset = initData.msgCount - offset;
        if (initData.offset < 0) {
          initData.offset = 0;
        }
        res.json(initData);
      })
      .catch((err) => {
        logger.main.error(err);
        return next(err);
      })
  });
*/
router.route('/capcodes')
  .get(authHelper.isAdmin, function (req, res, next) {
    nconf.load();
    var dbtype = nconf.get('database:type');
    var systemFilter = systems.parseFilter(req.query.system);
    db.from('capcodes')
      .select('capcodes.*', 'systems.name as system_name', 'systems.label as system_label', 'systems.color as system_color')
      .leftJoin('systems', 'systems.id', '=', 'capcodes.system_id')
      .modify(function (queryBuilder) {
        if (systemFilter) queryBuilder.whereIn('capcodes.system_id', systemFilter);
        if (dbtype == 'oracledb')
          queryBuilder.orderByRaw(`REPLACE("address", '_', '%')`);
        else
          queryBuilder.orderByRaw(`REPLACE(address, '_', '%')`)
      })
      .then((rows) => {
        res.json(rows);
      })
      .catch((err) => {
        logger.main.error(err);
        return next(err);
      })
  })
  .post(authHelper.isAdmin, async function (req, res, next) {
    nconf.load();
    var updateRequired = nconf.get('database:aliasRefreshRequired');
    if (req.body.address && req.body.alias) {
      var id = req.body.id || null;
      var address = req.body.address || 0;
      var alias = req.body.alias || 'null';
      var agency = req.body.agency || 'null';
      var color = req.body.color || 'black';
      var icon = req.body.icon || 'question';
      var ignore = req.body.ignore || 0;
      var pluginconf = JSON.stringify(req.body.pluginconf) || "{}";
      // An alias belongs to exactly one system. Resolved through the shared
      // helper so an omitted system_id lands in the default system rather than
      // creating a capcode that no ingest can ever match.
      var systemId;
      try {
        var systemRow = await systems.resolveForPost(req.user, req.body);
        systemId = systemRow ? systemRow.id : null;
      } catch (err) {
        logger.main.error(err);
        return res.status(500).send(err);
      }
      var record = {
        id: id,
        address: address,
        alias: alias,
        agency: agency,
        color: color,
        icon: icon,
        ignore: ignore,
        pluginconf: pluginconf,
        system_id: systemId
      };
      db.from('capcodes')
        .where('id', '=', id)
        .modify(function (queryBuilder) {
          if (id == null) {
            queryBuilder.insert(record)
          } else {
            queryBuilder.update(record)
          }
        })
        .returning('id')
        .then((result) => {
          res.status(200).send('' + result);
          if (!updateRequired || updateRequired == 0) {
            nconf.set('database:aliasRefreshRequired', 1);
            nconf.save();
          }
        })
        .catch((err) => {
          logger.main.error(err);
          res.status(500).send(err);
        })
      logger.main.debug(util.format('%o', req.body || 'no request body'));
    } else {
      res.status(500).json({ message: 'Error - address or alias missing' });
    }
  });

// Paging systems.
//
// The list is guarded with isLoggedInMessages, not isAdmin: it drives the
// system selector on the message list, which every viewer sees, and under
// apiSecurity=false that includes anonymous ones. /api/capcodes/agency is
// admin-only yet the front end calls it from the message view, which is a bug
// worth not repeating.
router.route('/systems')
  .get(authHelper.isLoggedInMessages, function (req, res, next) {
    systems.enabled()
      .then((rows) => {
        res.status(200).json(rows);
      })
      .catch((err) => {
        logger.main.error(err);
        return next(err);
      })
  })
  .post(authHelper.isAdmin, async function (req, res, next) {
    var name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Error - name is required' });
    try {
      var existing = await db('systems').where('name', name).first();
      if (existing) return res.status(400).json({ message: 'Error - a system with that name already exists' });
      var record = {
        name: name.substring(0, 64),
        label: (req.body.label || name).substring(0, 255),
        color: req.body.color || null,
        enabled: req.body.enabled == 0 ? 0 : 1,
        sortorder: parseInt(req.body.sortorder, 10) || 0,
        is_default: 0
      };
      var result = await db('systems').insert(record).returning('id');
      var id = Array.isArray(result) ? result[0] : result;
      // Exactly one row is the default; setting one clears the rest.
      if (req.body.is_default == 1) {
        await db('systems').update('is_default', 0);
        await db('systems').where('id', id).update('is_default', 1);
      }
      systems.invalidate();
      res.status(200).json({ status: 'ok', id: id });
    } catch (err) {
      logger.main.error(err);
      res.status(500).send(err);
    }
  });

router.route('/systems/:id')
  .get(authHelper.isAdmin, function (req, res, next) {
    if (req.params.id == 'new') {
      return res.status(200).json({ id: '', name: '', label: '', color: 'grey', enabled: 1, is_default: 0, sortorder: 0 });
    }
    db('systems').where('id', req.params.id).first()
      .then((row) => {
        res.status(200).json(row || {});
      })
      .catch((err) => {
        logger.main.error(err);
        return next(err);
      })
  })
  .post(authHelper.isAdmin, async function (req, res, next) {
    var id = req.params.id;
    try {
      if (id == 'new') {
        var name = (req.body.name || '').trim();
        if (!name) return res.status(400).json({ message: 'Error - name is required' });
        var clash = await db('systems').where('name', name).first();
        if (clash) return res.status(400).json({ message: 'Error - a system with that name already exists' });
        var inserted = await db('systems').insert({
          name: name.substring(0, 64),
          label: (req.body.label || name).substring(0, 255),
          color: req.body.color || null,
          enabled: req.body.enabled == 0 ? 0 : 1,
          sortorder: parseInt(req.body.sortorder, 10) || 0,
          is_default: 0
        }).returning('id');
        id = Array.isArray(inserted) ? inserted[0] : inserted;
      } else {
        var current = await db('systems').where('id', id).first();
        if (!current) return res.status(404).json({ message: 'Error - no such system' });
        var newName = (req.body.name || current.name).trim();
        var nameClash = await db('systems').where('name', newName).whereNot('id', id).first();
        if (nameClash) return res.status(400).json({ message: 'Error - a system with that name already exists' });
        await db('systems').where('id', id).update({
          name: newName.substring(0, 64),
          label: (req.body.label || newName).substring(0, 255),
          color: req.body.color || null,
          enabled: req.body.enabled == 0 ? 0 : 1,
          sortorder: parseInt(req.body.sortorder, 10) || 0
        });
      }
      if (req.body.is_default == 1) {
        await db('systems').update('is_default', 0);
        await db('systems').where('id', id).update('is_default', 1);
      }
      systems.invalidate();
      res.status(200).json({ status: 'ok', id: id });
    } catch (err) {
      logger.main.error(err);
      res.status(500).send(err);
    }
  })
  .delete(authHelper.isAdmin, async function (req, res, next) {
    try {
      var row = await db('systems').where('id', req.params.id).first();
      if (!row) return res.status(404).json({ message: 'Error - no such system' });
      // These guards are the only referential integrity there is: knex 0.16
      // ignores .references() when altering a sqlite table, and sqlite does not
      // enforce foreign keys without the pragma. Deleting a referenced system
      // would leave capcodes and messages pointing at nothing, invisible to
      // every filtered view.
      if (row.is_default == 1) {
        return res.status(400).json({ message: 'Error - the default system cannot be deleted' });
      }
      var capcodeCount = await db('capcodes').where('system_id', req.params.id).count('id as count').first();
      var messageCount = await db('messages').where('system_id', req.params.id).count('id as count').first();
      var capcodes = Number(capcodeCount.count || 0);
      var messages = Number(messageCount.count || 0);
      if (capcodes > 0 || messages > 0) {
        return res.status(400).json({
          message: 'Error - system still has ' + capcodes + ' alias(es) and ' + messages +
            ' message(s). Reassign or delete them first.'
        });
      }
      await db('systems').where('id', req.params.id).del();
      systems.invalidate();
      res.status(200).json({ status: 'ok' });
    } catch (err) {
      logger.main.error(err);
      res.status(500).send(err);
    }
  });

router.route('/capcodes/agency')
  .get(authHelper.isAdmin, function (req, res, next) {
    db.from('capcodes')
      .distinct('agency')
      .then((rows) => {
        res.status(200).json(rows);
      })
      .catch((err) => {
        res.status(500).send(err);
      })
  });

router.route('/capcodes/agency/:id')
  .get(authHelper.isAdmin, function (req, res, next) {
    var id = req.params.id;
    db.from('capcodes')
      .select('*')
      .where('agency', 'like', id)
      .then((rows) => {
        res.status(200).json(rows);
      })
      .catch((err) => {
        logger.main.error(err);
        return next(err);
      })
  });

router.route('/capcodes/:id')
  .get(authHelper.isAdmin, function (req, res, next) {
    var id = req.params.id;
    var defaults = {
      "id": "",
      "address": "",
      "alias": "",
      "agency": "",
      "icon": "question",
      "color": "black",
      "ignore": 0,
      "pluginconf": {},
      "system_id": null
    };
    if (id == 'new') {
      res.status(200).json(defaults);
    } else {
      db.from('capcodes')
        .select('*')
        .where('id', id)
        .then(function (row) {
          if (row.length > 0) {
            row = row[0]
            row.pluginconf = parseJSON(row.pluginconf);
            res.status(200).json(row);
          } else {
            res.status(200).json(defaults);
          }
        })
        .catch((err) => {
          logger.main.error(err);
          return next(err);
        })
    }
  })
  .post(authHelper.isAdmin, async function (req, res, next) {
    var dbtype = nconf.get('database:type');
    var id = req.params.id || req.body.id || null;
    nconf.load();
    var updateRequired = nconf.get('database:aliasRefreshRequired');
    if (id == 'deleteMultiple') {
      // do delete multiple
      var idList = req.body.deleteList || [0, 0];
      if (!idList.some(isNaN)) {
        logger.main.info('Deleting: ' + idList);
        db.from('capcodes')
          .del()
          .where('id', 'in', idList)
          .then((result) => {
            res.status(200).send({ 'status': 'ok' });
            if (!updateRequired || updateRequired == 0) {
              nconf.set('database:aliasRefreshRequired', 1);
              nconf.save();
            }
          }).catch((err) => {
            res.status(500).send(err);
          })
      } else {
        res.status(500).send({ 'status': 'id list contained non-numbers' });
      }
    } else {
      if (req.body.address && req.body.alias) {
        if (id == 'new') {
          id = null;
        }
        var address = req.body.address || 0;
        var alias = req.body.alias || 'null';
        var agency = req.body.agency || 'null';
        var color = req.body.color || 'black';
        var icon = req.body.icon || 'question';
        var ignore = req.body.ignore || 0;
        var pluginconf = JSON.stringify(req.body.pluginconf) || "{}";
        var updateAlias = req.body.updateAlias || 0;
        var systemId;
        try {
          var systemRow = await systems.resolveForPost(req.user, req.body);
          systemId = systemRow ? systemRow.id : null;
        } catch (err) {
          logger.main.error(err);
          return res.status(500).send(err);
        }
        var record = {
          id: id,
          address: address,
          alias: alias,
          agency: agency,
          color: color,
          icon: icon,
          ignore: ignore,
          pluginconf: pluginconf,
          system_id: systemId
        };

        console.time('insert');
        db.from('capcodes')
          .returning('id')
          .where('id', '=', id)
          .modify(function (queryBuilder) {
            if (id == null) {
              queryBuilder.insert(record)
            } else {
              queryBuilder.update(record)
            }
          })
          .then((result) => {
            console.timeEnd('insert');
            if (updateAlias == 1) {
              // Nothing in the current UI sets updateAlias, so this path is not
              // reachable today. It also compared messages.address against the
              // string literal 'address' rather than the capcodes column, so it
              // would have mapped almost everything to null had it ever run.
              console.time('updateMap');
              refreshAliasIds()
                .catch((err) => {
                  logger.main.error(err);
                })
                .finally(() => {
                  console.timeEnd('updateMap');
                })
            } else {
              //Check if we can refresh just this specific alias
              var specificRefresh = nconf.get('global:SpecificAliasRefresh');
              if (specificRefresh && /^\d+$/.test(req.body.address)) {
                //Refresh this specific Alias
                console.time('updateMap');
                // Scoped to the edited capcode's own system: only that system's
                // messages can be affected by the edit, and bounding the update
                // keeps one system's admin activity off another's rows.
                refreshAliasIds({ address: req.body.address, systemId: systemId })
                .catch((err) => {
                  logger.main.error(err);
                })
                .finally(() => {
                  console.timeEnd('updateMap');
                })
              } else {
                //We cannot update this specific Alias, so inform of required Alias Refresh
                if (!updateRequired || updateRequired == 0) {
                  nconf.set('database:aliasRefreshRequired', 1);
                  nconf.save();
                }
              }
            }
            res.status(200).send({ 'status': 'ok', 'id': result })
          })
          .catch((err) => {
            console.timeEnd('insert');
            logger.main.error(err)
            res.status(500).send(err);
          })
        logger.main.debug(util.format('%o', req.body || 'request body empty'));
      } else {
        res.status(500).json({ message: 'Error - address or alias missing' });
      }
    }
  })
  .delete(authHelper.isAdmin, function (req, res, next) {
    // delete single alias
    var id = parseInt(req.params.id, 10);
    nconf.load();
    var updateRequired = nconf.get('database:aliasRefreshRequired');
    logger.main.info('Deleting ' + id);
    db.from('capcodes')
      .del()
      .where('id', id)
      .then((result) => {
        res.status(200).send({ 'status': 'ok' });
        if (!updateRequired || updateRequired == 0) {
          nconf.set('database:aliasRefreshRequired', 1);
          nconf.save();
        }
      })
      .catch((err) => {
        res.status(500).send(err);
      })
    logger.main.debug(util.format('%o', req.body || 'request body empty'));
  });

router.route('/capcodeCheck/:id')
  .get(authHelper.isAdmin, async function (req, res, next) {
    var id = req.params.id;
    // "Does this address already exist" is only meaningful within a system:
    // the same address in two systems is the legitimate case this feature
    // exists to support, so an unscoped check would block it as a duplicate.
    var systemId = null;
    try {
      var systemRow = await systems.resolveForPost(req.user, req.query);
      systemId = systemRow ? systemRow.id : null;
    } catch (err) {
      logger.main.error(err);
      return next(err);
    }
    db.from('capcodes')
      .select('*')
      .where('address', id)
      .modify(function (queryBuilder) {
        if (systemId !== null) queryBuilder.where('system_id', systemId);
      })
      .then((row) => {
        if (row.length > 0) {
          row = row[0]
          row.pluginconf = parseJSON(row.pluginconf);
          res.status(200).json(row);
        } else {
          row = {
            "id": "",
            "address": "",
            "alias": "",
            "agency": "",
            "icon": "question",
            "color": "black",
            "ignore": 0,
            "pluginconf": {},
            "system_id": systemId
          };
          res.status(200).json(row);
        }
      })
      .catch((err) => {
        logger.main.error(err);
        return next(err);
      })
  });

router.route('/capcodeRefresh')
  .post(authHelper.isAdmin, function (req, res, next) {
    nconf.load();
    console.time('updateMap');
    refreshAliasIds()
      .then((count) => {
        console.timeEnd('updateMap');
        nconf.set('database:aliasRefreshRequired', 0);
        nconf.save();
        logger.main.info(`Alias refresh: remapped ${count} messages`);
        res.status(200).send({ 'status': 'ok' });
      })
      .catch((err) => {
        console.timeEnd('updateMap');
        logger.main.error(err);
        // The old handler logged and then never answered, so a failed refresh
        // left the request hanging until the client gave up.
        res.status(500).send({ 'status': 'error', 'error': err.message });
      })
  });

router.route('/capcodeExport')
  .post(authHelper.isAdmin, function (req, res, next) {
    nconf.load();
    var dbtype = nconf.get('database:type');
    var filename = 'export.csv'
    db.from('capcodes')
      // system name rather than system_id: ids are install-specific, and an
      // export is meant to be portable to another instance.
      .select('capcodes.*', 'systems.name as system')
      .leftJoin('systems', 'systems.id', '=', 'capcodes.system_id')
      .modify(function (queryBuilder) {
        if (dbtype == 'oracledb')
          queryBuilder.orderByRaw(`REPLACE("address", '_', '%')`);
        else
          queryBuilder.orderByRaw(`REPLACE(address, '_', '%')`)
      })
      .then((rows) => {
        converter.json2csv(rows, function (err, data) {
          if (err) {
            res.status(500).send(err);
          } else {
            res.status(200).send({ 'status': 'ok', 'data': data })
          }
        })
      })
      .catch((err) => {
        logger.main.error(err);
        return next(err);
      })
  });

router.route('/capcodeImport')
  .post(authHelper.isAdmin, function (req, res, next) {
    for (var key in req.body) {
      //remove newline chars from dataset - yes i realise we are adding them in admin.main.js, it doesn't submit without them.
      req.body[key] = req.body[key].replace(/[\r\n]/g, '');
    }
    // join data but remove the last newline to prevent the last one being malformed. 
    var importdata = req.body.join('\n').slice(0, -1);
    var importresults = [];
    converter.csv2jsonAsync(importdata)
      .then(async (data) => {
        var header = data[0]
        if (('address' in header) && ('alias' in header)) {
          //this checks if the csv has the required headings, should replace this with some form of proper validation
          // A CSV without a `system` column - i.e. one exported before this
          // feature - imports into the system the request resolves to, which
          // for a session admin is the default system.
          var fallbackSystem = await systems.resolveForPost(req.user, req.body || {});
          var fallbackSystemId = fallbackSystem ? fallbackSystem.id : null;
          for await (capcode of data) {
            var address = capcode.address || 0;
            var alias = capcode.alias || 'null';
            var agency = capcode.agency || 'null';
            var color = capcode.color || 'black';
            var icon = capcode.icon || 'question';
            var ignore = capcode.ignore || 0;
            var pluginconf = JSON.stringify(capcode.pluginconf) || "{}";
            var namedSystem = capcode.system ? await systems.byName(capcode.system) : null;
            var systemId = namedSystem ? namedSystem.id : fallbackSystemId;
            // Matched on (system_id, address), not address alone: the same
            // address in another system is a different alias, and matching it
            // here would overwrite that system's data.
            await db('capcodes')
              .returning('id')
              .where('address', '=', address)
              .where('system_id', '=', systemId)
              .first()
              .then((rows) => {
                if (rows) {
                  //Update the existing alias if one is found.
                  return db('capcodes')
                    .where('id', '=', rows.id)
                    .update({
                      address: address,
                      alias: alias,
                      agency: agency,
                      color: color,
                      icon: icon,
                      ignore: ignore,
                      pluginconf: pluginconf,
                      system_id: systemId
                    })
                    .then((result) => {
                      importresults.push({
                        address: address,
                        alias: alias,
                        result: 'updated'
                      })
                    })
                    .catch((err) => {
                      importresults.push({
                        address: address,
                        alias: alias,
                        result: 'failed' + err
                      })
                    })
                } else {
                  //Create new alias if one didn't get returned.
                  return db('capcodes').insert({
                    id: null,
                    address: address,
                    alias: alias,
                    agency: agency,
                    color: color,
                    icon: icon,
                    ignore: ignore,
                    pluginconf: pluginconf,
                    system_id: systemId
                  })
                    .then((result) => {
                      importresults.push({
                        address: address,
                        alias: alias,
                        result: 'created'
                      })
                    })
                    .catch((err) => {
                      importresults.push({
                        address: address,
                        alias: alias,
                        result: 'failed' + err
                      })
                    })
                }
              })
              .catch((err) => {
                importresults.push({
                  'address': address,
                  'alias': alias,
                  'result': 'failed' + err
                })
              });
          };
          //Gather all the results, format for the frontend and send it back.
          let results = { "results": importresults }
          res.status(200).json(results)
          logger.main.debug('Import:' + JSON.stringify(importresults))
          nconf.set('database:aliasRefreshRequired', 1);
          nconf.save();
        } else {
          throw 'Error parasing CSV header'
        }
      })
      .catch((err) => {
        res.status(500).send(err)
        logger.main.error(err)
      })
  });

router.route('/user')
  .get(authHelper.isAdmin, function (req, res, next) {
    db.from('users')
      .select('id','givenname','surname','username','email','role','status','lastlogondate')
      .then((rows) => {
        res.json(rows);
      })
      .catch((err) => {
        logger.main.error(err);
        return next(err);
      })
  }) 
  .post(authHelper.isAdmin, function (req, res, next) {
    if (req.body.username && req.body.email && req.body.givenname && req.body.password && req.body.status && req.body.role) {
      var username = req.body.username
      var email = req.body.email
      db.table('users')
        .where('username', '=', username)
        .orWhere('email', '=', email)
        .first()
        .then((row) => {
          if (row) {
            //add logging
            res.status(400).send({ 'status': 'error', 'error': 'Username or Email exists' });
          } else {
            var policyError = passwordpolicy.validate(req.body.password, { username: username, email: email });
            if (policyError) {
              return res.status(400).send({ 'status': 'error', 'error': policyError });
            }
            const salt = bcrypt.genSaltSync();
            const hash = bcrypt.hashSync(req.body.password, salt);

            return db('users')
              .insert({
                username: req.body.username,
                password: hash,
                givenname: req.body.givenname,
                surname: req.body.surname,
                email: req.body.email,
                role: req.body.role,
                status: req.body.status,
                lastlogondate: null
              })
              .returning('id')
              .then((response) => {
                //add logging
                logger.main.debug('created user id: ' + response)
                res.status(200).send({ 'status': 'ok', 'id': response[0] });
              })
              .catch((err) => {
                logger.main.error(err)
                res.status(500).send({ 'status': 'error' });
              });
          }
        })
    } else {
      res.status(400).send({ 'status': 'error', 'error': 'Invalid request body' });
    }
  });

router.route('/userCheck/username/:id')
  .get(authHelper.isAdmin, function (req, res, next) {
    var id = req.params.id;
    db.from('users')
      .select('id','givenname','surname','username','email','role','status','lastlogondate')
      .where('username', id)
      .then((row) => {
        if (row.length > 0) {
          row = row[0]
          res.status(200).json(row);
        } else {
          row = {
            "username": "",
            "password": "",
            "givenname": "",
            "surname": "",
            "email": "",
            "role": "user",
            "status": "active"
          };
          res.status(200).json(row);
        }
      })
      .catch((err) => {
        logger.main.error(err);
        return next(err);
      })
  });

  router.route('/userCheck/email/:id')
  .get(authHelper.isAdmin, function (req, res, next) {
    var id = req.params.id;
    db.from('users')
      .select('id','givenname','surname','username','email','role','status','lastlogondate')
      .where('email', id)
      .then((row) => {
        if (row.length > 0) {
          row = row[0]
          res.status(200).json(row);
        } else {
          row = {
            "username": "",
            "password": "",
            "givenname": "",
            "surname": "",
            "email": "",
            "role": "user",
            "status": "active"
          };
          res.status(200).json(row);
        }
      })
      .catch((err) => {
        logger.main.error(err);
        return next(err);
      })
  });

router.route('/user/:id')
  .get(authHelper.isAdmin, function (req, res, next) {
    var id = req.params.id;
    var defaults = {
      "username": "",
      "password": "",
      "givenname": "",
      "surname": "",
      "email": "",
      "role": "user",
      "status": "active"
    };
    if (id == 'new') {
      res.status(200).json(defaults);
    } else {
      db.from('users')
        .select('id','givenname','surname','username','email','role','status','lastlogondate')
        .where('id', id)
        .then(function (row) {
          if (row.length > 0) {
            row = row[0]
            res.status(200).json(row);
          } else {
            res.status(200).json(defaults);
          }
        })
        .catch((err) => {
          logger.main.error(err);
          return next(err);
        })
    }
  })
  .post(authHelper.isAdmin, function (req, res, next) {
    var id = req.params.id || req.body.id || null;
    if (id == 'deleteMultiple') {
      // do delete multiple
      var idList = req.body.deleteList || [0, 0];
      if (!idList.some(isNaN)) {
        //ADD CHECK TO NOT ALLOW DELETION OF USERID 1
        logger.main.info('Deleting: ' + idList);
        db.from('users')
          .del()
          .where('id', 'in', idList)
          .then((result) => {
            res.status(200).send({ 'status': 'ok' });

          }).catch((err) => {
            res.status(500).send(err);
          })
      } else {
        res.status(400).send({ 'status': 'error', 'error': 'id list contained non-numbers' });
      }
    } else {
      if (req.body.username && req.body.email && req.body.givenname) {
        var password = req.body.newpassword || req.body.password||  null;
        if (id == 'new') {
          // Password is a required field if this is a new account check for that
          if (!req.body.password) {
            return res.status(400).send({'status': 'error', 'error': 'Error - required field missing' });
          } else {
            id = null;
          }
        }
        if (password != null) {
          var policyError = passwordpolicy.validate(password, { username: req.body.username, email: req.body.email });
          if (policyError) {
            return res.status(400).send({ 'status': 'error', 'error': policyError });
          }
        }
        console.time('insert');
        db.from('users')
          .returning('id')
          .where('id', '=', id)
          .modify(function (queryBuilder) {
            const userobj ={
              id: id,
              username: req.body.username,
              givenname: req.body.givenname,
              surname: req.body.surname || '',
              email: req.body.email,
              role: req.body.role || 'user',
              status: req.body.status || 'disabled',
            }
            if (password != null) {
              const salt = bcrypt.genSaltSync();
              const hash = bcrypt.hashSync(password, salt);
              userobj.password = hash
              // An admin resetting a password is usually responding to a
              // suspected compromise, so it has to evict the account's existing
              // sessions the same way a self-service reset does - see
              // middleware/sessionversion.js.
              userobj.pwchangedat = Math.floor(Date.now() / 1000)
              if (id == null) {
                userobj.lastlogondate = null
                queryBuilder.insert(userobj)
              } else {
                queryBuilder.update(userobj)
              }
            } else {
              queryBuilder.update(userobj)
            }
          })
          .returning('id')
          .then((result) => {
            console.timeEnd('insert');
            res.status(200).send({ 'status': 'ok', 'id': result[0] })
          })
          .catch((err) => {
            console.timeEnd('insert');
            logger.main.error(err)
            res.status(500).send(err);
          })
      } else {
        res.status(400).send({'status': 'error', 'error': 'Error - required field missing' });
      }
    }
  })
  .delete(authHelper.isAdmin, function (req, res, next) {
    var id = parseInt(req.params.id, 10);
    if (id != 1) {
      logger.main.info('Deleting User ' + id);
      db.from('users')
        .del()
        .where('id', id)
        .then((result) => {
          res.status(200).send({ 'status': 'ok' });
        })
        .catch((err) => {
          res.status(500).send(err);
          logger.main.error(err)
        })
    } else {
      res.status(400).json({ 'error': 'User ID 1 is protected' });
      logger.main.error('Unable to delete user ID 1')
    }
  });

router.use([handleError]);

module.exports = router;

function handleError(err, req, res, next) {
  var output = {
    error: {
      name: err.name,
      message: err.message,
      text: err.toString()
    }
  };
  var statusCode = err.status || 500;
  res.status(statusCode).json(output);
}

function parseJSON(json) {
  var parsed;
  try {
    parsed = JSON.parse(json)
  } catch (e) {
    // ignore errors
  }
  return parsed;
}
