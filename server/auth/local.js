const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const LocalAPIKeyStrategy = require('passport-localapikey-update').Strategy;

const nconf = require('nconf');
const logger = require('../log');

const confFile = './config/config.json';
nconf.file({ file: confFile });

const init = require('./passport');
const db = require('../knex/knex.js');

const authHelper = require('../middleware/authhelper')

const options = {};

init();

passport.use(
        'login-user',
        new LocalStrategy(options, (username, password, done) => {
                // check to see if the username exists
                db('users')
                        .where('username', '=', username)
                        .first()
                        .then(user => {
                                if (!user) {
                                        return done(null, false);
                                }
                                // Async compare so a login does not block the
                                // event loop for the duration of the hash - see
                                // comparePassAsync in middleware/authhelper.js.
                                return authHelper
                                        .comparePassAsync(password, user.password)
                                        .then(matched => done(null, matched ? user : false));
                        })
                        .catch(err => done(err));
        })
);

passport.use(
        'login-api',
        new LocalAPIKeyStrategy({ passReqToCallback: true }, function(req, apikey, done) {
                nconf.load();
                const auth = nconf.get('auth');
                const key = auth.keys.find(x => x.key === apikey);
                // var key = auth.keys.find({ key: apikey });
                if (key) {
                        // do a bcrypt compare
                        if (apikey == key.key) {
                                // Metadata only: retain the legacy principal and authorization behavior.
                                req.readerKeyId = key.id;
                                // This used to be the bare string key.name, which made
                                // req.user a string - so every downstream req.user.role
                                // read was undefined on a String object and evaluated
                                // false. Multi-system ingest needs the key's system here,
                                // which a string cannot carry.
                                //
                                // role is 'apikey', deliberately NOT 'admin': isAdmin and
                                // isLoggedIn in middleware/authhelper.js do not inspect
                                // role on the API-key branch, so an unrecognised value
                                // leaves every one of those role checks false, exactly as
                                // the bare string did. Using 'admin' would flip them and
                                // silently change what an API-key GET /api/messages
                                // returns under pdwMode + adminShow.
                                return done(null, {
                                        apikey: true,
                                        name: key.name,
                                        role: 'apikey',
                                        system: key.system,
                                        systems: Array.isArray(key.systems) ? key.systems : [],
                                        allowSourceOverride: !!key.allowSourceOverride
                                });
                        }
                        return done(null, false);
                }
                return done(null, false);
        })
);

module.exports = passport;

