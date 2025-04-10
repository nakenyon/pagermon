const express = require('express');
const db = require('../../knex/knex.js');
const authHelper = require('../../middleware/authhelper');
const logger = require('../../log');
const util = require('util');
const uuid = require('uuid');

const router = express.Router({ mergeParams: true });

router.route('/')
        .get(authHelper.isAdmin, async function(req, res, next) {
                const feeders = await db('feeders')
                        .select(
                                'id',
                                'name',
                                'description',
                                'last_message',
                                'heartbeat_enabled',
                                'last_heartbeat',
                                'heartbeat_interval',
                                'created_at',
                                'updated_at'
                        )
                        .orderBy('id', 'desc');

                feeders.forEach(feeder => {
                        feeder.heartbeat_enabled = feeder.heartbeat_enabled === 1;
                });

                res.status(200).send(feeders);
        })
        .post(authHelper.isAdmin, async function(req, res, next) {
                if (req.body.name === undefined || req.body.name === 'null' || typeof req.body.name !== 'string')
                        return res.status(400).send({ status: 'error', error: 'Invalid name' });

                // Construct the new feeder object
                const newFeeder = {
                        name: req.body.name,
                        description: req.body.description || null,
                        last_message: null,
                        heartbeat_enabled: req.body.heartbeat_enabled || false,
                        last_heartbeat: null,
                        heartbeat_interval: req.body.heartbeat_interval || 60,
                        apikey: generateApiKey(),
                };

                const insertResult = await db('feeders').insert(newFeeder);

                if (insertResult === undefined || insertResult.length !== 1) {
                        logger.main.error(`Failed to insert new feeder ${newFeeder.name}`);
                        return res.status(500).send({ status: 'error', error: `Failed to insert new feeder` });
                }

                const newFeederId = insertResult[0].id;

                logger.main.debug(
                        util.format(`Inserted new feeder ${newFeeder.name}:\n%o`, {
                                name: newFeeder.name,
                                description: newFeeder.description,
                                heartbeat_enabled: newFeeder.heartbeat_enabled,
                                heartbeat_interval: newFeeder.heartbeat_interval,
                        })
                );

                res.status(201).send({
                        status: 'ok',
                        id: newFeederId,
                        apikey: newFeeder.apikey,
                });
        });

router.route('/:id')
        .get(authHelper.isAdmin, async function(req, res, next) {
                logger.main.error(`Getting feeder ${req.params.id}`);
                if (req.params?.id === undefined || req.params?.id === 'null')
                        return res.status(400).send({ status: 'error', error: 'Invalid ID' });

                const id = parseInt(req.params.id, 10);
                const feeder = await db('feeders')
                        .select(
                                'id',
                                'name',
                                'description',
                                'last_message',
                                'heartbeat_enabled',
                                'last_heartbeat',
                                'heartbeat_interval',
                                'created_at',
                                'updated_at'
                        )
                        .where('id', id)
                        .first();

                if (feeder === undefined) return res.status(404).send({ status: 'error', error: `Not found` });

                feeder.heartbeat_enabled = feeder.heartbeat_enabled === 1;

                res.status(200).send(feeder);
        })
        .patch(authHelper.isAdmin, async function(req, res, next) {
                if (req.params?.id === undefined || req.params?.id === 'null')
                        return res.status(400).send({ status: 'error', error: 'Invalid ID' });

                const id = parseInt(req.params.id, 10);
                const feeder = await db('feeders')
                        .select('id')
                        .where('id', id)
                        .first();

                if (feeder === undefined)
                        return res.status(404).send({ status: 'error', error: `No feeder with id ${id}` });

                const allowedFields = ['name', 'description', 'heartbeat_enabled', 'heartbeat_interval'];
                const invalidFields = Object.keys(req.body).filter(key => !allowedFields.includes(key));
                if (invalidFields.length > 0)
                        return res.status(400).send({
                                status: 'error',
                                error: `Invalid fields: ${invalidFields.join(', ')}`,
                        });

                const updateFields = {};
                for (const field of allowedFields) {
                        if (req.body[field] !== undefined) {
                                updateFields[field] = req.body[field];
                        }
                }

                if (Object.keys(updateFields).length === 0)
                        return res.status(400).send({ status: 'error', error: 'No fields to update' });

                const updateResult = await db('feeders')
                        .update(updateFields)
                        .where('id', id);

                if (updateResult === undefined || updateResult !== 1) {
                        logger.main.error(`Failed to update feeder ${id}`);
                        return res.status(500).send({ status: 'error', error: `Failed to update feeder ${id}` });
                }

                res.status(200).send({ status: 'ok' });
        })
        .delete(authHelper.isAdmin, async function(req, res, next) {
                if (req.params?.id === undefined || req.params?.id === 'null')
                        return res.status(400).send({ status: 'error', error: 'Invalid ID' });
                const id = parseInt(req.params.id, 10);

                const feeder = await db('feeders')
                        .select('*')
                        .where('id', id)
                        .first();

                if (feeder === undefined) {
                        logger.main.info(`Tried to delete feeder ${id} but it does not exist`);
                        return res.status(404).send({ status: 'error', error: `No feeder with id ${id}` });
                }

                logger.main.info(`Deleting feeder ${id} (${feeder.name})`);

                const deleteResult = await db('feeders')
                        .del()
                        .where('id', id)
                        .catch(err => {
                                res.status(500).send(err);
                        });

                if (deleteResult === undefined || deleteResult !== 1) {
                        logger.main.error(`Failed to delete feeder ${id} (${feeder.name})`);
                        return res.status(500).send({ status: 'error', error: `Failed to delete feeder ${id}` });
                }

                res.status(200).send({ status: 'Deleted' });
        });

router.post('/:id/resetKey', authHelper.isAdmin, async function(req, res, next) {
        if (req.params?.id === undefined || req.params?.id === 'null')
                return res.status(400).send({ status: 'error', error: 'Invalid ID' });

        const id = parseInt(req.params.id, 10);
        const feeder = await db('feeder')
                .select('*')
                .where('id', id)
                .first();

        if (feeder === undefined) return res.status(404).send({ status: 'error', error: `No feeder with id ${id}` });

        if (feeder.apikey !== req.body.apikey)
                // Only the feeder itself is allowed to send a heartbeat.
                return res.status(401).send({ status: 'error', error: `Invalid API Key` });

        const newKey = generateApiKey();

        await db('feeders')
                .update({ apikey: newKey })
                .where('id', id);

        res.status(200).send({ status: 'ok', apikey: newKey });
});

router.post('/:id/resetHearbeat', authHelper.isAdmin, async function(req, res, next) {
        if (req.params?.id === undefined || req.params?.id === 'null')
                return res.status(400).send({ status: 'error', error: 'Invalid ID' });

        const id = parseInt(req.params.id, 10);

        const feeder = await db('feeder')
                .select('*')
                .where('id', id)
                .first();

        if (feeder === undefined) return res.status(404).send({ status: 'error', error: `No feeder with id ${id}` });

        const updateResult = await db('feeders')
                .update({ last_heartbeat: null })
                .where('id', id);

        if (updateResult === undefined || updateResult !== 1) {
                logger.main.error(`Failed to reset last_heartbeat for feeder ${id}`);
                return res
                        .status(500)
                        .send({ status: 'error', error: `Failed to reset last_heartbeat for feeder ${id}` });
        }

        res.status(200).send('Heartbeat reset');
});

router.route('/:id/heartbeat')
        .post(authHelper.isAdmin, async function(req, res, next) {
                if (req.params?.id === undefined || req.params?.id === 'null')
                        return res.status(400).send({ status: 'error', error: 'Invalid feeder ID' });

                const id = parseInt(req.params.id, 10);

                if (id !== req.user.id)
                        return res
                                .status(403)
                                .send({ status: 'error', error: 'Heartbeat can only be sent by the feeder itself' });

                const feeder = await db('feeders')
                        .select('*')
                        .where('id', id)
                        .first();

                if (feeder === undefined)
                        return res.status(404).send({ status: 'error', error: `No feeder with id ${id}` });

                if (feeder.heartbeat_enabled === false)
                        return res.status(400).send({ status: 'error', error: 'Heartbeat is disabled' });

                const updateResult = await db('feeders')
                        .update({ last_heartbeat: new Date().toISOString() })
                        .where('id', id);

                if (updateResult === undefined || updateResult !== 1) {
                        logger.main.error(`Failed to update last_heartbeat for feeder ${id}`);
                        return res
                                .status(500)
                                .send({ status: 'error', error: `Failed to update last_heartbeat for feeder ${id}` });
                }

                res.status(200).send({ status: 'ok', message: 'Heartbeat updated' });
        })
        .get(authHelper.isAdmin, async function(req, res, next) {
                if (req.params?.id === undefined || req.params?.id === 'null')
                        return res.status(400).send({ status: 'error', error: 'Invalid feeder ID' });
                const id = parseInt(req.params.id, 10);
                const feeder = await db('feeders')
                        .select('*')
                        .where('id', id)
                        .first();
                if (feeder === undefined)
                        return res.status(404).send({ status: 'error', error: `No feeder with id ${id}` });

                if (feeder.heartbeat_enabled === 0) {
                        return res.status(200).send({ status: 'online', message: 'Heartbeat is disabled' });
                }

                if (feeder.last_heartbeat === null && feeder.last_message === null) {
                        return res.status(200).send({ status: 'offline', message: 'Feeder is offline' });
                }

                const now = db.fn.now();

                if (feeder.last_heartbeat === null) {
                        const lastMessage = Date.parse(feeder.last_message);
                        if (now - lastMessage > feeder.heartbeat_interval * 1000) {
                                return res.status(200).send({
                                        status: 'offline',
                                        last_heartbeat: feeder.last_heartbeat,
                                        message: 'Feeder is offline',
                                });
                        }
                        return res.status(200).send({
                                status: 'online',
                                last_heartbeat: feeder.last_heartbeat,
                                message: 'Feeder is online',
                        });
                }

                const lastHeartbeat = Date.parse(feeder.last_heartbeat);

                if (now - lastHeartbeat > feeder.heartbeat_interval * 1000) {
                        return res.status(200).send({
                                status: 'offline',
                                last_heartbeat: feeder.last_heartbeat,
                                message: 'Feeder is offline',
                                lastHeartbeat,
                                now,
                                since: now - lastHeartbeat,
                                interval: feeder.heartbeat_interval * 1000,
                        });
                }

                res.status(200).send({
                        status: 'online',
                        last_heartbeat: feeder.last_heartbeat,
                        message: 'Feeder is online',
                        lastHeartbeat,
                        now,
                        since: now - lastHeartbeat,
                        interval: feeder.heartbeat_interval * 1000,
                });
        });

function generateApiKey() {
        return (
                parseInt(
                        uuid
                                .v4()
                                .replace(/-/g, '')
                                .slice(0, 15),
                        16
                ).toString(36) +
                parseInt(
                        uuid
                                .v4()
                                .replace(/-/g, '')
                                .slice(0, 15),
                        16
                ).toString(36)
        ).toUpperCase();
}

module.exports = router;
