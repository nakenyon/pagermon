const express = require('express');

const router = express.Router();
const bcrypt = require('bcryptjs');
const moment = require('moment');
const nconf = require('nconf');

const confFile = './config/config.json';
nconf.file({ file: confFile });
nconf.load();

// Brute force protection for public dupe checking routes
const ExpressBrute = require('express-brute');
const BruteKnex = require('brute-knex');

const db = require('../knex/knex.js');
const logger = require('../log');
const passport = require('../auth/local');
const authHelper = require('../middleware/authhelper')
const csrf = require('../middleware/csrf');
const sessionversion = require('../middleware/sessionversion');
const usertokens = require('../lib/usertokens');
const passwordpolicy = require('../lib/passwordpolicy');
const passwordreset = require('../lib/passwordreset');
const siteurl = require('../lib/siteurl');
const mailer = require('../mail/mailer');
const mailTemplates = require('../mail/templates');

// Cost 12 for new hashes. Every existing call site used genSaltSync() with no
// argument, i.e. bcryptjs' default of 10, and the admin seeded from config.json
// is cost 8. comparePass verifies any cost, so raising it needs no migration -
// hashes are simply stronger as users change their passwords.
const BCRYPT_ROUNDS = 12;

const store = new BruteKnex({
        createTable: true,
        knex: db,
        tablename: 'protection',
});

const lockoutCallback = function(req, res, next, nextValidRequestDate) {
        res.status(429).send({ status: 'lockedout', error: 'Too many attempts, please try again later' });
        logger.auth.info(`Lockout: ${req.ip} Next Valid: ${nextValidRequestDate}`);
};

// Guards the username/email existence checks. Filling in a registration form
// needs a handful of these; anything beyond that is someone probing for valid
// accounts, so the old 10 free retries with a 20s ceiling was generous.
const bruteforcedupe = new ExpressBrute(store, {
        freeRetries: 5,
        minWait: 5000, // 5 seconds
        maxWait: 5 * 60 * 1000, // 5 minutes
        failCallback: lockoutCallback,
});

const bruteforcelogin = new ExpressBrute(store, {
        freeRetries: 5,
        minWait: 10000, // 10 seconds
        maxWait: 15 * 60 * 1000, // 15 minutes
        failCallback: lockoutCallback,
});

// Guards the unauthenticated reset endpoints. Tighter than login because there
// is no legitimate reason to ask for a reset link repeatedly, and every request
// costs an outbound email.
const bruteforcereset = new ExpressBrute(store, {
        freeRetries: 5,
        minWait: 30000, // 30 seconds
        maxWait: 60 * 60 * 1000, // 1 hour
        failCallback: lockoutCallback,
});

// End Bruteforce

// CSRF applies to every /auth route. issue publishes the token on page loads,
// verify rejects state-changing requests that do not echo it back. Mounted at
// router level so it runs ahead of the per-route bruteforce middleware - a
// request rejected for CSRF should not also burn an IP's login attempts.
router.use(csrf.issue);
router.use(csrf.verify);

// Pages reached by clicking an emailed link carry a single-use token in the URL.
// no-referrer stops that token being handed to any third-party resource the page
// loads, and no-store keeps it out of shared caches and the back button.
function tokenPageHeaders(res) {
        res.set('Referrer-Policy', 'no-referrer');
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.set('Pragma', 'no-cache');
}

// Sends mail without letting the caller learn whether it worked. Delivery
// failure is logged for the admin but never surfaced, because "this address
// bounced" is exactly the account-existence signal the reset flow is built to
// withhold.
function sendQuietly(to, message, context) {
        return mailer
                .send(nconf, {
                        to: to,
                        subject: message.subject,
                        text: message.text,
                        html: message.html,
                })
                .catch(err => {
                        logger.auth.error(`Mail: failed to send ${context}: ${err.message}`);
                });
}

function monitorName() {
        return nconf.get('global:monitorName') || 'PagerMon';
}

// Always the async API, never hashSync. bcryptjs is pure JavaScript, so a cost
// 12 hash is ~500ms of work; hashSync blocks the event loop for all of it, which
// on this app means message ingest stalls every time somebody logs in. The async
// variant costs the same wall time but yields between rounds, so the server
// keeps serving.
function hashPassword(password) {
        return new Promise((resolve, reject) => {
                bcrypt.genSalt(BCRYPT_ROUNDS, (err, salt) => {
                        if (err) return reject(err);
                        return bcrypt.hash(password, salt, (hashErr, hash) => {
                                if (hashErr) return reject(hashErr);
                                return resolve(hash);
                        });
                });
        });
}

router.route('/login')
        .get(function(req, res) {
                if (!req.isAuthenticated()) {
                        let user = '';
                        if (typeof req.username !== 'undefined') {
                                user = req.username;
                        }
                        res.render('auth', {
                                pageTitle: 'User',
                        });
                } else {
                        res.redirect('/');
                }
        })
        .post(bruteforcelogin.prevent, function(req, res, next) {
                passport.authenticate('login-user', (err, user) => {
                        if (err) {
                                //this is commented out as it seems to fire when a user is disabled?! even tho the below functions still run
                                //res.status(500).send({ status: 'failed', error: 'An Error Occured' });
                                logger.auth.error(err);
                        } else if (!user) {
                                res.status(401).send({ status: 'failed', error: 'Check Details and try again' });
                                logger.auth.debug(`Login Failed: ${req.body.username}`);
                        } else if (user) {
                                if (user.status !== 'disabled') {
                                        // Session fixation: passport reuses whatever session id the
                                        // client already had, so an id planted before login stays
                                        // valid after it. Regenerate first, which means re-issuing
                                        // the CSRF token too since the old secret went with it.
                                        req.session.regenerate(function(regenErr) {
                                        if (regenErr) {
                                                logger.auth.error(`Session regenerate failed: ${regenErr}`);
                                                return res.status(500).send({
                                                        status: 'failed',
                                                        error: 'An error occured',
                                                });
                                        }
                                        csrf.ensure(req, res);
                                        return req.logIn(user, function(err) {
                                                if (err) {
                                                        res.status(401).send({
                                                                status: 'failed',
                                                                error: 'An error occured',
                                                        });
                                                        logger.auth.debug(
                                                                `Failed login ${JSON.stringify(user)} ${err}`
                                                        );
                                                } else {
                                                        // Record the password generation this session
                                                        // was issued against - see
                                                        // middleware/sessionversion.js.
                                                        sessionversion.stamp(req, user);
                                                        // Update last logon timestamp for user
                                                        const { id } = user;
                                                        // create the datetime, thanks mysql ┌∩┐(◣_◢)┌∩┐
                                                        const currentTimestamp = moment().unix(); // in seconds
                                                        const currentDatetime = moment(currentTimestamp * 1000).format(
                                                                'YYYY-MM-DD HH:mm:ss'
                                                        );
                                                        return db
                                                                .from('users')
                                                                .where('id', '=', id)
                                                                .update({
                                                                        lastlogondate: currentDatetime,
                                                                })
                                                                .then(() => {
                                                                        // Reset the bruteforce counter after a successful login.
                                                                        // ExpressBrute's reset() takes (ip, key, callback), so the
                                                                        // previous `reset(null)` cleared nothing and the counter
                                                                        // survived every successful login - failures accumulated
                                                                        // until lockout no matter how many logins succeeded in
                                                                        // between. req.brute.reset() is attached by the prevent
                                                                        // middleware and clears the exact key it counted against.
                                                                        if (req.brute && req.brute.reset) req.brute.reset();
                                                                        if (user.role !== 'admin') {
                                                                                res.status(200).send({
                                                                                        status: 'ok',
                                                                                        redirect: '/',
                                                                                });
                                                                        } else {
                                                                                res.status(200).send({
                                                                                        status: 'ok',
                                                                                        redirect: '/admin',
                                                                                });
                                                                        }
                                                                        logger.auth.debug(
                                                                                `Successful login ${JSON.stringify(
                                                                                        user
                                                                                )}`
                                                                        );
                                                                })
                                                                .catch(err => {
                                                                        logger.db.error(err);
                                                                });
                                                }
                                        });
                                        });
                                } else {
                                        res.status(401).send({ status: 'failed', error: 'User Disabled' });
                                        // req.user is not set on a failed login - this used to throw
                                        // a TypeError instead of logging the disabled account.
                                        logger.auth.debug(`User Disabled: ${user.username}`);
                                }
                        }
                })(req, res, next);
        });

router.route('/logout').get(authHelper.isLoggedIn, function(req, res) {
        // Capture the username before logout() clears req.user. Reading
        // req.user.username afterwards throws a TypeError, and because that fired
        // after res.redirect() had already sent the headers, Express could not turn
        // it into an error response - the connection was destroyed instead, so every
        // logout returned ECONNRESET to the client rather than the redirect.
        const username = req.user && req.user.username;
        req.logout();
        logger.auth.debug(`Successful Logout ${username}`);
        res.redirect('/');
});

router.route('/profile/').get(authHelper.isLoggedIn, function(req, res) {
        res.render('auth', {
                pageTitle: 'User',
        });
});

router.route('/profile/:id')
        .get(authHelper.isLoggedIn, function(req, res, next) {
                const { username } = req.user;
                db.from('users')
                        .select('id', 'givenname', 'surname', 'username', 'email', 'lastlogondate')
                        .where('username', username)
                        .then(function(row) {
                                if (row.length === 0) {
                                        res.status(500).json({ status: 'failed', error: '' });
                                        logger.auth.error('failed to select user');
                                        return null;
                                }
                                const rowsend = row[0];
                                // Surface an address still awaiting confirmation so the
                                // profile page can say so - otherwise a user who changed
                                // their email sees the old one and assumes it failed.
                                return db('user_tokens')
                                        .where({ userid: rowsend.id, purpose: usertokens.EMAIL_CHANGE })
                                        .whereNull('usedat')
                                        .where('expires', '>', usertokens.nowSeconds())
                                        .first('payload')
                                        .then(pending => {
                                                if (pending) rowsend.pendingEmail = pending.payload;
                                                res.status(200);
                                                res.json(rowsend);
                                        });
                        })
                        .catch(err => {
                                logger.main.error(err);
                                return next(err);
                        });
        })
        .post(authHelper.isLoggedIn, function(req, res) {
                if (req.body.username !== req.user.username) {
                        res.status(401).json({ message: 'Please update your own details only' });
                        logger.auth.error('Possible attempt to compromise security POST:/auth/profile');
                        return;
                }

                const { username } = req.body;
                const { givenname } = req.body;
                const surname = req.body.surname || '';
                const email = (req.body.email || '').trim();

                // The column is NOT NULL and the form marks it required, so an empty
                // value is a bad request rather than something to save. Checked here
                // because email is no longer part of the update below, which used to
                // mean the database rejected it for us.
                if (!email) {
                        return res.status(400).send({ status: 'failed', error: 'Email address is required' });
                }
                if (!givenname) {
                        return res.status(400).send({ status: 'failed', error: 'Given name is required' });
                }

                // Loaded rather than taken from req.user: the session copy may be
                // stale, and it is not guaranteed to carry an id at all.
                return db('users')
                        .where('username', req.user.username)
                        .first()
                        .then(user => {
                                if (!user) {
                                        return res.status(401).json({ status: 'failed', error: 'Not authorised' });
                                }

                                // Case-insensitive: changing only the case of an address is
                                // not a change worth a round of verification.
                                const emailChanged = email.toLowerCase() !== (user.email || '').toLowerCase();

                                // The email is deliberately absent from this update. An
                                // address that can be changed silently is an account takeover
                                // primitive once self-service reset exists: steal a session,
                                // repoint the address, request a reset. It is committed by
                                // POST /auth/verify-email instead.
                                return db('users')
                                        .where('id', user.id)
                                        .update({ username, givenname, surname })
                                        .then(() => {
                                                if (!emailChanged) {
                                                        return res.status(200).send({ status: 'ok', id: user.id });
                                                }

                                                // Without a mailer there is no verification path - and
                                                // also no reset flow to protect - so keep the old
                                                // direct-write behaviour rather than locking users out
                                                // of their own profile.
                                                if (!mailer.isConfigured(nconf)) {
                                                        return db('users')
                                                                .where('id', user.id)
                                                                .update({ email })
                                                                .then(() => {
                                                                        logger.auth.info(
                                                                                `${user.username} changed email directly (mail not configured)`
                                                                        );
                                                                        return res
                                                                                .status(200)
                                                                                .send({ status: 'ok', id: user.id });
                                                                });
                                                }

                                                return db('users')
                                                        .whereRaw('lower(email) = ?', [email.toLowerCase()])
                                                        .whereNot('id', user.id)
                                                        .first('id')
                                                        .then(taken => {
                                                                if (taken) {
                                                                        return res.status(400).send({
                                                                                status: 'failed',
                                                                                error:
                                                                                        'That email address is already in use',
                                                                        });
                                                                }

                                                                return usertokens
                                                                        .issue(
                                                                                db,
                                                                                user.id,
                                                                                usertokens.EMAIL_CHANGE,
                                                                                passwordreset.ttlSeconds(nconf),
                                                                                {
                                                                                        payload: email,
                                                                                        ip: req.ip,
                                                                                        throttleSeconds: 60,
                                                                                }
                                                                        )
                                                                        .then(issued => {
                                                                                if (issued.throttled) {
                                                                                        return res.status(429).send({
                                                                                                status: 'failed',
                                                                                                error:
                                                                                                        'A confirmation email was just sent, please check your inbox',
                                                                                        });
                                                                                }

                                                                                const link = siteurl.build(
                                                                                        `/auth/verify-email/${encodeURIComponent(
                                                                                                issued.token
                                                                                        )}`,
                                                                                        nconf
                                                                                );
                                                                                const ttl = passwordreset.ttlMinutes(
                                                                                        nconf
                                                                                );

                                                                                // To the new address: the
                                                                                // confirmation itself.
                                                                                const confirm = sendQuietly(
                                                                                        email,
                                                                                        mailTemplates.verifyEmail(
                                                                                                user,
                                                                                                email,
                                                                                                link,
                                                                                                ttl,
                                                                                                monitorName()
                                                                                        ),
                                                                                        'email verification'
                                                                                );
                                                                                // To the old address: a heads-up,
                                                                                // so moving the recovery address
                                                                                // cannot happen silently.
                                                                                const notice = user.email
                                                                                        ? sendQuietly(
                                                                                                  user.email,
                                                                                                  mailTemplates.emailChangeNotice(
                                                                                                          user,
                                                                                                          email,
                                                                                                          monitorName()
                                                                                                  ),
                                                                                                  'email change notice'
                                                                                          )
                                                                                        : Promise.resolve();

                                                                                return Promise.all([
                                                                                        confirm,
                                                                                        notice,
                                                                                ]).then(() => {
                                                                                        logger.auth.info(
                                                                                                `${user.username} requested an email change, awaiting confirmation`
                                                                                        );
                                                                                        return res.status(200).send({
                                                                                                status: 'ok',
                                                                                                id: user.id,
                                                                                                emailPending: true,
                                                                                                pendingEmail: email,
                                                                                        });
                                                                                });
                                                                        });
                                                        });
                                        });
                        })
                        .catch(err => {
                                logger.main.error(err);
                                res.status(400).send({ status: 'failed', error: 'Failed to save profile' });
                        });
        });

router.route('/verify-email/:token').get(function(req, res) {
        tokenPageHeaders(res);
        res.render('auth', { pageTitle: 'User - Confirm Email' });
});

router.route('/verify-email').post(bruteforcereset.prevent, function(req, res) {
        usertokens
                .consume(db, usertokens.EMAIL_CHANGE, req.body.token)
                .then(result => {
                        if (!result.ok) {
                                logger.auth.info(`Email verification rejected: ${result.reason}`);
                                return res.status(400).send({
                                        status: 'failed',
                                        error: 'That confirmation link is invalid or has expired',
                                });
                        }

                        const newEmail = result.row.payload;

                        // Re-checked at redemption, not just at request: another account
                        // may have claimed the address while this token sat in an inbox.
                        return db('users')
                                .whereRaw('lower(email) = ?', [String(newEmail).toLowerCase()])
                                .whereNot('id', result.user.id)
                                .first('id')
                                .then(taken => {
                                        if (taken) {
                                                return res.status(400).send({
                                                        status: 'failed',
                                                        error: 'That email address is already in use',
                                                });
                                        }
                                        return db('users')
                                                .where('id', result.user.id)
                                                .update({ email: newEmail })
                                                .then(() => {
                                                        logger.auth.info(
                                                                `${result.user.username} confirmed new email address`
                                                        );
                                                        if (req.brute && req.brute.reset) req.brute.reset();
                                                        return res
                                                                .status(200)
                                                                .send({ status: 'ok', redirect: '/auth/profile' });
                                                });
                                });
                })
                .catch(err => {
                        logger.auth.error(`Email verification failed: ${err}`);
                        res.status(500).send({ status: 'failed', error: 'An error occurred' });
                });
});

router.route('/register')
        .get(function(req, res) {
                const reg = nconf.get('auth:registration');
                if (reg) {
                        res.render('auth', {
                                title: 'Registration',
                                message: req.flash('registerMessage'),
                        });
                } else {
                        res.redirect('/');
                }
        })
        .post(function(req, res, next) {
                const reg = nconf.get('auth:registration');
                if (reg) {
                        const policyError = passwordpolicy.validate(
                                req.body.password,
                                { username: req.body.username, email: req.body.email },
                                nconf
                        );
                        if (policyError) {
                                return res.status(400).json({ status: 'failed', error: policyError });
                        }
                        // dupecheck to prevent a non-literal insert being abused to reset passwords
                        return db('users')
                                .where('username', '=', req.body.username)
                                .orWhere('email', '=', req.body.email)
                                .select('id')
                                .then(row => {
                                        if (row.length > 0) {
                                                logger.auth.error(
                                                        `Duplicate registration via API${JSON.stringify(row)}`
                                                );
                                                res.status(401).json({ error: 'access denied' });
                                                return null;
                                        }
                                        return hashPassword(req.body.password).then(hash =>
                                                db('users')
                                                        .insert({
                                                                username: req.body.username,
                                                                password: hash,
                                                                givenname: req.body.givenname,
                                                                surname: req.body.surname,
                                                                email: req.body.email,
                                                                role: 'user',
                                                                status: 'active',
                                                                lastlogondate: Date.now(),
                                                        })
                                                        .then(() => {
                                                                passport.authenticate('login-user', (err, user) => {
                                                                        if (user) {
                                                                                req.logIn(user, function(err) {
                                                                                        if (err) {
                                                                                                res.status(500).json({
                                                                                                        status:
                                                                                                                'failed',
                                                                                                        error: err,
                                                                                                        redirect:
                                                                                                                '/auth/register',
                                                                                                });
                                                                                                logger.auth.error(err);
                                                                                        } else {
                                                                                                res.status(200).json({
                                                                                                        status: 'ok',
                                                                                                        redirect: '/',
                                                                                                });
                                                                                                logger.auth.info(
                                                                                                        `Created Account: ${user}`
                                                                                                );
                                                                                        }
                                                                                });
                                                                        } else {
                                                                                logger.auth.error(err);
                                                                                res.status(500).json({
                                                                                        status: 'failed',
                                                                                        error: err,
                                                                                        redirect: '/auth/register',
                                                                                });
                                                                        }
                                                                })(req, res, next);
                                                        })
                                        );
                                })
                                .catch(err => {
                                        logger.auth.error(err);
                                        res.status(400).json({
                                                status: 'failed',
                                                error: 'invalid data',
                                        });
                                });
                }
                logger.auth.error('Registration attempted with registration disabled');
                return res.status(400).json({ error: 'registration disabled' });
        });

router.route('/reset')
        .get(function(req, res) {
                let user = '';
                if (typeof req.username !== 'undefined') {
                        user = req.username;
                }
                if (req.user) {
                        return res.render('auth', {
                                title: 'User - Reset Password',
                                message: req.flash('loginMessage'),
                                username: user,
                        });
                } else {
                res.redirect('/auth/login');
                }
        })
        .post(authHelper.isLoggedIn, function(req, res) {
                const { password } = req.body;
                const currentpassword = req.body.currentpassword;

                // Proving knowledge of the current password is what stops a stolen or
                // unattended session being turned into permanent ownership of the
                // account. Previously any live session could set a new password.
                if (typeof currentpassword !== 'string' || !currentpassword.length) {
                        return res
                                .status(400)
                                .send({ status: 'failed', error: 'Your current password is required' });
                }

                const policyError = passwordpolicy.validate(password, req.user, nconf);
                if (policyError) {
                        return res.status(400).send({ status: 'failed', error: policyError });
                }

                // Loaded fresh rather than trusting req.user: the session was
                // deserialised at the start of the request and may hold a stale hash.
                // Keyed on username because that is the field the session is
                // guaranteed to carry.
                return db('users')
                        .where('username', req.user.username)
                        .first()
                        .then(user => {
                                if (!user) {
                                        return res
                                                .status(401)
                                                .send({ status: 'failed', error: 'Not authorised' });
                                }
                                return authHelper
                                        .comparePassAsync(currentpassword, user.password)
                                        .then(matched => {
                                                if (!matched) {
                                                        logger.auth.warn(
                                                                `${user.username} password change refused - wrong current password (${req.ip})`
                                                        );
                                                        return res.status(400).send({
                                                                status: 'failed',
                                                                error: 'Your current password is not correct',
                                                        });
                                                }
                                                return authHelper
                                                        .comparePassAsync(password, user.password)
                                                        .then(same => {
                                                                if (same) {
                                                                        return res.status(400).send({
                                                                                status: 'failed',
                                                                                error:
                                                                                        'New password must be different from your current one',
                                                                        });
                                                                }
                                                                return applyNewPassword(user, password).then(() => {
                                                                        // Keep this session alive - it is the
                                                                        // one that made the change. Every other
                                                                        // session for the account is now behind
                                                                        // the stamp and gets dropped.
                                                                        sessionversion.stamp(req, {
                                                                                pwchangedat: usertokens.nowSeconds(),
                                                                        });
                                                                        logger.auth.info(
                                                                                `${user.username} changed their password`
                                                                        );
                                                                        return res
                                                                                .status(200)
                                                                                .send({ status: 'ok', redirect: '/' });
                                                                });
                                                        });
                                        });
                        })
                        .catch(err => {
                                logger.auth.error(`${req.user.username} error resetting password: ${err}`);
                                res.status(500).send({ status: 'failed', error: 'Failed to update password' });
                        });
        });

// Writes a new password, bumps the stamp that invalidates older sessions, and
// tells the account owner it happened. Shared by the logged-in change form and
// the emailed reset, so the two cannot drift apart.
function applyNewPassword(user, password) {
        return hashPassword(password).then(hash =>
                db('users')
                        .where('id', user.id)
                        .update({ password: hash, pwchangedat: usertokens.nowSeconds() })
                        .then(() => {
                                // Best-effort: an account whose password was changed by
                                // someone else only finds out if this arrives, but a mail
                                // failure must not roll back the change.
                                if (user.email && mailer.isConfigured(nconf)) {
                                        sendQuietly(
                                                user.email,
                                                mailTemplates.passwordChanged(user, monitorName()),
                                                'password change notification'
                                        );
                                }
                        })
        );
}

// Uniform reply for every outcome of a reset request. An attacker must not be
// able to tell a registered address from an unregistered one, a disabled account
// from an active one, or a delivered mail from a bounced one.
const FORGOT_REPLY = {
        status: 'ok',
        message: 'If that email address has an account, a reset link is on its way.',
};

router.route('/forgot')
        .get(function(req, res) {
                if (!passwordreset.isEnabled(nconf)) return res.redirect('/auth/login');
                if (req.user) return res.redirect('/');
                return res.render('auth', { pageTitle: 'User - Forgot Password' });
        })
        .post(bruteforcereset.prevent, function(req, res) {
                if (!passwordreset.isEnabled(nconf)) {
                        return res
                                .status(404)
                                .send({ status: 'failed', error: 'Password reset is not available' });
                }

                const email = (req.body.email || '').trim();
                if (!email) {
                        return res.status(400).send({ status: 'failed', error: 'Email address is required' });
                }

                // Everything past this point resolves to FORGOT_REPLY. Failures are
                // logged for the admin and never described to the caller.
                return db('users')
                        .whereRaw('lower(email) = ?', [email.toLowerCase()])
                        .first()
                        .then(user => {
                                if (!user) {
                                        logger.auth.info(`Reset requested for unknown address from ${req.ip}`);
                                        return null;
                                }
                                if (user.status !== 'active') {
                                        logger.auth.info(`Reset requested for disabled account ${user.username}`);
                                        return null;
                                }

                                return usertokens
                                        .issue(db, user.id, usertokens.PASSWORD_RESET, passwordreset.ttlSeconds(nconf), {
                                                ip: req.ip,
                                                // Per-account counterpart to the IP-keyed bruteforce
                                                // guard, so a distributed attempt cannot mail-bomb one
                                                // user.
                                                throttleSeconds: 60,
                                        })
                                        .then(issued => {
                                                if (issued.throttled) return null;
                                                const link = siteurl.build(
                                                        `/auth/reset-password/${encodeURIComponent(issued.token)}`,
                                                        nconf
                                                );
                                                return sendQuietly(
                                                        user.email,
                                                        mailTemplates.passwordReset(
                                                                user,
                                                                link,
                                                                passwordreset.ttlMinutes(nconf),
                                                                monitorName()
                                                        ),
                                                        'password reset'
                                                );
                                        });
                        })
                        .catch(err => {
                                logger.auth.error(`Reset request failed: ${err}`);
                        })
                        .then(() => res.status(200).send(FORGOT_REPLY));
        });

router.route('/reset-password/:token').get(function(req, res) {
        tokenPageHeaders(res);
        res.render('auth', { pageTitle: 'User - Reset Password' });
});

router.route('/reset-password').post(bruteforcereset.prevent, function(req, res) {
        if (!passwordreset.isEnabled(nconf)) {
                return res.status(404).send({ status: 'failed', error: 'Password reset is not available' });
        }

        const { token, password } = req.body;

        return usertokens
                .consume(db, usertokens.PASSWORD_RESET, token)
                .then(result => {
                        if (!result.ok) {
                                logger.auth.info(`Reset rejected (${result.reason}) from ${req.ip}`);
                                // One message for every rejection reason: distinguishing
                                // "expired" from "no such token" would confirm to an attacker
                                // that a guessed token had once existed.
                                return res.status(400).send({
                                        status: 'failed',
                                        error: 'That reset link is invalid or has expired',
                                });
                        }

                        // Validated after consuming rather than before: a token spent on a
                        // password that fails policy is deliberately not reusable, so a
                        // weak-password retry loop cannot be run against a stolen link.
                        const policyError = passwordpolicy.validate(password, result.user, nconf);
                        if (policyError) {
                                return res.status(400).send({ status: 'failed', error: policyError });
                        }

                        return applyNewPassword(result.user, password).then(() => {
                                logger.auth.info(`${result.user.username} completed a password reset`);
                                if (req.brute && req.brute.reset) req.brute.reset();
                                // No auto-login: a fresh login proves the new password works
                                // and avoids minting a session from a link that may have been
                                // forwarded.
                                return res.status(200).send({ status: 'ok', redirect: '/auth/login' });
                        });
                })
                .catch(err => {
                        logger.auth.error(`Reset failed: ${err}`);
                        res.status(500).send({ status: 'failed', error: 'An error occurred' });
                });
});

// Existence checks for the registration form.
//
// These used to return the matching row when a value was taken and a blank user
// skeleton when it was not, which made them a public "is this address
// registered?" service - and one that would have flatly contradicted the
// deliberately uninformative reply from /auth/forgot. They now answer the one
// bit the form actually needs.
function takenCheck(column) {
        return function(req, res, next) {
                db('users')
                        .whereRaw(`lower(${column}) = ?`, [String(req.params.id || '').toLowerCase()])
                        .first('id')
                        .then(row => {
                                res.status(200).json({ taken: !!row });
                        })
                        .catch(err => {
                                logger.main.error(err);
                                return next(err);
                        });
        };
}

router.route('/userCheck/username/:id').get(bruteforcedupe.prevent, takenCheck('username'));
router.route('/userCheck/email/:id').get(bruteforcedupe.prevent, takenCheck('email'));

module.exports = router;

