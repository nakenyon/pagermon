const express = require('express');
const nconf = require('nconf');
const util = require('util');
const { promisify } = require('node:util');
const _ = require('underscore');

const authHelper = require('../../middleware/authhelper');
const db = require('../../knex/knex');
const logger = require('../../log');
const pluginHandler = require('../../plugins/pluginHandler');

const pluginHandlerHandle = pluginHandler.handle;

pluginHandlerHandle[promisify.custom] = (trigger, scope, data) =>
        new Promise(resolve => {
                pluginHandler(trigger, scope, data, resolve);
        });

const handle = promisify(pluginHandlerHandle);

// Buffer for duplicate checking.
const duplicateBuffer = [];

const router = express.Router();

function getMessageQuery(req) {
        const pdwMode = nconf.get('messages:pdwMode');
        const adminShow = nconf.get('messages:adminShow');
        const queryTemplate = db.from('messages').modify(queryBuilder => {
                if (!req.isAuthenticated())
                        queryBuilder.where(qb =>
                                qb.where('capcodes.onlyShowLoggedIn', false).orWhereNull('capcodes.onlyShowLoggedIn')
                        );

                if (pdwMode && !(adminShow && req.isAuthenticated() && req.user.role === 'admin')) {
                        queryBuilder
                                .innerJoin('capcodes', 'capcodes.id', '=', 'messages.alias_id')
                                .where('capcodes.ignore', 0);
                } else {
                        queryBuilder.leftJoin('capcodes', 'capcodes.id', '=', 'messages.alias_id').where(qb => {
                                qb.where('capcodes.ignore', 0).orWhereNull('capcodes.ignore');
                        });
                }
        });
        return queryTemplate.clone();
}

router.route('/messages')
        .get(authHelper.isLoggedInMessages, async function(req, res) {
                try {
                        const HideCapcode = nconf.get('messages:HideCapcode');

                        const maxLimit = nconf.get('messages:maxLimit');
                        const defaultLimit = nconf.get('messages:defaultLimit');

                        const replaceText = nconf.get('messages:replaceText');

                        const initData = {
                                limit: defaultLimit || 20,
                                replaceText,
                                currentPage: 0,
                                pageCount: 0,
                                msgCount: 0,
                                offset: 0,
                        };

                        const parsePage = typeof req.query.page !== 'undefined' ? parseInt(req.query.page, 10) : 0;
                        initData.currentPage = parsePage > 0 ? parsePage - 1 : 0;

                        if (req.query.limit && req.query.limit <= maxLimit) {
                                initData.limit = parseInt(req.query.limit, 10);
                        } else {
                                initData.limit = parseInt(defaultLimit, 10);
                        }

                        const initCount = await getMessageQuery(req).count('* as msgcount');

                        const count = initCount[0].msgcount;
                        if (count === undefined) throw new Error('Something went really really wrong!'); // TODO: How the fuck would we end up in this situation?

                        initData.msgCount = count;

                        initData.pageCount = Math.ceil(initData.msgCount / initData.limit);
                        initData.currentPage = initData.currentPage > initData.pageCount ? 0 : initData.currentPage;

                        const offset = initData.limit * initData.currentPage;
                        initData.offset = offset > 0 ? offset : 0;

                        initData.offsetEnd = initData.offset + initData.limit;

                        const fields = [
                                'messages.id',
                                'messages.message',
                                'messages.timestamp',
                                'messages.timestamp as datetime',
                                'capcodes.alias',
                                'capcodes.agency',
                                'capcodes.icon',
                                'capcodes.color',
                        ];

                        if (!nconf.get('messages:HideSource') || (req.isAuthenticated() && req.user.role === 'admin'))
                                fields.push('messages.source');

                        if (!HideCapcode || req.isAuthenticated()) fields.push('messages.address');

                        if (req.isAuthenticated() && req.user.role === 'admin')
                                fields.push(
                                        db.raw(
                                                'CASE WHEN NOT capcodes.address = messages.address THEN 1 ELSE 0 END as wildcard'
                                        )
                                );

                        const messages = await getMessageQuery(req)
                                .select(fields)
                                .orderBy('messages.timestamp', 'desc')
                                .limit(initData.limit)
                                .offset(initData.offset);

                        res.status(200).json({ init: initData, messages });
                } catch (err) {
                        logger.main.error(err);
                        res.status(500).json({ init: {}, messages: [] });
                }
        })
        .post(authHelper.isAdmin, function(req, res) {
                if (!req.body.address || !req.body.message)
                        return res.status(400).json({ message: 'Error - address or message missing' });

                const dbtype = nconf.get('database:type');
                const HideCapcode = nconf.get('messages:HideCapcode');
                const filterDupes = nconf.get('messages:duplicateFiltering');
                const dupeLimit = nconf.get('messages:duplicateLimit') || 0; // default 0
                const dupeTime = nconf.get('messages:duplicateTime') || 0; // default 0
                const pdwMode = nconf.get('messages:pdwMode');
                const adminShow = nconf.get('messages:adminShow');
                let data = req.body;
                data.pluginData = {};

                if (filterDupes) {
                        // this is a bad solution and tech debt that will bite us in the ass if we ever go HA, but that's a problem for future me and that guy's a dick

                        const dupeTimestamp = data.timestamp || data.datetime || Date.now();

                        const timeDiff = dupeTimestamp - dupeTime;
                        // if duplicate filtering is enabled, we want to populate the message buffer and check for duplicates within the limits
                        const matches = _.where(duplicateBuffer, { message: data.message, address: data.address });
                        if (matches.length > 0) {
                                if (dupeTime !== 0) {
                                        // search the matching messages and see if any match the time constrain
                                        var timeFind = _.find(matches, function(msg) {
                                                return msg.timestamp > timeDiff;
                                        });
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
                                dupeArrayLimit == 25; // should provide sufficient buffer, consider increasing if duplicates appear when users have no dupeLimit
                        }
                        if (duplicateBuffer.length > dupeArrayLimit) {
                                duplicateBuffer.shift();
                        }
                        duplicateBuffer.push(_.pick(data, ['message', 'timestamp', 'address']));
                }

                if (data.timestamp) var { timestamp } = data;
                else if (data.datetime) {
                        logger.main.warn(
                                `An incoming message from ${data.source ||
                                        'an unknown source'} contains the timestamp as field 'datetime'. Update the message source to use the variable 'timestamp' instead!`
                        );
                        var timestamp = data.datetime;
                } else var timestamp = 1;

                // send data to pluginHandler before proceeding
                logger.main.debug('beforeMessage start');
                pluginHandler.handle('message', 'before', data, function(response) {
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
                        var timeDiff = timestamp - dupeTime;
                        var source = data.source || 'UNK';
                        db.from('messages')
                                .select('*')
                                .modify(function(queryBuilder) {
                                        if (dupeLimit != 0 && dupeTime != 0) {
                                                queryBuilder
                                                        .where('id', 'in', function() {
                                                                this.select('*')
                                                                        // this wierd subquery is to keep mysql happy
                                                                        .from(function() {
                                                                                this.select('id')
                                                                                        .from('messages')
                                                                                        .where(
                                                                                                'timestamp',
                                                                                                '>',
                                                                                                timeDiff
                                                                                        )
                                                                                        .orderBy('id', 'desc')
                                                                                        .limit(dupeLimit)
                                                                                        .as('temp_tab');
                                                                        });
                                                        })
                                                        .andWhere('message', '=', message)
                                                        .andWhere('address', '=', address);
                                        } else if (dupeLimit != 0 && dupeTime == 0) {
                                                queryBuilder
                                                        .where('id', 'in', function() {
                                                                this.select('*')
                                                                        // this wierd subquery is to keep mysql happy
                                                                        .from(function() {
                                                                                this.select('id')
                                                                                        .from('messages')
                                                                                        .orderBy('id', 'desc')
                                                                                        .limit(dupeLimit)
                                                                                        .as('temp_tab');
                                                                        });
                                                        })
                                                        .andWhere('message', '=', message)
                                                        .andWhere('address', '=', address);
                                        } else if (dupeLimit == 0 && dupeTime != 0) {
                                                queryBuilder
                                                        .where('id', 'in', function() {
                                                                this.select('id')
                                                                        .from('messages')
                                                                        .where('timestamp', '>', timeDiff);
                                                        })
                                                        .andWhere('message', '=', message)
                                                        .andWhere('address', '=', address);
                                        } else {
                                                queryBuilder
                                                        .where('message', '=', message)
                                                        .andWhere('address', '=', address);
                                        }
                                })
                                .then(row => {
                                        if (row.length > 0 && filterDupes) {
                                                logger.main.info(util.format('Ignoring duplicate: %o', message));
                                                res.status(200).send('Ignoring duplicate');
                                        } else {
                                                db.from('capcodes')
                                                        .select('id', 'ignore')
                                                        // TODO: test this doesn't break other DBs - there's a lot of quote changes here
                                                        .modify(function(queryBuilder) {
                                                                if (dbtype == 'oracledb') {
                                                                        queryBuilder.whereRaw(
                                                                                `'${address}' LIKE "address"`
                                                                        );
                                                                        queryBuilder.orderByRaw(
                                                                                `REPLACE("address", '_', '%') DESC`
                                                                        );
                                                                } else {
                                                                        queryBuilder.whereRaw(
                                                                                `"${address}" LIKE address`
                                                                        );
                                                                        queryBuilder.orderByRaw(
                                                                                `REPLACE(address, '_', '%') DESC`
                                                                        );
                                                                }
                                                        })
                                                        .then(row => {
                                                                var insert;
                                                                var alias_id = null;
                                                                if (row.length > 0) {
                                                                        row = row[0];
                                                                        if (row.ignore == 1) {
                                                                                insert = false;
                                                                                logger.main.info(
                                                                                        `Ignoring filtered address: ${address} alias: ${row.id}`
                                                                                );
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

                                                                if (insert === true) {
                                                                        var insertmsg = {
                                                                                address,
                                                                                message,
                                                                                timestamp,
                                                                                source,
                                                                                alias_id,
                                                                        };
                                                                        db('messages')
                                                                                .insert(insertmsg)
                                                                                .then(result => {
                                                                                        // emit the full message
                                                                                        const msgId = Object.keys(
                                                                                                result[0]
                                                                                        ).includes('id')
                                                                                                ? result[0].id
                                                                                                : result[0];

                                                                                        if (dbtype == 'oracledb') {
                                                                                                // oracle requires update of search index after insert, can't be trigger for some reason
                                                                                                db.raw(
                                                                                                        `BEGIN CTX_DDL.SYNC_INDEX('search_idx'); END;`
                                                                                                )
                                                                                                        .then(resp => {
                                                                                                                logger.main.debug(
                                                                                                                        'search_idx sync complete'
                                                                                                                );
                                                                                                                logger.main.debug(
                                                                                                                        resp
                                                                                                                );
                                                                                                        })
                                                                                                        .catch(err => {
                                                                                                                logger.main.error(
                                                                                                                        'search_idx sync failed'
                                                                                                                );
                                                                                                                logger.main.error(
                                                                                                                        err
                                                                                                                );
                                                                                                        });
                                                                                        }

                                                                                        db.from('messages')
                                                                                                .select(
                                                                                                        'messages.*',
                                                                                                        'capcodes.alias',
                                                                                                        'capcodes.agency',
                                                                                                        'capcodes.icon',
                                                                                                        'capcodes.color',
                                                                                                        'capcodes.ignore',
                                                                                                        'capcodes.pluginconf',
                                                                                                        'capcodes.onlyShowLoggedIn'
                                                                                                )
                                                                                                .modify(function(
                                                                                                        queryBuilder
                                                                                                ) {
                                                                                                        queryBuilder.leftJoin(
                                                                                                                'capcodes',
                                                                                                                'capcodes.id',
                                                                                                                '=',
                                                                                                                'messages.alias_id'
                                                                                                        );
                                                                                                })
                                                                                                .where(
                                                                                                        'messages.id',
                                                                                                        '=',
                                                                                                        msgId
                                                                                                )
                                                                                                .then(row => {
                                                                                                        if (
                                                                                                                row.length >
                                                                                                                0
                                                                                                        ) {
                                                                                                                row =
                                                                                                                        row[0];
                                                                                                                // send data to pluginHandler after processing
                                                                                                                row.pluginData =
                                                                                                                        data.pluginData;

                                                                                                                // Copy timestamp to datetime for backwards compatibility.
                                                                                                                row.datetime =
                                                                                                                        row.timestamp;

                                                                                                                if (
                                                                                                                        row.pluginconf
                                                                                                                ) {
                                                                                                                        row.pluginconf = parseJSON(
                                                                                                                                row.pluginconf
                                                                                                                        );
                                                                                                                } else {
                                                                                                                        row.pluginconf = {};
                                                                                                                }
                                                                                                                logger.main.debug(
                                                                                                                        'afterMessage start'
                                                                                                                );
                                                                                                                pluginHandler.handle(
                                                                                                                        'message',
                                                                                                                        'after',
                                                                                                                        row,
                                                                                                                        function(
                                                                                                                                response
                                                                                                                        ) {
                                                                                                                                logger.main.debug(
                                                                                                                                        util.format(
                                                                                                                                                '%o',
                                                                                                                                                response
                                                                                                                                        )
                                                                                                                                );
                                                                                                                                logger.main.debug(
                                                                                                                                        'afterMessage done'
                                                                                                                                );
                                                                                                                                // remove the pluginconf object before firing socket message
                                                                                                                                delete row.pluginconf;
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
                                                                                                                                if (
                                                                                                                                        !HideCapcode
                                                                                                                                )
                                                                                                                                        fields.push(
                                                                                                                                                'address'
                                                                                                                                        ); // Show address, when hideCapcode is off.
                                                                                                                                const rowUser = _.pick(
                                                                                                                                        row,
                                                                                                                                        fields
                                                                                                                                );

                                                                                                                                /*
                                  If:
                                  - The admin has no alias
                                  - And pdw mode is on
                                  -> Do not send to users
                                  -> If
                                    - AdminShow is on
                                    -> Do send to admins though
                                */
                                                                                                                                if (
                                                                                                                                        pdwMode
                                                                                                                                ) {
                                                                                                                                        if (
                                                                                                                                                row.alias_id ===
                                                                                                                                                null
                                                                                                                                        ) {
                                                                                                                                                if (
                                                                                                                                                        adminShow
                                                                                                                                                )
                                                                                                                                                        req.io
                                                                                                                                                                .to(
                                                                                                                                                                        'admin'
                                                                                                                                                                )
                                                                                                                                                                .emit(
                                                                                                                                                                        'messagePost',
                                                                                                                                                                        row
                                                                                                                                                                );
                                                                                                                                        } else {
                                                                                                                                                req.io
                                                                                                                                                        .to(
                                                                                                                                                                'admin'
                                                                                                                                                        )
                                                                                                                                                        .emit(
                                                                                                                                                                'messagePost',
                                                                                                                                                                row
                                                                                                                                                        );
                                                                                                                                                req.io
                                                                                                                                                        .to(
                                                                                                                                                                'user'
                                                                                                                                                        )
                                                                                                                                                        .emit(
                                                                                                                                                                'messagePost',
                                                                                                                                                                rowUser
                                                                                                                                                        );
                                                                                                                                                if (
                                                                                                                                                        !row.onlyShowLoggedIn
                                                                                                                                                )
                                                                                                                                                        req.io
                                                                                                                                                                .to(
                                                                                                                                                                        'anonymous'
                                                                                                                                                                )
                                                                                                                                                                .emit(
                                                                                                                                                                        'messagePost',
                                                                                                                                                                        rowUser
                                                                                                                                                                );
                                                                                                                                        }
                                                                                                                                } else {
                                                                                                                                        req.io
                                                                                                                                                .to(
                                                                                                                                                        'admin'
                                                                                                                                                )
                                                                                                                                                .emit(
                                                                                                                                                        'messagePost',
                                                                                                                                                        row
                                                                                                                                                );
                                                                                                                                        req.io
                                                                                                                                                .to(
                                                                                                                                                        'user'
                                                                                                                                                )
                                                                                                                                                .emit(
                                                                                                                                                        'messagePost',
                                                                                                                                                        rowUser
                                                                                                                                                );
                                                                                                                                        if (
                                                                                                                                                !row.onlyShowLoggedIn
                                                                                                                                        )
                                                                                                                                                req.io
                                                                                                                                                        .to(
                                                                                                                                                                'anonymous'
                                                                                                                                                        )
                                                                                                                                                        .emit(
                                                                                                                                                                'messagePost',
                                                                                                                                                                rowUser
                                                                                                                                                        );
                                                                                                                                }
                                                                                                                        }
                                                                                                                );
                                                                                                        }
                                                                                                        res.status(
                                                                                                                200
                                                                                                        ).send(
                                                                                                                `${msgId}`
                                                                                                        );
                                                                                                })
                                                                                                .catch(err => {
                                                                                                        res.status(
                                                                                                                500
                                                                                                        ).send(err);
                                                                                                        logger.main.error(
                                                                                                                err
                                                                                                        );
                                                                                                });
                                                                                })
                                                                                .catch(err => {
                                                                                        res.status(500).send(err);
                                                                                        logger.main.error(err);
                                                                                });
                                                                } else {
                                                                        res.status(200).send('Ignoring filtered');
                                                                }
                                                        })
                                                        .catch(err => {
                                                                res.status(500).send(err);
                                                                logger.main.error(err);
                                                        });
                                        }
                                })
                                .catch(err => {
                                        res.status(500).send(err);
                                        logger.main.error(err);
                                });
                });
        });

router.route('/messages/:messageId').get(authHelper.isLoggedInMessages, async function(req, res) {
        try {
                const messageId = parseInt(req.params.messageId, 10);
                const HideCapcode = nconf.get('messages:HideCapcode');

                const fields = [
                        'messages.id',
                        'messages.message',
                        'messages.timestamp',
                        'messages.timestamp as datetime',
                        'capcodes.alias',
                        'capcodes.agency',
                        'capcodes.icon',
                        'capcodes.color',
                ];

                if (!nconf.get('messages:HideSource') || (req.isAuthenticated() && req.user.role === 'admin'))
                        fields.push('messages.source');

                if (!HideCapcode || req.isAuthenticated()) fields.push('messages.address');

                if (req.isAuthenticated() && req.user.role === 'admin')
                        fields.push(
                                db.raw(
                                        'CASE WHEN NOT capcodes.address = messages.address THEN 1 ELSE 0 END as wildcard'
                                )
                        );

                const message = await getMessageQuery(req)
                        .select(fields)
                        .andWhere('messages.id', messageId)
                        .first();

                res.status(200).json(message || {});
        } catch (err) {
                logger.main.error(err);
                res.status(500).json({});
        }
});

router.route('/messageSearch').get(authHelper.isLoggedInMessages, async function(req, res) {
        try {
                const HideCapcode = nconf.get('messages:HideCapcode');
                const dbtype = nconf.get('database:type');

                const maxLimit = nconf.get('messages:maxLimit');
                const defaultLimit = nconf.get('messages:defaultLimit');

                const replaceText = nconf.get('messages:replaceText');

                const initData = {
                        limit: defaultLimit || 20,
                        replaceText,
                        currentPage: 0,
                        pageCount: 0,
                        msgCount: 0,
                        offset: 0,
                };

                const parsePage = typeof req.query.page !== 'undefined' ? parseInt(req.query.page, 10) : 0;
                initData.currentPage = parsePage > 0 ? parsePage - 1 : 0;

                if (req.query.limit && req.query.limit <= maxLimit) {
                        initData.limit = parseInt(req.query.limit, 10);
                } else {
                        initData.limit = parseInt(defaultLimit, 10);
                }

                const { q: query, agency, address, alias } = req.query;

                const fields = [
                        'messages.id',
                        'messages.message',
                        'messages.timestamp',
                        'messages.timestamp as datetime',
                        'capcodes.alias',
                        'capcodes.agency',
                        'capcodes.icon',
                        'capcodes.color',
                ];

                if (!nconf.get('messages:HideSource') || (req.isAuthenticated() && req.user.role === 'admin'))
                        fields.push('messages.source');

                if (!HideCapcode || req.isAuthenticated()) fields.push('messages.address');

                if (req.isAuthenticated() && req.user.role === 'admin')
                        fields.push(
                                db.raw(
                                        'CASE WHEN NOT capcodes.address = messages.address THEN 1 ELSE 0 END as wildcard'
                                )
                        );

                const messages = await getMessageQuery(req)
                        .select(fields)
                        .modify(function(qb) {
                                if (query)
                                        switch (dbtype) {
                                                case 'sqlite3':
                                                        qb.whereIn(
                                                                'messages.id',
                                                                db
                                                                        .from('messages_search_index')
                                                                        .select('rowid')
                                                                        .whereRaw(
                                                                                'messages_search_index MATCH ?',
                                                                                query
                                                                        )
                                                        );

                                                        break;
                                                case 'mysql':
                                                        qb.whereRaw(
                                                                `MATCH(messages.message, messages.address, messages.source) AGAINST (? IN BOOLEAN MODE)`,
                                                                `"${query}"`
                                                        );
                                                        break;
                                                case 'oracledb':
                                                        qb.whereRaw(`CONTAINS("messages"."message", ?, 1) > 0`, query);
                                                        break;
                                                default:
                                                        break;
                                        }

                                if (address)
                                        qb.where(addressWhere => {
                                                addressWhere
                                                        .where('messages.address', 'LIKE', address)
                                                        .orWhere('messages.source', address);
                                        });
                                if (agency)
                                        qb.where(agencyWhere => {
                                                agencyWhere
                                                        .where('capcodes.agency', 'LIKE', `%${agency}%`)
                                                        .andWhere('capcodes.ignore', false);
                                        });

                                if (alias) {
                                        if (alias === '-1') qb.whereNull('messages.alias_id');
                                        else qb.where('messages.alias_id', alias);
                                }
                        })
                        .orderBy('messages.timestamp', 'desc');

                if (!messages) logger.main.info('empty results');

                if (messages.length === 0) return res.status(200).json({ init: {}, messages: [] });

                // TODO: This is highly inefficient, because we need to check EVERY message, to only use a few
                initData.msgCount = messages.length;
                initData.pageCount = Math.ceil(initData.msgCount / initData.limit);
                if (initData.currentPage > initData.pageCount) {
                        initData.currentPage = 0;
                }
                initData.offset = initData.limit * initData.currentPage;
                if (initData.offset < 0) {
                        initData.offset = 0;
                }
                initData.offsetEnd = initData.offset + initData.limit;

                res.json({ init: initData, messages: messages.slice(initData.offset, initData.offsetEnd) });
        } catch (error) {
                console.log(error);
                logger.main.error(error);
                res.status(500).send(error);
        }
});

function parseJSON(json) {
        try {
                return JSON.parse(json);
        } catch (error) {
                // ignore errors
                logger.main.error(`Error while parsing json ${json}: ${error.message}`);
        }
}

module.exports = router;
