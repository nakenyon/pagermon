const express = require('express');
const _ = require('underscore');

const db = require('../../knex/knex');
const authHelper = require('../../middleware/authhelper');
const logger = require('../../log');

const router = express.Router();

/**
 * @typedef Capcode
 * @property {Number} id The id of the capcode
 * @property {string} address The address of the capcode, can contain the wildcars _ and *
 * @property {string} alias The human readable alias of the capcode
 * @property {string} agency The agency this capcode belongs to
 * @property {string} color The color of the capcode, used for display in GUI
 * @property {string} icon The icon of the capcode, used for display in GUI
 * @property {number} ignore Wether to ignore messages belonging to this capcode - They won't be saved in the database
 * @property {Object} pluginconf The plugin configuration of the capcode - Contains a key for each plugin, holding the configuration for this plugin regarding this capcode
 * @property {boolean} onlyShowLoggedIn Whether messages of this capcode should only be shown to logged in users
 */

router.route('/capcodes')
        .get(authHelper.isAdmin, async function(req, res, next) {
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

/**
 * Returns a single capcode object from the database
 * @param {false|Object} filter If false, an empty capcode object is returned
 * @param {string} filter.id The id of the capcode
 * @param {string} filter.address The address of the capcode
 * @returns {Capcode} The capcode object, an empty one if nothing was found.
 */
async function getSingleCapcode(filter) {
        const defaults = {
                id: '',
                address: '',
                alias: '',
                agency: '',
                icon: 'question',
                color: 'black',
                ignore: 0,
                pluginconf: {},
                onlyShowLoggedIn: 0,
        };
        if (!filter) return defaults;

        const filterCleaned = _.pick(filter, ['id', 'address']);
        const capcode = await db
                .from('capcodes')
                .select('*')
                .where(filterCleaned)
                .first();

        if (!capcode) return defaults;

        capcode.pluginconf = parseJSON(capcode.pluginconf);
        return capcode;
}

router.route('/capcodes/:id').get(authHelper.isAdmin, async function(req, res, next) {
        const { id } = req.params;
        res.json(await getSingleCapcode(id === 'new' ? false : { id }));
});

router.route('/capcodeCheck/:address').get(authHelper.isAdmin, async function(req, res, next) {
        const { address } = req.params;
        res.json(await getSingleCapcode({ address }));
});

// TODO: Get it into a helpers library
/**
 * Parses a JSON string and returns the object or null
 * @param {string} json The JSON string to parse
 * @returns {Object|null} The parsed object or null if an error occurred
 */
function parseJSON(json) {
        try {
                return JSON.parse(json);
        } catch (error) {
                // ignore errors
                logger.main.error(`Error while parsing json ${json}: ${error.message}`);
        }
}

/**
 * Removes all empty objects from a plugin configuration
 * @param {Object} pconf An object containing a key for each Plugin, holding it's configuration
 * @returns A sanitized version of the plugin configuration object holding only plugins with values set
 */
function vaccumPluginConf(pconf) {
        const cleaned = _.pickBy(pconf, p => Object.keys(p).length > 0);
        return cleaned;
}

module.exports = router;
