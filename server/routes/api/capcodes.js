const express = require('express');

const db = require('../../knex/knex');
const authHelper = require('../../middleware/authhelper');
const logger = require('../../log');

const router = express.Router();

router.route('/capcodes').get(authHelper.isAdmin, async function(req, res, next) {
        const capcodes = await db
                .from('capcodes')
                .select('*')
                .orderByRaw(`REPLACE(??, ?, ?)`, ['address', '_', '%']);

        res.json(capcodes);
});

// TODO: Should maybe better be an individual route
router.route('/capcodes/agency').get(authHelper.isAdmin, async function(req, res, next) {
        const agencies = await db.from('capcodes').distinct('agency');
        res.json(agencies);
});

router.route('/capcodes/agency/:agency').get(authHelper.isAdmin, async function(req, res) {
        const { agency } = req.params;
        const capcodes = (
                await db
                        .from('capcodes')
                        .select('*')
                        .where({ agency })
        ).map(capcode => {
                capcode.pluginconf = parseJSON(capcode.pluginconf);
                return capcode;
        });
        res.json(capcodes);
});

router.route('/capcodes/:id').get(authHelper.isAdmin, async function(req, res, next) {
        const { id } = req.params;
        const defaults = {
                id: '',
                address: '',
                alias: '',
                agency: '',
                icon: 'question',
                color: 'black',
                ignore: 0,
                pluginconf: {},
                onlyShowLoggedIn: false,
        };
        if (id === 'new') {
                return res.json(defaults);
        }
        const capcode = await db
                .from('capcodes')
                .select('*')
                .where({ id })
                .first();

        if (!capcode) {
                // TODO: I think this should be a 404, but the old code returns 200
                return res.status(200).json({
                        id: '',
                        address: '',
                        alias: '',
                        agency: '',
                        icon: 'question',
                        color: 'black',
                        ignore: 0,
                        pluginconf: {},
                        onlyShowLoggedIn: false,
                });
        }

        capcode.pluginconf = parseJSON(capcode.pluginconf);
        res.json(capcode);
});

// TODO: Get it into a helpers library
function parseJSON(json) {
        try {
                return JSON.parse(json);
        } catch (error) {
                // ignore errors
                logger.main.error(`Error while parsing json ${json}: ${error.message}`);
        }
}

module.exports = router;
