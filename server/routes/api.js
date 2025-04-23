
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');

const db = require('../knex/knex.js');
const express = require('express');
const logger = require('../log');
const nconf = require('nconf');

const router = express.Router();

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

router.use(function(req, res, next) {
        res.locals.login = req.isAuthenticated();
        res.locals.user = req.user || false;
        next();
});


router.route('/userCheck/username/:id').get(authHelper.isAdmin, function(req, res, next) {
        var { id } = req.params;
        db.from('users')
                .select('id', 'givenname', 'surname', 'username', 'email', 'role', 'status', 'lastlogondate')
                .where('username', id)
                .then(row => {
                        if (row.length > 0) {
                                row = row[0];
                                res.status(200);
                                res.json(row);
                        } else {
                                row = {
                                        username: '',
                                        password: '',
                                        givenname: '',
                                        surname: '',
                                        email: '',
                                        role: 'user',
                                        status: 'active',
                                };
                                res.status(200);
                                res.json(row);
                        }
                })
                .catch(err => {
                        logger.main.error(err);
                        return next(err);
                });
});

router.route('/userCheck/email/:id').get(authHelper.isAdmin, function(req, res, next) {
        var { id } = req.params;
        db.from('users')
                .select('id', 'givenname', 'surname', 'username', 'email', 'role', 'status', 'lastlogondate')
                .where('email', id)
                .then(row => {
                        if (row.length > 0) {
                                row = row[0];
                                res.status(200);
                                res.json(row);
                        } else {
                                row = {
                                        username: '',
                                        password: '',
                                        givenname: '',
                                        surname: '',
                                        email: '',
                                        role: 'user',
                                        status: 'active',
                                };
                                res.status(200);
                                res.json(row);
                        }
                })
                .catch(err => {
                        logger.main.error(err);
                        return next(err);
                });
});

router.route('/user/:id')
        .get(authHelper.isAdmin, function(req, res, next) {
                var { id } = req.params;
                var defaults = {
                        username: '',
                        password: '',
                        givenname: '',
                        surname: '',
                        email: '',
                        role: 'user',
                        status: 'active',
                };
                if (id == 'new') {
                        res.status(200);
                        res.json(defaults);
                } else {
                        db.from('users')
                                .select(
                                        'id',
                                        'givenname',
                                        'surname',
                                        'username',
                                        'email',
                                        'role',
                                        'status',
                                        'lastlogondate'
                                )
                                .where('id', id)
                                .then(function(row) {
                                        if (row.length > 0) {
                                                row = row[0];
                                                res.status(200);
                                                res.json(row);
                                        } else {
                                                res.status(200);
                                                res.json(defaults);
                                        }
                                })
                                .catch(err => {
                                        logger.main.error(err);
                                        return next(err);
                                });
                }
        })
        .post(authHelper.isAdmin, function(req, res, next) {
                var id = req.params.id || req.body.id || null;
                if (id == 'deleteMultiple') {
                        // do delete multiple
                        var idList = req.body.deleteList || [0, 0];
                        if (!idList.some(isNaN)) {
                                // ADD CHECK TO NOT ALLOW DELETION OF USERID 1
                                logger.main.info(`Deleting: ${idList}`);
                                db.from('users')
                                        .del()
                                        .where('id', 'in', idList)
                                        .then(result => {
                                                res.status(200).send({ status: 'ok' });
                                        })
                                        .catch(err => {
                                                res.status(500).send(err);
                                        });
                        } else {
                                res.status(400).send({ status: 'error', error: 'id list contained non-numbers' });
                        }
                } else if (req.body.username && req.body.email && req.body.givenname) {
                        var password = req.body.newpassword || req.body.password || null;
                        if (id == 'new') {
                                // Password is a required field if this is a new account check for that
                                if (!req.body.password) {
                                        return res
                                                .status(400)
                                                .send({ status: 'error', error: 'Error - required field missing' });
                                }
                                id = null;
                        }
                        console.time('insert');
                        db.from('users')
                                .returning('id')
                                .where('id', '=', id)
                                .modify(function(queryBuilder) {
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
                                .then(result => {
                                        console.timeEnd('insert');
                                        res.status(200).send({ status: 'ok', id: result[0].id });
                                })
                                .catch(err => {
                                        console.timeEnd('insert');
                                        logger.main.error(err);
                                        res.status(500).send(err);
                                });
                } else {
                        res.status(400).send({ status: 'error', error: 'Error - required field missing' });
                }
        })
        .delete(authHelper.isAdmin, function(req, res, next) {
                var id = parseInt(req.params.id, 10);
                if (id != 1) {
                        logger.main.info(`Deleting User ${id}`);
                        db.from('users')
                                .del()
                                .where('id', id)
                                .then(result => {
                                        res.status(200).send({ status: 'ok' });
                                })
                                .catch(err => {
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
                },
        };
        const statusCode = err.status || 500;

        if (process.env.NODE_ENV === 'development') {
                output.error.stack = err.stack;
                output.error.text = err.toString();
        }
        res.status(statusCode).json(output);
}
