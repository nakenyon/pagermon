const basicAuth = require('express-basic-auth');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const converter = require('json-2-csv');
const db = require('../knex/knex.js');
const express = require('express');
const logger = require('../log');
const nconf = require('nconf');
const util = require('util');
const _ = require('underscore');

const router = express.Router();

const confFile = './config/config.json';
nconf.file({ file: confFile });
nconf.load();

router.use(bodyParser.json());       // to support JSON-encoded bodies
router.use(bodyParser.urlencoded({     // to support URL-encoded bodies
        extended: true
}));

const authHelper = require('../middleware/authhelper')

router.use(function (req, res, next) {
  res.locals.login = req.isAuthenticated();
  res.locals.user = req.user || false;
  next();
});




router.route('/capcodes/:id')
  .post(authHelper.isAdmin, function (req, res, next) {
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
        var pluginconf = JSON.stringify(vaccumPluginConf(req.body.pluginconf)) || "{}";
        var updateAlias = req.body.updateAlias || 0;
        const onlyShowLoggedIn = req.body.onlyShowLoggedIn || 0;

        console.time('insert');
        db.from('capcodes')
          .returning('id')
          .where('id', '=', id)
          .modify(function (queryBuilder) {
            if (id == null) {
              queryBuilder.insert({
                id,
                address,
                alias,
                agency,
                color,
                icon,
                ignore,
                pluginconf,
                onlyShowLoggedIn
              })
            } else {
              queryBuilder.update({
                id,
                address,
                alias,
                agency,
                color,
                icon,
                ignore,
                pluginconf,
                onlyShowLoggedIn
              })
            }
          })
          .then((result) => {
            console.timeEnd('insert');
            if (updateAlias == 1) {
              console.time('updateMap');
              db('messages')
                .update('alias_id', function () {
                  this.select('id')
                    .from('capcodes')
                    .where('messages.address', 'like', 'address')
                    .modify(function (queryBuilder) {
                      if (dbtype == 'oracledb')
                        queryBuilder.orderByRaw(`REPLACE("address", '_', '%') DESC`);
                      else
                        queryBuilder.orderByRaw(`REPLACE(address, '_', '%') DESC`)
                    })
                    .limit(1)
                })
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
                db('messages').update('alias_id', function () {
                  this.select('id')
                    .from('capcodes')
                    .where(db.ref('messages.address'), 'like', db.ref('capcodes.address'))
                    .modify(function (queryBuilder) {
                      if (dbtype == 'oracledb')
                        queryBuilder.orderByRaw(`REPLACE("address", '_', '%') DESC`);
                      else
                        queryBuilder.orderByRaw(`REPLACE(address, '_', '%') DESC`)
                  })
                  .limit(1)
                })
                .where(db.ref('messages.address'), '=', req.body.address)
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
        res.status(400).json({ message: 'Error - address or alias missing' });
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

router.route('/capcodeRefresh')
  .post(authHelper.isAdmin, function (req, res, next) {
    nconf.load();
    var dbtype = nconf.get('database:type');
    console.time('updateMap');
    db('messages').update('alias_id', function () {
      this.select('id')
        .from('capcodes')
        .where(db.ref('messages.address'), 'like', db.ref('capcodes.address'))
        .modify(function (queryBuilder) {
          if (dbtype == 'oracledb')
            queryBuilder.orderByRaw(`REPLACE("address", '_', '%') DESC`);
          else
            queryBuilder.orderByRaw(`REPLACE(address, '_', '%') DESC`)
        })
        .limit(1)
    })
      .then((result) => {
        console.timeEnd('updateMap');
        nconf.set('database:aliasRefreshRequired', 0);
        nconf.save();
        res.status(200).send({ 'status': 'ok' });
      })
      .catch((err) => {
        logger.main.error(err);
        console.timeEnd('updateMap');
      })
  });

router.route('/capcodeExport')
  .post(authHelper.isAdmin, function (req, res, next) {
    nconf.load();
    var dbtype = nconf.get('database:type');
    var filename = 'export.csv'
    db.from('capcodes')
      .select('*')
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
          for await (capcode of data) {
            var address = capcode.address || 0;
            var alias = capcode.alias || 'null';
            var agency = capcode.agency || 'null';
            var color = capcode.color || 'black';
            var icon = capcode.icon || 'question';
            var ignore = capcode.ignore || 0;
            const  pluginconf = JSON.stringify(vaccumPluginConf(capcode.pluginconf)) || "{}";
            const onlyShowLoggedIn = capcode.onlyShowLoggedIn || false;
            await db('capcodes')
              .returning('id')
              .where('address', '=', address)
              .first()
              .then((rows) => {
                if (rows) {
                  //Update the existing alias if one is found.
                  return db('capcodes')
                    .where('id', '=', rows.id)
                    .update({
                      address,
                      alias,
                      agency,
                      color,
                      icon,
                      ignore,
                      pluginconf,
                      onlyShowLoggedIn,
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
                        result: 'failed ' + err
                      })
                    })
                } else {
                  //Create new alias if one didn't get returned.
                  return db('capcodes').insert({
                    id: null,
                    address,
                    alias,
                    agency,
                    color,
                    icon,
                    ignore,
                    pluginconf,
                    onlyShowLoggedIn,
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
          res.status(200)
          res.json(results)
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
                res.status(200).send({ 'status': 'ok', 'id': response[0].id });
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
          res.status(200);
          res.json(row);
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
          res.status(200);
          res.json(row);
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
          res.status(200);
          res.json(row);
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
          res.status(200);
          res.json(row);
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
      res.status(200);
      res.json(defaults);
    } else {
      db.from('users')
        .select('id','givenname','surname','username','email','role','status','lastlogondate')
        .where('id', id)
        .then(function (row) {
          if (row.length > 0) {
            row = row[0]
            res.status(200);
            res.json(row);
          } else {
            res.status(200);
            res.json(defaults);
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
            res.status(200).send({ 'status': 'ok', 'id': result[0].id })
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