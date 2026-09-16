var confFile = './config/config.json';
var express = require('express');
var router = express.Router();
var nconf = require('nconf');

nconf.file({ file: confFile });
nconf.load();

const passport = require('../auth/local');
const systems = require('../lib/systems');

router.use(function (req, res, next) {
    res.locals.login = req.isAuthenticated();
    res.locals.user = req.user || false;
    res.locals.register = nconf.get('auth:registration')
    res.locals.hidecapcode = nconf.get('messages:HideCapcode');
    res.locals.pdwmode = nconf.get('messages:pdwMode');
    res.locals.hidesource = nconf.get('messages:HideSource');
    // Source is the individual reader/client. In multi-system mode the System
    // badge is usually the useful display value, so source is opt-in rather
    // than shown by default. The legacy HideSource setting is left in config
    // for compatibility but no longer controls the message-list column.
    res.locals.showsource = nconf.get('messages:ShowSource') === true;
    res.locals.apisecurity = nconf.get('messages:apiSecurity');
    res.locals.iconsize = nconf.get('messages:iconsize');
    res.locals.gaEnable = nconf.get('monitoring:gaEnable');
    res.locals.gaTrackingCode = nconf.get('monitoring:gaTrackingCode');
    res.locals.frontPopupEnable = nconf.get('global:frontPopupEnable');
    res.locals.frontPopupTitle = nconf.get('global:frontPopupTitle');
    res.locals.frontPopupContent = nconf.get('global:frontPopupContent');
    res.locals.searchLocation = nconf.get('global:searchLocation');
    res.locals.monitorName = nconf.get("global:monitorName");
    res.locals.faKey = nconf.get("global:faKey");
    // Templates show the system column and selector only when there is more
    // than one system, so a single-system install - which is every install
    // until an admin creates a second - renders exactly as it did before.
    // A failure here must not take the page down; an empty list simply hides
    // the column.
    systems.enabled()
        .then(rows => { res.locals.systems = rows; })
        .catch(() => { res.locals.systems = []; })
        .then(() => next());
});

/* GET home page. */
router.get('/', function (req, res, next) {
    if (nconf.get('messages:apiSecurity') && !req.isAuthenticated()) {
        req.flash('loginMessage', 'You need to be logged in to access this page');
        return res.redirect('/auth/login');
    }

    res.render('index', { pageTitle: 'Home' });
});

module.exports = router;
