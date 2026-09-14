var express = require('express');
var bodyParser = require('body-parser');
var router = express.Router();
var bcrypt = require('bcryptjs');
var fs = require('fs');
var logger = require('../log');
var util = require('util');
var passport = require('../auth/local'); // pass passport for configuration
const authHelper = require('../middleware/authhelper')
const healthConfig = require('../lib/readerhealthconfig');
const readerHealth = require('../lib/readerhealth');
const db = require('../knex/knex');
const csrf = require('../middleware/csrf');
router.use(csrf.issue);

function healthCsrf(req, res, next) {
    const h = healthConfig.health({ readerHealth: nconf.get('readerHealth') });
    if ((req.body && req.body.readerHealth) || h.monitors.length || h.destinations.length) return csrf.verify(req, res, next);
    next();
}

function sessionAdmin(req, res, next) {
    if (req.isAuthenticated() && req.user && req.user.role === 'admin' && !req.readerKeyId) return next();
    return res.status(403).json({ error: 'An administrator session is required' });
}

router.use(function (req, res, next) {
    res.locals.login = req.isAuthenticated();
    res.locals.user = req.user;
    res.locals.monitorName = nconf.get("global:monitorName");
    next();
});

var nconf = require('nconf');
var confFile = './config/config.json';
var conf_backup = './config/backup.json';

nconf.file({ file: confFile });
nconf.load();

router.use(bodyParser.json());       // to support JSON-encoded bodies
router.use(bodyParser.urlencoded({     // to support URL-encoded bodies
    extended: true
}));

router.route('/settingsData')
    .get(authHelper.isAdmin, function (req, res, next) {
        nconf.load();
        let settings = healthConfig.publicSettings(nconf.get(), req.isAuthenticated() && req.user.role === 'admin');
        // logger.main.debug(util.format('Config:\n\n%o',settings));
        let plugins = [];
        fs.readdirSync('./plugins').forEach(file => {
            if (file.endsWith('.json')) {
                let pConf = require(`../plugins/${file}`);
                if (!pConf.disable)
                    plugins.push(pConf);
            }
        });
        // A directory under ./themes is only selectable if it can actually be
        // rendered, i.e. it has a views/ dir. This filters out ./themes/_shared,
        // which holds assets common to every theme rather than a theme itself.
        let themes = [];
        fs.readdirSync('./themes').forEach(file => {
            if (fs.existsSync(`./themes/${file}/views`))
                themes.push(file)
        });
        // logger.main.debug(util.format('Plugin Config:\n\n%o',plugins));
        let data = { "settings": settings, "plugins": plugins, "themes": themes }
        res.json(data);
    })
    .post(authHelper.isAdmin, healthCsrf, async function (req, res, next) {
        nconf.load();
        const previous = JSON.parse(JSON.stringify(nconf.get()));
        const h = healthConfig.health(previous);
        // Legacy API-key settings clients may still save unrelated configuration
        // on installs without health monitoring. They cannot enable, change or
        // erase monitoring (including by omitting the protected section).
        if ((!req.isAuthenticated() || req.user.role !== 'admin') &&
            ((req.body && req.body.readerHealth) || h.monitors.length || h.destinations.length)) {
            return res.status(403).json({ error: 'An administrator session is required for reader health settings' });
        }
        let settings;
        try {
            settings = await healthConfig.prepare(req.body, previous, db);
        } catch (err) {
            return res.status(400).json({ error: err.readerHealthValidation ? err.message : 'Invalid settings or unavailable database' });
        }
        try {
            fs.writeFileSync(conf_backup, JSON.stringify(previous, null, 2), { mode: 0o600 });
            fs.chmodSync(conf_backup, 0o600);
            // Docker's config.json is a symlink into /data. Replace its TARGET,
            // never the symlink, or settings disappear on container recreation.
            const target = fs.realpathSync(confFile);
            fs.writeFileSync(target + '.tmp', JSON.stringify(settings, null, 2), { mode: 0o600 });
            fs.renameSync(target + '.tmp', target);
            nconf.load();
            await readerHealth.instance().sync();
            res.status(200).json({ status: 'ok', settings: healthConfig.publicSettings(settings, true) });
        } catch (err) {
            readerHealth.instance().reportError();
            res.status(500).json({ error: 'Could not finish saving settings; configuration may have been saved. Check database/config permissions and reload.' });
        }
    });

router.get('/readerHealth', sessionAdmin, async function (req, res) {
    res.json(await readerHealth.instance().status());
});

// Small process-local rate limit prevents accidental button double-clicks or
// repeated requests from flooding selected recipients. No state is changed.
let lastHealthTest = 0;
router.post('/readerHealth/test', sessionAdmin, csrf.verify, async function (req, res) {
    if (Date.now() - lastHealthTest < 10000) return res.status(429).json({ error: 'Wait ten seconds between tests' });
    lastHealthTest = Date.now();
    try {
        await readerHealth.instance().test(req.body.destinationId);
        res.json({ status: 'ok' });
    } catch (_) {
        res.status(400).json({ error: 'Test failed; save settings and check recipients, credentials and connectivity' });
    }
});

// Validates the mail settings and sends a real message to the calling admin.
// Without this, the first sign that SMTP is misconfigured is a user reporting a
// reset email that never arrived - and the actual error would only be visible in
// the container log.
router.route('/mailTest').post(authHelper.isAdmin, function (req, res) {
    nconf.load();
    var mailer = require('../mail/mailer');
    var siteurl = require('../lib/siteurl');

    var to = (req.body && req.body.to) || (req.user && req.user.email);
    if (!to) {
        return res.status(400).send({ status: 'failed', error: 'No address to send to' });
    }

    var site = siteurl.resolve(nconf);
    // Reported as a warning rather than an error: mail can be working perfectly
    // while the links inside it are unbuildable, and that is worth knowing before
    // switching password reset on.
    var warning = site ? null : 'Mail works, but no Site URL is set - reset links cannot be built yet';

    return mailer
        .verify(nconf)
        .then(function () {
            return mailer.send(nconf, {
                to: to,
                subject: (nconf.get('global:monitorName') || 'PagerMon') + ' - test email',
                text: 'This is a test email from PagerMon. If you received it, outbound mail is working.',
                html: '<p>This is a test email from PagerMon. If you received it, outbound mail is working.</p>',
            });
        })
        .then(function () {
            logger.main.info('Mail: test email sent to ' + to);
            res.status(200).send({ status: 'ok', sentTo: to, warning: warning });
        })
        .catch(function (err) {
            logger.main.error('Mail: test failed: ' + err.message);
            // The SMTP error is passed through deliberately - this endpoint is
            // admin-only and the message is the whole point of the button.
            res.status(400).send({ status: 'failed', error: err.message });
        });
});

router.get('*', authHelper.isAdminGUI, function (req, res, next) {
    res.render('admin', { pageTitle: 'Admin' });
});

module.exports = router;
