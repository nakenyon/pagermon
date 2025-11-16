const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const LocalAPIKeyStrategy = require('passport-localapikey-update').Strategy;

const nconf = require('nconf');

const init = require('./passport');
const db = require('../knex/knex');
const { comparePass } = require('./helper');

const confFile = './config/config.json';
nconf.file({ file: confFile });

const options = {};

init();

passport.use(
    'login-user',
    new LocalStrategy(options, async (username, password, done) => {
        // check to see if the username exists
        try {
            const user = await db('users').where('username', '=', username).first();

            if (!(user && comparePass(password, user.password))) {
                return done(null, false);
            }
            return done(null, user);
        } catch (err) {
            done(err);
        }
    })
);

passport.use(
    'login-api',
    new LocalAPIKeyStrategy((apikey, done) => {
        nconf.load();
        const auth = nconf.get('auth');
        const key = auth.keys.find((x) => x.key === apikey);
        // var key = auth.keys.find({ key: apikey });
        if (!key) return done(null, false);

        // do a bcrypt compare
        if (apikey !== key.key) return done(null, false);

        return done(null, key.name);
    })
);

module.exports = passport;
