// pass passport for configuration

const nconf = require('nconf');
const passport = require('../auth/local');

const apiSecurity = nconf.get('message:apiSecurity');

const confFile = './config/config.json';
nconf.file({ file: confFile });
nconf.load();

function isLoggedIn(req, res, next) {
        if (req.isAuthenticated()) {
                // if user is authenticated in the session, carry on
                return next();
        }
        // perform api authentication - all api keys are assumed to be admin
        return (
                passport.authenticate(['login-feeder-api', 'login-api'], { session: false, failWithError: true })(
                        req,
                        res,
                        next
                ),
                function(next) {
                        next();
                },
                function(res) {
                        return res.status(401).json({ error: 'Authentication failed.' });
                }
        );
}

function isLoggedInMessages(req, res, next) {
        if (!apiSecurity) {
                // if user is authenticated in the session, carry on
                return next();
        }

        if (req.isAuthenticated()) {
                // if user is authenticated in the session, carry on
                return next();
        }

        // perform api authentication - all api keys are assumed to be admin
        return (
                passport.authenticate('login-api', { session: false, failWithError: true })(req, res, next),
                function(next) {
                        next();
                },
                function(res) {
                        return res.status(401).json({ error: 'Authentication failed.' });
                }
        );
}

function isAdminGUI(req, res, next) {
        if (req.isAuthenticated() && req.user.role === 'admin') {
                // if the user is authenticated and the user's role is admin carry on
                return next();
        }
        res.redirect('/');
}

function isAdmin(req, res, next) {
        if (req.isAuthenticated()) {
                if (req.user.role === 'admin')
                        // if the user is authenticated and the user's role is admin carry on
                        return next();

                // If user is authenticated, but not admin, send 403
                return res.status(403).json({ error: 'Forbidden' });
        }
        // if apikey in header perform api authentication - all api keys are assumed to be admin
        return (
                passport.authenticate(['login-feeder-api', 'login-api'], { session: false, failWithError: true })(
                        req,
                        res,
                        next
                ),
                function(next) {
                        next();
                },
                function(res) {
                        return res.status(401).json({ error: 'Authentication failed.' });
                }
        );
}

module.exports = {
        isLoggedIn,
        isLoggedInMessages,
        isAdmin,
        isAdminGUI,
};
