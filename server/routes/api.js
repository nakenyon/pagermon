
const bcrypt = require('bcrypt');
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
