const express = require('express');
const bodyParser = require('body-parser');

const router = express.Router();
const fs = require('fs');
var nconf = require('nconf');
const authHelper = require('../middleware/authhelper');

router.use((req, res, next) => {
    res.locals.login = req.isAuthenticated();
    res.locals.user = req.user;
    res.locals.monitorName = nconf.get('global:monitorName');
    next();
});

const configFile = './config/config.json';
const configBackup = './config/backup.json';

nconf.file({ file: configFile });
nconf.load();

router.use(bodyParser.json()); // to support JSON-encoded bodies
router.use(
    bodyParser.urlencoded({
        // to support URL-encoded bodies
        extended: true,
    })
);

router
    .route('/settingsData')
    .get(authHelper.isAdmin, (req, res) => {
        nconf.load();
        const settings = nconf.get();
        // logger.main.debug(util.format('Config:\n\n%o',settings));
        const plugins = [];
        fs.readdirSync('./plugins').forEach((file) => {
            if (file.endsWith('.json')) {
                // eslint-disable-next-line import/no-dynamic-require, global-require
                const pConf = require(`../plugins/${file}`);
                if (!pConf.disable) plugins.push(pConf);
            }
        });
        const themes = [];
        fs.readdirSync('./themes').forEach((file) => {
            themes.push(file);
        });
        // logger.main.debug(util.format('Plugin Config:\n\n%o',plugins));
        const data = { settings, plugins, themes };
        res.json(data);
    })
    .post(authHelper.isAdmin, (req, res) => {
        nconf.load();
        if (req.body) {
            // console.log(req.body);
            const currentConfig = nconf.get();
            fs.writeFileSync(configBackup, JSON.stringify(currentConfig, null, 2));
            fs.writeFileSync(configFile, JSON.stringify(req.body, null, 2));
            nconf.load();
            res.status(200).send({ status: 'ok' });
        } else {
            res.status(400).send({ error: 'request body empty' });
        }
    });

router.get('*', authHelper.isAdminGUI, (req, res) => {
    res.render('admin', { pageTitle: 'Admin' });
});

module.exports = router;
