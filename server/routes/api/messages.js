const express = require('express');
const nconf = require('nconf');
const authHelper = require('../../middleware/authhelper');
const db = require('../../knex/knex');
const logger = require('../../log');

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

router.route('/messages').get(authHelper.isLoggedInMessages, async function(req, res) {
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
