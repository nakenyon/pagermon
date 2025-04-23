const express = require('express');
const _ = require('underscore');
const { InvalidRequestError, RequiredFieldMissingError, ResourceNotFoundError } = require('../../helpers/errors');

const db = require('../../knex/knex');
const authHelper = require('../../middleware/authhelper');
const logger = require('../../log');
const nconf = require('nconf');

const router = express.Router();

router.route('/user').get(authHelper.isAdmin, async function(req, res, next) {
        try {
                const users = await db
                        .from('users')
                        .select('id', 'givenname', 'surname', 'username', 'email', 'role', 'status', 'lastlogondate');
                res.json(users);
        } catch (error) {
                next(error);
        }
});

module.exports = router;
