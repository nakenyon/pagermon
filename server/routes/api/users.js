const express = require('express');
const _ = require('underscore');
const { InvalidRequestError, RequiredFieldMissingError, ResourceNotFoundError } = require('../../helpers/errors');

const bcrypt = require('bcrypt');
const db = require('../../knex/knex');
const authHelper = require('../../middleware/authhelper');
const logger = require('../../log');
const nconf = require('nconf');

const router = express.Router();

/**
 * @typedef User
 * @property {Number} id The user's id
 * @property {string} username The user's unique username
 * @property {string} givenname The user's first name
 * @property {string} [surname] The user's last name
 * @property {string} email The user's email address
 * @property {"user"|"admin"} role The user's role
 * @property {"active"|"inactive"} status The user's status
 */

/**
 * Returns a single user object from the database
 * @param {false|Object} filter If false, an empty user object is returned
 * @param {User.id} filter.id The id of the user
 * @param {User.username} filter.username The users username
 * @returns {User} The user object, an empty one if nothing was found.
 */
async function getSingleUser(filter) {
        const defaults = {
                username: '',
                password: '',
                givenname: '',
                surname: '',
                email: '',
                role: 'user',
                status: 'active',
        };
        if (!filter) return defaults;

        const filterCleaned = _.pick(filter, ['id', 'username']);
        const user = await db
                .from('users')
                .select('*')
                .where(filterCleaned)
                .first();

        return user || defaults;
}

router.route('/user')
        .get(authHelper.isAdmin, async function(req, res, next) {
                try {
                        const users = await db
                                .from('users')
                                .select(
                                        'id',
                                        'givenname',
                                        'surname',
                                        'username',
                                        'email',
                                        'role',
                                        'status',
                                        'lastlogondate'
                                );
                        res.json(users);
                } catch (error) {
                        next(error);
                }
        })
        .post(authHelper.isAdmin, async function(req, res, next) {
                try {
                        if (!req.body.username) throw new RequiredFieldMissingError('username');
                        if (!req.body.email) throw new RequiredFieldMissingError('email');
                        if (!req.body.givenname) throw new RequiredFieldMissingError('givenname');
                        if (!req.body.password) throw new RequiredFieldMissingError('password');
                        if (!req.body.status) throw new RequiredFieldMissingError('status');
                        if (!req.body.role) throw new RequiredFieldMissingError('role');

                        const { username, email } = req.body;

                        const existingUser = await db
                                .table('users')
                                .where('username', '=', username)
                                .orWhere('email', '=', email)
                                .first();

                        if (existingUser) {
                                // TODO: switch to Error handling, we need to get the responses uniform...
                                // add logging
                                return res.status(400).send({
                                        status: 'error',
                                        error: 'Username or Email exists',
                                });
                        }
                        const salt = bcrypt.genSaltSync();
                        const hash = bcrypt.hashSync(req.body.password, salt);

                        const insertedUser = await db('users')
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
                                .returning('id');

                        // add logging
                        logger.main.debug(`created user id: ${insertedUser[0].id}`);
                        res.status(200).send({
                                status: 'ok',
                                id: insertedUser[0].id,
                        });
                } catch (error) {
                        next(error);
                }
        });

router.route('/user/:id').get(authHelper.isAdmin, async function(req, res, next) {
        try {
                const { id } = req.params;

                if (id === 'new') return res.json(await getSingleUser(false));

                const user = await db
                        .from('users')
                        .select('id', 'givenname', 'surname', 'username', 'email', 'role', 'status', 'lastlogondate')
                        .where('id', id)
                        .first();
                if (!user) return res.json(await getSingleUser(false));

                res.json(user);
        } catch (error) {
                next(error);
        }
});

module.exports = router;
