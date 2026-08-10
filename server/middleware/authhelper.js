// pass passport for configuration
const bcrypt = require('bcryptjs');
var nconf = require('nconf');

var confFile = './config/config.json';
nconf.file({ file: confFile });
nconf.load();

function isLoggedIn (req, res, next) {    
    const passport = require('../auth/local');
            if (req.isAuthenticated()) {
                // if user is authenticated in the session, carry on
                return next();
            } else {
                //perform api authentication - all api keys are assumed to be admin 
                return passport.authenticate('login-api', { session: false, failWithError: true })(req, res, next),
                    function (next) {
                        next();
                    },
                    function (res) {
                        return res.status(401).json({ error: 'Authentication failed.' });
                    }
            }
}

function isLoggedInMessages (req, res, next) {    
    const passport = require('../auth/local');
    var apiSecurity = nconf.get('messages:apiSecurity');
        if (apiSecurity) { //check if Secure mode is on
            if (req.isAuthenticated()) {
                // if user is authenticated in the session, carry on
                return next();
            } else {
                //perform api authentication - all api keys are assumed to be admin 
                return passport.authenticate('login-api', { session: false, failWithError: true })(req, res, next),
                    function (next) {
                        next();
                    },
                    function (res) {
                        return res.status(401).json({ error: 'Authentication failed.' });
                    }
            }
        } else {
            return next();
        }
}

function isAdminGUI (req, res, next) {
    if (req.isAuthenticated() && req.user.role == 'admin') {
      //if the user is authenticated and the user's role is admin carry on
      return next();
    } else {
        res.redirect('/')
    }
}

function isAdmin (req, res, next) {
    const passport = require('../auth/local');
    if (req.isAuthenticated() && req.user.role == 'admin') {
      //if the user is authenticated and the user's role is admin carry on
      return next();
    } else {
        //if apikey in header perform api authentication - all api keys are assumed to be admin 
      return passport.authenticate('login-api', { session: false, failWithError: true })(req, res, next),
        function (next) {
          next();
        },
        function (res) {
          return res.status(401).json({ error: 'Authentication failed.' });
        }
    } 
  }

  function comparePass(userPassword, databasePassword) {
    return bcrypt.compareSync(userPassword, databasePassword);
}

// Async counterpart, preferred for anything on a request path. bcryptjs is pure
// JavaScript, so a compare against a cost-12 hash is ~500ms of computation and
// compareSync blocks the event loop for the whole of it - long enough to stall
// message ingest on every login. This costs the same wall time but yields
// between rounds. comparePass is kept for callers that are not on a hot path.
function comparePassAsync(userPassword, databasePassword) {
    return new Promise((resolve) => {
        if (typeof userPassword !== 'string' || typeof databasePassword !== 'string') {
            return resolve(false);
        }
        return bcrypt.compare(userPassword, databasePassword, (err, matched) => {
            if (err) return resolve(false);
            return resolve(matched === true);
        });
    });
}

module.exports = {
    isLoggedIn,
    isLoggedInMessages,
    isAdmin,
    isAdminGUI,
    comparePass,
    comparePassAsync
}
  
