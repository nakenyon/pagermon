const express = require('express');
const bodyParser = require('body-parser');

const router = express.Router();
const bcrypt = require('bcryptjs');
const util = require('util');
const _ = require('underscore');
const { pickBy } = require('underscore');
const converter = require('json-2-csv');
const nconf = require('nconf');
const pluginHandler = require('../plugins/pluginHandler');
const logger = require('../log');
const db = require('../knex/knex');

const confFile = './config/config.json';
nconf.file({ file: confFile });
nconf.load();

router.use(bodyParser.json()); // to support JSON-encoded bodies
router.use(
    bodyParser.urlencoded({
        // to support URL-encoded bodies
        extended: true,
    })
);

const authHelper = require('../middleware/authhelper');

router.use((req, res, next) => {
    res.locals.login = req.isAuthenticated();
    res.locals.user = req.user || false;
    next();
});

// defaults
const initData = {};
initData.limit = nconf.get('messages:defaultLimit');
initData.replaceText = nconf.get('messages:replaceText');
initData.currentPage = 0;
initData.pageCount = 0;
initData.msgCount = 0;
initData.offset = 0;

// auth variables
const HideCapcode = nconf.get('messages:HideCapcode');

// dupe init
const msgBuffer = [];

router
    .route('/messages')
    .get(authHelper.isLoggedInMessages, (req, res) => {
        nconf.load();
        console.time('init');
        const pdwMode = nconf.get('messages:pdwMode');
        const adminShow = nconf.get('messages:adminShow');
        const maxLimit = nconf.get('messages:maxLimit');
        const defaultLimit = nconf.get('messages:defaultLimit');
        const hideCapcode = nconf.get('messages:HideCapcode');

        initData.replaceText = nconf.get('messages:replaceText');
        if (typeof req.query.page !== 'undefined') {
            const page = parseInt(req.query.page, 10);
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
        let subquery;
        if (pdwMode) {
            if (adminShow && req.isAuthenticated() && req.user.role === 'admin') {
                subquery = db.from('capcodes').where('ignore', '=', 1).select('id');
            } else {
                subquery = db.from('capcodes').where('ignore', '=', 0).select('id');
            }
        } else {
            subquery = db.from('capcodes').where('ignore', '=', 1).select('id');
        }
        db.from('messages')
            .where(function () {
                if (!req.isAuthenticated) this.where('capcodes.onlyShowLoggedIn', false);
                if (pdwMode) {
                    if (adminShow && req.isAuthenticated() && req.user.role === 'admin') {
                        this.from('messages').where('alias_id', 'not in', subquery).orWhereNull('alias_id');
                    } else {
                        this.from('messages').where('alias_id', 'in', subquery);
                    }
                } else {
                    this.from('messages').where('alias_id', 'not in', subquery).orWhereNull('alias_id');
                }
            })
            .count('* as msgcount')
            .then((initcount) => {
                const count = initcount[0];
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

                    const result = [];
                    let rowCount;

                    db.from('messages')
                        .select(
                            'messages.*',
                            'capcodes.alias',
                            'capcodes.agency',
                            'capcodes.icon',
                            'capcodes.color',
                            'capcodes.ignore',
                            db.raw('CASE WHEN NOT capcodes.address = messages.address THEN 1 ELSE 0 END as wildcard')
                        )
                        .modify((queryBuilder) => {
                            if (!req.isAuthenticated()) queryBuilder.where('capcodes.onlyShowLoggedIn', false);
                            if (pdwMode) {
                                if (adminShow && req.isAuthenticated() && req.user.role === 'admin') {
                                    queryBuilder
                                        .leftJoin('capcodes', 'capcodes.id', '=', 'messages.alias_id')
                                        .where('capcodes.ignore', 0)
                                        .orWhereNull('capcodes.ignore');
                                } else {
                                    queryBuilder
                                        .innerJoin('capcodes', 'capcodes.id', '=', 'messages.alias_id')
                                        .where('capcodes.ignore', 0);
                                }
                            } else {
                                queryBuilder
                                    .leftJoin('capcodes', 'capcodes.id', '=', 'messages.alias_id')
                                    .where('capcodes.ignore', 0)
                                    .orWhereNull('capcodes.ignore');
                            }
                        })
                        .orderBy('messages.timestamp', 'desc')
                        .limit(initData.limit)
                        .offset(initData.offset)
                        .then((rows) => {
                            rowCount = rows.length;
                            rows.forEach((row) => {
                                /* eslint-disable no-param-reassign */
                                row.datetime = row.timestamp; // Copy timestamp to datetime  for backwards compatibilty

                                // outRow = JSON.parse(newrow);
                                if (hideCapcode) {
                                    if (!req.isAuthenticated() || (req.isAuthenticated() && req.user.role === 'user')) {
                                        row = {
                                            id: row.id,
                                            message: row.message,
                                            source: row.source,
                                            timestamp: row.timestamp,
                                            datetime: row.datetime,
                                            alias_id: row.alias_id,
                                            alias: row.alias,
                                            agency: row.agency,
                                            icon: row.icon,
                                            color: row.color,
                                            ignore: row.ignore,
                                        };
                                    }
                                }
                                if (row) {
                                    result.push(row);
                                } else {
                                    logger.main.info('empty results');
                                }
                                /* eslint-enable no-param-reassign */
                            });
                        })
                        .catch((err) => {
                            logger.main.error(err);
                        })
                        .finally(() => {
                            if (rowCount > 0) {
                                console.timeEnd('sql');
                                // var limitResults = result.slice(initData.offset, initData.offsetEnd);
                                console.time('send');
                                res.status(200).json({ init: initData, messages: result });
                                console.timeEnd('send');
                            } else {
                                res.status(200).json({ init: {}, messages: [] });
                            }
                        });
                }
            });
    })
    .post(authHelper.isAdmin, (req, res) => {
        nconf.load();
        if (req.body.address && req.body.message) {
            const dbtype = nconf.get('database:type');
            const filterDupes = nconf.get('messages:duplicateFiltering');
            const dupeLimit = nconf.get('messages:duplicateLimit') || 0; // default 0
            const dupeTime = nconf.get('messages:duplicateTime') || 0; // default 0
            const pdwMode = nconf.get('messages:pdwMode');
            const adminShow = nconf.get('messages:adminShow');
            let data = req.body;
            data.pluginData = {};

            let timestamp;
            if (data.timestamp) timestamp = data.timestamp;
            else if (data.datetime) {
                logger.main.warn(
                    `An incoming message from ${data.source || 'an unknown source'} contains the timestamp as field 'datetime'. Update the message source to use the variable 'timestamp' instead!`
                );
                timestamp = data.datetime;
            } else timestamp = Date.now();

            if (filterDupes) {
                // this is a bad solution and tech debt that will bite us in the ass if we ever go HA, but that's a problem for future me and that guy's a dick

                const timeDiff = timestamp - dupeTime;
                // if duplicate filtering is enabled, we want to populate the message buffer and check for duplicates within the limits
                const matches = _.where(msgBuffer, {
                    message: data.message,
                    address: data.address,
                });
                if (matches.length > 0) {
                    if (dupeTime !== 0) {
                        // search the matching messages and see if any match the time constrain
                        const timeFind = _.find(matches, (msg) => msg.timestamp > timeDiff);
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
                let dupeArrayLimit = dupeLimit;
                if (dupeArrayLimit === 0) {
                    dupeArrayLimit = 25; // should provide sufficient buffer, consider increasing if duplicates appear when users have no dupeLimit
                }
                if (msgBuffer.length > dupeArrayLimit) {
                    msgBuffer.shift();
                }
                msgBuffer.push(_.pick(data, ['message', 'timestamp', 'address']));
            }

            // send data to pluginHandler before proceeding
            logger.main.debug('beforeMessage start');
            pluginHandler.handle('message', 'before', data, (pluginResponseBefore) => {
                logger.main.debug(util.format('%o', pluginResponseBefore));
                logger.main.debug('beforeMessage done');
                if (pluginResponseBefore && pluginResponseBefore.pluginData) {
                    // only set data to the response if it's non-empty and still contains the pluginData object
                    data = pluginResponseBefore;
                }
                if (data.pluginData.ignore) {
                    // stop processing
                    return res.status(200).send('Ignoring filtered');
                }
                const address = data.address || '0000000';
                const message = data.message || 'null';
                const timeDiff = timestamp - dupeTime;
                const source = data.source || 'UNK';
                db.from('messages')
                    .select('*')
                    .modify((queryBuilder) => {
                        if (dupeLimit !== 0 && dupeTime !== 0) {
                            queryBuilder
                                .where('id', 'in', (qb) => {
                                    qb.select('*')
                                        // this wierd subquery is to keep mysql happy
                                        .from((qb2) => {
                                            qb2.select('id')
                                                .from('messages')
                                                .where('timestamp', '>', timeDiff)
                                                .orderBy('id', 'desc')
                                                .limit(dupeLimit)
                                                .as('temp_tab');
                                        });
                                })
                                .andWhere('message', '=', message)
                                .andWhere('address', '=', address);
                        } else if (dupeLimit !== 0 && dupeTime === 0) {
                            queryBuilder
                                .where('id', 'in', (qb) => {
                                    qb.select('*')
                                        // this wierd subquery is to keep mysql happy
                                        .from((qb2) => {
                                            qb2.select('id')
                                                .from('messages')
                                                .orderBy('id', 'desc')
                                                .limit(dupeLimit)
                                                .as('temp_tab');
                                        });
                                })
                                .andWhere('message', '=', message)
                                .andWhere('address', '=', address);
                        } else if (dupeLimit === 0 && dupeTime !== 0) {
                            queryBuilder
                                .where('id', 'in', function () {
                                    this.select('id').from('messages').where('timestamp', '>', timeDiff);
                                })
                                .andWhere('message', '=', message)
                                .andWhere('address', '=', address);
                        } else {
                            queryBuilder.where('message', '=', message).andWhere('address', '=', address);
                        }
                    })
                    .then((dbDupes) => {
                        if (dbDupes.length > 0 && filterDupes) {
                            logger.main.info(util.format('Ignoring duplicate: %o', message));
                            res.status(200).send('Ignoring duplicate');
                        } else {
                            db.from('capcodes')
                                .first('id', 'ignore')
                                // TODO: test this doesn't break other DBs - there's a lot of quote changes here
                                .modify((queryBuilder) => {
                                    if (dbtype === 'oracledb') {
                                        queryBuilder.whereRaw(`'${address}' LIKE "address"`);
                                        queryBuilder.orderByRaw(`REPLACE("address", '_', '%') DESC`);
                                    } else {
                                        queryBuilder.whereRaw(`"${address}" LIKE address`);
                                        queryBuilder.orderByRaw(`REPLACE(address, '_', '%') DESC`);
                                    }
                                })
                                .then((capcode) => {
                                    let aliasId = null;
                                    if (capcode && capcode.ignore === 1) {
                                        logger.main.info(`Ignoring filtered address: ${address} alias: ${capcode.id}`);
                                        return res.status(200).send('Ignoring filtered');
                                    }
                                    if (capcode) aliasId = capcode.id;

                                    // overwrite alias_id if set from plugin
                                    if (data.pluginData.aliasId) {
                                        aliasId = data.pluginData.aliasId;
                                    }

                                    const insertmsg = {
                                        address,
                                        message,
                                        timestamp,
                                        source,
                                        alias_id: aliasId,
                                    };
                                    db('messages')
                                        .insert(insertmsg)
                                        .then((result) => {
                                            // emit the full message
                                            const msgId = Object.keys(result[0]).includes('id')
                                                ? result[0].id
                                                : result[0];

                                            if (dbtype === 'oracledb') {
                                                // oracle requires update of search index after insert, can't be trigger for some reason
                                                db.raw(`BEGIN CTX_DDL.SYNC_INDEX('search_idx'); END;`)
                                                    .then((resp) => {
                                                        logger.main.debug('search_idx sync complete');
                                                        logger.main.debug(resp);
                                                    })
                                                    .catch((err) => {
                                                        logger.main.error('search_idx sync failed');
                                                        logger.main.error(err);
                                                    });
                                            }

                                            db.from('messages')
                                                .first(
                                                    'messages.*',
                                                    'capcodes.alias',
                                                    'capcodes.agency',
                                                    'capcodes.icon',
                                                    'capcodes.color',
                                                    'capcodes.ignore',
                                                    'capcodes.pluginconf',
                                                    'capcodes.onlyShowLoggedIn'
                                                )
                                                .modify((queryBuilder) => {
                                                    queryBuilder.leftJoin(
                                                        'capcodes',
                                                        'capcodes.id',
                                                        '=',
                                                        'messages.alias_id'
                                                    );
                                                })
                                                .where('messages.id', '=', msgId)
                                                .then((msgCapcodeJoined) => {
                                                    if (msgCapcodeJoined) {
                                                        // send data to pluginHandler after processing
                                                        msgCapcodeJoined.pluginData = data.pluginData;

                                                        // Copy timestamp to datetime for backwards compatibility.
                                                        msgCapcodeJoined.datetime = msgCapcodeJoined.timestamp;

                                                        if (msgCapcodeJoined.pluginconf) {
                                                            msgCapcodeJoined.pluginconf = parseJSON(
                                                                msgCapcodeJoined.pluginconf
                                                            );
                                                        } else {
                                                            msgCapcodeJoined.pluginconf = {};
                                                        }
                                                        logger.main.debug('afterMessage start');
                                                        pluginHandler.handle(
                                                            'message',
                                                            'after',
                                                            msgCapcodeJoined,
                                                            (pluginResponseAfter) => {
                                                                logger.main.debug(
                                                                    util.format('%o', pluginResponseAfter)
                                                                );
                                                                logger.main.debug('afterMessage done');
                                                                // remove the pluginconf object before firing socket message
                                                                delete msgCapcodeJoined.pluginconf;
                                                                const fields = [
                                                                    'id',
                                                                    'message',
                                                                    'source',
                                                                    'timestamp',
                                                                    'datetime',
                                                                    'alias_id',
                                                                    'alias',
                                                                    'agency',
                                                                    'icon',
                                                                    'color',
                                                                    'ignore',
                                                                ];
                                                                if (!HideCapcode) fields.push('address'); // Show address, when hideCapcode is off.
                                                                const rowUser = _.pick(msgCapcodeJoined, fields);

                                                                /*
                                  If:
                                  - The admin has no alias
                                  - And pdw mode is on
                                  -> Do not send to users
                                  -> If
                                    - AdminShow is on
                                    -> Do send to admins though
                                */
                                                                if (pdwMode) {
                                                                    if (msgCapcodeJoined.alias_id === null) {
                                                                        if (adminShow)
                                                                            req.io
                                                                                .to('admin')
                                                                                .emit('messagePost', msgCapcodeJoined);
                                                                    } else {
                                                                        req.io
                                                                            .to('admin')
                                                                            .emit('messagePost', msgCapcodeJoined);
                                                                        req.io.to('user').emit('messagePost', rowUser);
                                                                        if (!msgCapcodeJoined.onlyShowLoggedIn)
                                                                            req.io
                                                                                .to('anonymous')
                                                                                .emit('messagePost', rowUser);
                                                                    }
                                                                } else {
                                                                    req.io
                                                                        .to('admin')
                                                                        .emit('messagePost', msgCapcodeJoined);
                                                                    req.io.to('user').emit('messagePost', rowUser);
                                                                    if (!msgCapcodeJoined.onlyShowLoggedIn)
                                                                        req.io
                                                                            .to('anonymous')
                                                                            .emit('messagePost', rowUser);
                                                                }
                                                            }
                                                        );
                                                    }
                                                    res.status(200).send(`${msgId}`);
                                                })
                                                .catch((err) => {
                                                    res.status(500).send(err);
                                                    logger.main.error(err);
                                                });
                                        })
                                        .catch((err) => {
                                            res.status(500).send(err);
                                            logger.main.error(err);
                                        });
                                })
                                .catch((err) => {
                                    res.status(500).send(err);
                                    logger.main.error(err);
                                });
                        }
                    })
                    .catch((err) => {
                        res.status(500).send(err);
                        logger.main.error(err);
                    });
            });
        } else {
            res.status(400).json({ message: 'Error - address or message missing' });
        }
    });

router.route('/messages/:id').get(authHelper.isLoggedInMessages, (req, res, next) => {
    nconf.load();
    const pdwMode = nconf.get('messages:pdwMode');
    const hideCapcode = nconf.get('messages:HideCapcode');
    const { id } = req.params;

    db.from('messages')
        .first(
            'messages.*',
            'capcodes.alias',
            'capcodes.agency',
            'capcodes.icon',
            'capcodes.color',
            'capcodes.ignore',
            db.raw('CASE WHEN NOT capcodes.address = messages.address THEN 1 ELSE 0 END as wildcard')
        )
        .leftJoin('capcodes', 'capcodes.id', '=', 'messages.alias_id')
        .where('messages.id', id)
        .modify((qb) => {
            if (!req.isAuthenticated()) qb.where('capcodes.onlyShowLoggedIn', false);
        })
        .then((message) => {
            if (!message) {
                return res.status(200).json({});
            }

            let responseData;
            if (hideCapcode) {
                if (!req.isAuthenticated() || (req.isAuthenticated() && req.user.role === 'user')) {
                    responseData = {
                        id: message.id,
                        message: message.message,
                        source: message.source,
                        datetime: message.timestamp,
                        timestamp: message.timestamp,
                        alias_id: message.alias_id,
                        alias: message.alias,
                        agency: message.agency,
                        icon: message.icon,
                        color: message.color,
                        ignore: message.ignore,
                    };
                } else {
                    responseData = message; // Default behavior if HideCapcode is false
                }
            } else {
                responseData = message;
            }
            // Apply additional conditions for the final response
            if (responseData.ignore === 1) {
                res.status(200).json({});
            } else if (pdwMode && !responseData.alias) {
                res.status(200).json({});
            } else {
                res.status(200).json(responseData); // Use responseData instead of row
            }
        })
        .catch((err) => {
            console.log(err);
            res.status(500).send(err);
        });
});

router.route('/messageSearch').get(authHelper.isLoggedInMessages, (req, res, next) => {
    nconf.load();
    console.time('init');
    const dbtype = nconf.get('database:type');
    const pdwMode = nconf.get('messages:pdwMode');
    const adminShow = nconf.get('messages:adminShow');
    const maxLimit = nconf.get('messages:maxLimit');
    const hideCapcode = nconf.get('messages:HideCapcode');
    const defaultLimit = nconf.get('messages:defaultLimit');
    initData.replaceText = nconf.get('messages:replaceText');

    if (typeof req.query.page !== 'undefined') {
        const page = parseInt(req.query.page, 10);
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

    let rowCount;
    let query;
    let agency;
    let address;
    let alias;
    // dodgy handling for unexpected results
    if (typeof req.query.q !== 'undefined') {
        query = req.query.q;
    } else {
        query = '';
    }
    if (typeof req.query.agency !== 'undefined') {
        agency = req.query.agency;
    } else {
        agency = '';
    }
    if (typeof req.query.address !== 'undefined') {
        address = req.query.address;
    } else {
        address = '';
    }
    if (typeof req.query.alias !== 'undefined') {
        alias = req.query.alias;
    } else {
        alias = '';
    }

    // set select commands based on query type

    const data = [];
    console.time('sql');
    db.select(
        'messages.*',
        'capcodes.alias',
        'capcodes.agency',
        'capcodes.icon',
        'capcodes.color',
        'capcodes.ignore',
        db.raw('CASE WHEN NOT capcodes.address = messages.address THEN 1 ELSE 0 END as wildcard')
    )
        .modify((qb) => {
            if (dbtype === 'sqlite3' && query !== '') {
                qb.from('messages_search_index').leftJoin(
                    'messages',
                    'messages.id',
                    '=',
                    'messages_search_index.rowid'
                );
            } else {
                qb.from('messages');
            }
            if (pdwMode) {
                if (adminShow && req.isAuthenticated() && req.user.role === 'admin') {
                    qb.leftJoin('capcodes', 'capcodes.id', '=', 'messages.alias_id');
                } else {
                    qb.innerJoin('capcodes', 'capcodes.id', '=', 'messages.alias_id');
                }
            } else {
                qb.leftJoin('capcodes', 'capcodes.id', '=', 'messages.alias_id');
            }
            if (dbtype === 'sqlite3' && query !== '') {
                qb.whereRaw('messages_search_index MATCH ?', query);
            } else if (dbtype === 'mysql' && query !== '') {
                // This wraps the search query in quotes so MySQL searches for the complete term rather than individual words.
                query = `"${query}"`;
                qb.whereRaw(
                    `MATCH(messages.message, messages.address, messages.source) AGAINST (? IN BOOLEAN MODE)`,
                    query
                );
            } else if (dbtype === 'oracledb' && query !== '') {
                qb.whereRaw(`CONTAINS("messages"."message", ?, 1) > 0`, query);
            } else {
                if (address !== '') qb.where('messages.address', 'LIKE', address).orWhere('messages.source', address);
                if (agency !== '')
                    qb.whereIn('messages.alias_id', (qb2) => {
                        qb2.select('id').from('capcodes').where('agency', agency).where('ignore', 0);
                    });
                if (alias !== '') {
                    if (alias === '-1') qb.whereNull('messages.alias_id');
                    else qb.where('messages.alias_id', alias);
                }
            }
        })
        .orderBy('messages.timestamp', 'desc')
        .then((messages) => {
            if (messages) {
                for (let message of messages) {
                    message.datetime = message.timestamp; // Copy timestamp to datetime for backwards compatibility
                    if (hideCapcode) {
                        if (!req.isAuthenticated() || (req.isAuthenticated() && req.user.role === 'user')) {
                            message = {
                                id: message.id,
                                message: message.message,
                                source: message.source,
                                datetime: message.datetime,
                                timestamp: message.timestamp,
                                alias_id: message.alias_id,
                                alias: message.alias,
                                agency: message.agency,
                                icon: message.icon,
                                color: message.color,
                                ignore: message.ignore,
                            };
                        }
                    }
                    if (pdwMode) {
                        if (
                            (adminShow && req.isAuthenticated() && req.user.role === 'admin' && !message.ignore) ||
                            message.ignore === 0
                        ) {
                            data.push(message);
                        }
                    } else if (!message.ignore || message.ignore === 0) data.push(message);
                }
            } else {
                logger.main.info('empty results');
            }
            rowCount = data.length;
            if (rowCount > 0) {
                console.timeEnd('sql');
                const result = data;
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
                const limitResults = result.slice(initData.offset, initData.offsetEnd);
                console.timeEnd('initEnd');
                res.json({ init: initData, messages: limitResults });
            } else {
                console.timeEnd('sql');
                res.status(200).json({ init: {}, messages: [] });
            }
        })
        .catch((err) => {
            console.timeEnd('sql');
            logger.main.error(err);
            res.status(500).send(err);
        });
});

router.route('/capcodes/init');
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
router
    .route('/capcodes')
    .get(authHelper.isAdmin, (req, res, next) => {
        nconf.load();
        const dbtype = nconf.get('database:type');
        db.from('capcodes')
            .select('*')
            .modify((queryBuilder) => {
                if (dbtype === 'oracledb') queryBuilder.orderByRaw(`REPLACE("address", '_', '%')`);
                else queryBuilder.orderByRaw(`REPLACE(address, '_', '%')`);
            })
            .then((rows) => {
                res.json(rows);
            })
            .catch((err) => {
                logger.main.error(err);
                return next(err);
            });
    })
    .post(authHelper.isAdmin, (req, res, next) => {
        nconf.load();
        const updateRequired = nconf.get('database:aliasRefreshRequired');
        if (req.body.address && req.body.alias) {
            const id = req.body.id || null;
            const address = req.body.address || 0;
            const alias = req.body.alias || 'null';
            const agency = req.body.agency || 'null';
            const color = req.body.color || 'black';
            const icon = req.body.icon || 'question';
            const ignore = req.body.ignore || 0;
            const pluginconf = JSON.stringify(vaccumPluginConf(req.body.pluginconf)) || '{}';
            const onlyShowLoggedIn = req.body.onlyShowLoggedIn || false;
            db.from('capcodes')
                .where('id', '=', id)
                .modify((queryBuilder) => {
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
                            onlyShowLoggedIn,
                        });
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
                            onlyShowLoggedIn,
                        });
                    }
                })
                .returning('id')
                .then((result) => {
                    res.status(200).send(`${result}`);
                    if (!updateRequired || updateRequired === 0) {
                        nconf.set('database:aliasRefreshRequired', 1);
                        nconf.save();
                    }
                })
                .catch((err) => {
                    logger.main.error(err);
                    res.status(500).send(err);
                });
            logger.main.debug(util.format('%o', req.body || 'no request body'));
        } else {
            res.status(400).json({ message: 'Error - address or alias missing' });
        }
    });

router.route('/capcodes/agency').get(authHelper.isAdmin, (req, res, next) => {
    db.from('capcodes')
        .distinct('agency')
        .then((rows) => {
            res.status(200);
            res.json(rows);
        })
        .catch((err) => {
            res.status(500).send(err);
        });
});

router.route('/capcodes/agency/:id').get(authHelper.isAdmin, (req, res, next) => {
    const { id } = req.params;
    db.from('capcodes')
        .select('*')
        .where('agency', 'like', id)
        .then((rows) => {
            res.status(200);
            res.json(rows);
        })
        .catch((err) => {
            logger.main.error(err);
            return next(err);
        });
});

router
    .route('/capcodes/:id')
    .get(authHelper.isAdmin, (req, res, next) => {
        const { id } = req.params;
        const defaults = {
            id: '',
            address: '',
            alias: '',
            agency: '',
            icon: 'question',
            color: 'black',
            ignore: 0,
            pluginconf: {},
            onlyShowLoggedIn: false,
        };
        if (id === 'new') {
            res.status(200);
            res.json(defaults);
        } else {
            db.from('capcodes')
                .first()
                .where('id', id)
                .then((capcode) => {
                    if (capcode) {
                        capcode.pluginconf = parseJSON(capcode.pluginconf);
                        res.status(200);
                        res.json(capcode);
                    } else {
                        res.status(200);
                        res.json(defaults);
                    }
                })
                .catch((err) => {
                    logger.main.error(err);
                    return next(err);
                });
        }
    })
    .post(authHelper.isAdmin, (req, res, next) => {
        const dbtype = nconf.get('database:type');
        let id = req.params.id || req.body.id || null;
        if (id === 'deleteMultiple') {
            // do delete multiple
            const idList = req.body.deleteList || [0, 0];
            if (!idList.some(Number.isNaN)) {
                logger.main.info(`Deleting: ${idList}`);
                db.from('capcodes')
                    .del()
                    .where('id', 'in', idList)
                    .then((result) => {
                        res.status(200).send({ status: 'ok' });
                        nconf.set('database:aliasRefreshRequired', 1);
                        nconf.save();
                    })
                    .catch((err) => {
                        res.status(500).send(err);
                    });
            } else {
                res.status(500).send({ status: 'id list contained non-numbers' });
            }
        } else if (req.body.address && req.body.alias) {
            if (id === 'new') {
                id = null;
            }
            const address = req.body.address || 0;
            const alias = req.body.alias || 'null';
            const agency = req.body.agency || 'null';
            const color = req.body.color || 'black';
            const icon = req.body.icon || 'question';
            const ignore = req.body.ignore || 0;
            const pluginconf = JSON.stringify(vaccumPluginConf(req.body.pluginconf)) || '{}';
            const updateAlias = req.body.updateAlias || 0;
            const onlyShowLoggedIn = req.body.onlyShowLoggedIn || 0;

            console.time('insert');
            db.from('capcodes')
                .returning('id')
                .where('id', '=', id)
                .modify((queryBuilder) => {
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
                            onlyShowLoggedIn,
                        });
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
                            onlyShowLoggedIn,
                        });
                    }
                })
                .then((result) => {
                    console.timeEnd('insert');
                    if (updateAlias === 1) {
                        console.time('updateMap');
                        db('messages')
                            .update('alias_id', function () {
                                this.select('id')
                                    .from('capcodes')
                                    .where('messages.address', 'like', 'address')
                                    .modify((queryBuilder) => {
                                        if (dbtype === 'oracledb')
                                            queryBuilder.orderByRaw(`REPLACE("address", '_', '%') DESC`);
                                        else queryBuilder.orderByRaw(`REPLACE(address, '_', '%') DESC`);
                                    })
                                    .limit(1);
                            })
                            .catch((err) => {
                                logger.main.error(err);
                            })
                            .finally(() => {
                                console.timeEnd('updateMap');
                            });
                    } else {
                        // Check if we can refresh just this specific alias
                        const specificRefresh = nconf.get('global:SpecificAliasRefresh');
                        if (specificRefresh && /^\d+$/.test(req.body.address)) {
                            // Refresh this specific Alias
                            console.time('updateMap');
                            db('messages')
                                .update('alias_id', function () {
                                    this.select('id')
                                        .from('capcodes')
                                        .where(db.ref('messages.address'), 'like', db.ref('capcodes.address'))
                                        .modify((queryBuilder) => {
                                            if (dbtype === 'oracledb')
                                                queryBuilder.orderByRaw(`REPLACE("address", '_', '%') DESC`);
                                            else queryBuilder.orderByRaw(`REPLACE(address, '_', '%') DESC`);
                                        })
                                        .limit(1);
                                })
                                .where(db.ref('messages.address'), '=', req.body.address)
                                .catch((err) => {
                                    logger.main.error(err);
                                })
                                .finally(() => {
                                    console.timeEnd('updateMap');
                                });
                            // We cannot update this specific Alias, so inform of required Alias Refresh
                        } else {
                            nconf.set('database:aliasRefreshRequired', 1);
                            nconf.save();
                        }
                    }
                    res.status(200).send({ status: 'ok', id: result });
                })
                .catch((err) => {
                    console.timeEnd('insert');
                    logger.main.error(err);
                    res.status(500).send(err);
                });
            logger.main.debug(util.format('%o', req.body || 'request body empty'));
        } else {
            res.status(400).json({ message: 'Error - address or alias missing' });
        }
    })
    .delete(authHelper.isAdmin, (req, res, next) => {
        // delete single alias
        const id = parseInt(req.params.id, 10);
        nconf.load();
        const updateRequired = nconf.get('database:aliasRefreshRequired');
        logger.main.info(`Deleting ${id}`);
        db.from('capcodes')
            .del()
            .where('id', id)
            .then((result) => {
                res.status(200).send({ status: 'ok' });
                if (!updateRequired || updateRequired === 0) {
                    nconf.set('database:aliasRefreshRequired', 1);
                    nconf.save();
                }
            })
            .catch((err) => {
                res.status(500).send(err);
            });
        logger.main.debug(util.format('%o', req.body || 'request body empty'));
    });

router.route('/capcodeCheck/:id').get(authHelper.isAdmin, (req, res, next) => {
    const { id } = req.params;
    db.from('capcodes')
        .where('address', id)
        .first()
        .then((row) => {
            if (row) {
                row.pluginconf = parseJSON(row.pluginconf);
                res.status(200);
                res.json(row);
            } else {
                res.status(200);
                res.json({
                    id: '',
                    address: '',
                    alias: '',
                    agency: '',
                    icon: 'question',
                    color: 'black',
                    ignore: 0,
                    pluginconf: {},
                    onlyShowLoggedIn: 0,
                });
            }
        })
        .catch((err) => {
            logger.main.error(err);
            return next(err);
        });
});

router.route('/capcodeRefresh').post(authHelper.isAdmin, (req, res, next) => {
    nconf.load();
    const dbtype = nconf.get('database:type');
    console.time('updateMap');
    db('messages')
        .update('alias_id', function () {
            this.select('id')
                .from('capcodes')
                .where(db.ref('messages.address'), 'like', db.ref('capcodes.address'))
                .modify((queryBuilder) => {
                    if (dbtype === 'oracledb') queryBuilder.orderByRaw(`REPLACE("address", '_', '%') DESC`);
                    else queryBuilder.orderByRaw(`REPLACE(address, '_', '%') DESC`);
                })
                .limit(1);
        })
        .then((result) => {
            console.timeEnd('updateMap');
            nconf.set('database:aliasRefreshRequired', 0);
            nconf.save();
            res.status(200).send({ status: 'ok' });
        })
        .catch((err) => {
            logger.main.error(err);
            console.timeEnd('updateMap');
        });
});

router.route('/capcodeExport').post(authHelper.isAdmin, (req, res, next) => {
    nconf.load();
    const dbtype = nconf.get('database:type');
    db.from('capcodes')
        .select('*')
        .modify((queryBuilder) => {
            if (dbtype === 'oracledb') queryBuilder.orderByRaw(`REPLACE("address", '_', '%')`);
            else queryBuilder.orderByRaw(`REPLACE(address, '_', '%')`);
        })
        .then((rows) => {
            converter.json2csv(rows, (err, data) => {
                if (err) {
                    res.status(500).send(err);
                } else {
                    res.status(200).send({ status: 'ok', data });
                }
            });
        })
        .catch((err) => {
            logger.main.error(err);
            return next(err);
        });
});

router.route('/capcodeImport').post(authHelper.isAdmin, (req, res, next) => {
    const importBody = Object.keys(req.body).map((key) => req.body[key].replace(/[\r\n]/g, ''));

    // join data but remove the last newline to prevent the last one being malformed.
    const importdata = importBody.join('\n').slice(0, -1);
    const importresults = [];
    converter
        .csv2jsonAsync(importdata)
        .then(async (data) => {
            const header = data[0];
            // this checks if the csv has the required headings, should replace this with some form of proper validation
            if ('address' in header && 'alias' in header) {
                for (const capcode of data) {
                    const address = capcode.address || 0;
                    const alias = capcode.alias || 'null';
                    const agency = capcode.agency || 'null';
                    const color = capcode.color || 'black';
                    const icon = capcode.icon || 'question';
                    const ignore = capcode.ignore || 0;
                    const pluginconf = JSON.stringify(vaccumPluginConf(capcode.pluginconf)) || '{}';
                    const onlyShowLoggedIn = capcode.onlyShowLoggedIn || false;
                    try {
                        const existingCapcode = await db('capcodes')
                            .returning('id')
                            .where('address', '=', address)
                            .first();

                        if (existingCapcode) {
                            // Update the existing alias if one is found.
                            return db('capcodes')
                                .where('id', '=', existingCapcode.id)
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
                                        address,
                                        alias,
                                        result: 'updated',
                                    });
                                })
                                .catch((err) => {
                                    importresults.push({
                                        address,
                                        alias,
                                        result: `failed ${err}`,
                                    });
                                });
                        }
                        // Create new alias if one didn't get returned.
                        return db('capcodes')
                            .insert({
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
                                    address,
                                    alias,
                                    result: 'created',
                                });
                            })
                            .catch((err) => {
                                importresults.push({
                                    address,
                                    alias,
                                    result: `failed${err}`,
                                });
                            });
                    } catch (error) {
                        importresults.push({
                            address,
                            alias,
                            result: `failed${error}`,
                        });
                    }
                }
                // Gather all the results, format for the frontend and send it back.
                const results = { results: importresults };
                res.status(200);
                res.json(results);
                logger.main.debug(`Import:${JSON.stringify(importresults)}`);
                nconf.set('database:aliasRefreshRequired', 1);
                nconf.save();
            } else {
                throw new Error('Error parsing CSV header');
            }
        })
        .catch((err) => {
            res.status(500).send(err);
            logger.main.error(err);
        });
});

router
    .route('/user')
    .get(authHelper.isAdmin, (req, res, next) => {
        db.from('users')
            .select('id', 'givenname', 'surname', 'username', 'email', 'role', 'status', 'lastlogondate')
            .then((rows) => {
                res.json(rows);
            })
            .catch((err) => {
                logger.main.error(err);
                return next(err);
            });
    })
    .post(authHelper.isAdmin, (req, res, next) => {
        if (
            req.body.username &&
            req.body.email &&
            req.body.givenname &&
            req.body.password &&
            req.body.status &&
            req.body.role
        ) {
            const { username } = req.body;
            const { email } = req.body;
            db.table('users')
                .where('username', '=', username)
                .orWhere('email', '=', email)
                .first()
                .then((row) => {
                    if (row) {
                        // add logging
                        res.status(400).send({ status: 'error', error: 'Username or Email exists' });
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
                                lastlogondate: null,
                            })
                            .returning('id')
                            .then((response) => {
                                // add logging
                                logger.main.debug(`created user id: ${response}`);
                                res.status(200).send({ status: 'ok', id: response[0].id });
                            })
                            .catch((err) => {
                                logger.main.error(err);
                                res.status(500).send({ status: 'error' });
                            });
                    }
                });
        } else {
            res.status(400).send({ status: 'error', error: 'Invalid request body' });
        }
    });

router.route('/userCheck/username/:id').get(authHelper.isAdmin, (req, res, next) => {
    const { id } = req.params;
    db.from('users')
        .first('id', 'givenname', 'surname', 'username', 'email', 'role', 'status', 'lastlogondate')
        .where('username', id)
        .then((user) => {
            if (user) {
                res.status(200);
                res.json(user);
            } else {
                res.status(200);
                res.json({
                    username: '',
                    password: '',
                    givenname: '',
                    surname: '',
                    email: '',
                    role: 'user',
                    status: 'active',
                });
            }
        })
        .catch((err) => {
            logger.main.error(err);
            return next(err);
        });
});

router.route('/userCheck/email/:id').get(authHelper.isAdmin, (req, res, next) => {
    const { id } = req.params;
    db.from('users')
        .first('id', 'givenname', 'surname', 'username', 'email', 'role', 'status', 'lastlogondate')
        .where('email', id)
        .then((user) => {
            if (user) {
                res.status(200);
                res.json(user);
            } else {
                res.status(200);
                res.json({
                    username: '',
                    password: '',
                    givenname: '',
                    surname: '',
                    email: '',
                    role: 'user',
                    status: 'active',
                });
            }
        })
        .catch((err) => {
            logger.main.error(err);
            return next(err);
        });
});

router
    .route('/user/:id')
    .get(authHelper.isAdmin, (req, res, next) => {
        const { id } = req.params;
        const defaults = {
            username: '',
            password: '',
            givenname: '',
            surname: '',
            email: '',
            role: 'user',
            status: 'active',
        };
        if (id === 'new') {
            res.status(200);
            res.json(defaults);
        } else {
            db.from('users')
                .first('id', 'givenname', 'surname', 'username', 'email', 'role', 'status', 'lastlogondate')
                .where('id', id)
                .then((user) => {
                    if (user) {
                        res.status(200);
                        res.json(user);
                    } else {
                        res.status(200);
                        res.json(defaults);
                    }
                })
                .catch((err) => {
                    logger.main.error(err);
                    return next(err);
                });
        }
    })
    .post(authHelper.isAdmin, (req, res, next) => {
        let id = req.params.id || req.body.id || null;
        if (id === 'deleteMultiple') {
            // do delete multiple
            const idList = req.body.deleteList || [0, 0];
            if (idList.some((n) => Number.isNaN(Number(n))))
                return res.status(400).send({ status: 'error', error: 'id list contained non-numbers' });

            // ADD CHECK TO NOT ALLOW DELETION OF USERID 1
            logger.main.info(`Deleting: ${idList}`);
            db.from('users')
                .del()
                .where('id', 'in', idList)
                .then((result) => {
                    res.status(200).send({ status: 'ok' });
                })
                .catch((err) => {
                    res.status(500).send(err);
                });
        } else if (req.body.username && req.body.email && req.body.givenname) {
            const password = req.body.newpassword || req.body.password || null;
            if (id === 'new') {
                // Password is a required field if this is a new account check for that
                if (!req.body.password) {
                    return res.status(400).send({
                        status: 'error',
                        error: 'Error - required field missing',
                    });
                }
                id = null;
            }
            console.time('insert');
            db.from('users')
                .returning('id')
                .where('id', '=', id)
                .modify((queryBuilder) => {
                    const userobj = {
                        id,
                        username: req.body.username,
                        givenname: req.body.givenname,
                        surname: req.body.surname || '',
                        email: req.body.email,
                        role: req.body.role || 'user',
                        status: req.body.status || 'disabled',
                    };
                    if (password != null) {
                        const salt = bcrypt.genSaltSync();
                        const hash = bcrypt.hashSync(password, salt);
                        userobj.password = hash;
                        if (id == null) {
                            userobj.lastlogondate = null;
                            queryBuilder.insert(userobj);
                        } else {
                            queryBuilder.update(userobj);
                        }
                    } else {
                        queryBuilder.update(userobj);
                    }
                })
                .returning('id')
                .then((result) => {
                    console.timeEnd('insert');
                    res.status(200).send({ status: 'ok', id: result[0].id });
                })
                .catch((err) => {
                    console.timeEnd('insert');
                    logger.main.error(err);
                    res.status(500).send(err);
                });
        } else {
            res.status(400).send({ status: 'error', error: 'Error - required field missing' });
        }
    })
    .delete(authHelper.isAdmin, (req, res, next) => {
        const id = parseInt(req.params.id, 10);
        if (id !== 1) {
            logger.main.info(`Deleting User ${id}`);
            db.from('users')
                .del()
                .where('id', id)
                .then((result) => {
                    res.status(200).send({ status: 'ok' });
                })
                .catch((err) => {
                    res.status(500).send(err);
                    logger.main.error(err);
                });
        } else {
            res.status(400).json({ error: 'User ID 1 is protected' });
            logger.main.error('Unable to delete user ID 1');
        }
    });

router.use([handleError]);

module.exports = router;

function handleError(err, req, res, next) {
    const output = {
        error: {
            name: err.name,
            message: err.message,
            text: err.toString(),
        },
    };
    const statusCode = err.status || 500;
    res.status(statusCode).json(output);
}

function parseJSON(json) {
    let parsed;
    try {
        parsed = JSON.parse(json);
    } catch (e) {
        // ignore errors
    }
    return parsed;
}

/**
 * Removes all empty objects from a plugin configuration
 * @param {Object} pconf An object containing a key for each Plugin, holding it's configuration
 * @returns A sanitized version of the plugin configuration object holding only plugins with values set
 */
function vaccumPluginConf(pconf) {
    const cleaned = pickBy(pconf, (p) => Object.keys(p).length > 0);
    return cleaned;
}
