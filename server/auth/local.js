const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const LocalAPIKeyStrategy = require('passport-localapikey-update').Strategy;

const nconf = require('nconf');
const bcrypt = require('bcryptjs');

const confFile = './config/config.json';
nconf.file({ file: confFile });

const init = require('./passport');
const db = require('../knex/knex.js');

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
                                if (!comparePass(password, user.password)) {
                                        return done(null, false);
                                }
                                return done(null, user);
                        })
                        .catch(err => done(err));
        })
);

passport.use(
        'login-api',
        new LocalAPIKeyStrategy(function(apikey, done) {
                nconf.load();
                const auth = nconf.get('auth');
                const key = auth.keys.find(x => x.key === apikey);
                // var key = auth.keys.find({ key: apikey });
                if (key) {
                        // do a bcrypt compare
                        if (apikey === key.key) {
                                return done(null, key.name);
                        }
                        return done(null, false);
                }
                return done(null, false);
        })
);

passport.use(
        'login-feeder-api',
        new LocalAPIKeyStrategy(async function(apikey, done) {
                const feeder = await db('feeders')
                        .select('id', 'name')
                        .where('apikey', apikey)
                        .first();

                if (!feeder) {
                        return done(null, false);
                }

                return done(null, feeder);
        })
);

function comparePass(userPassword, databasePassword) {
        return bcrypt.compareSync(userPassword, databasePassword);
}

module.exports = passport;
