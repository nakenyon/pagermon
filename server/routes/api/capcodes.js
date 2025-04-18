const express = require('express');

const db = require('../../knex/knex');
const authHelper = require('../../middleware/authhelper');

const router = express.Router();

router.route('/capcodes').get(authHelper.isAdmin, async function(req, res, next) {
        const capcodes = await db
                .from('capcodes')
                .select('*')
                .orderByRaw(`REPLACE(??, ?, ?)`, ['address', '_', '%']);

        res.json(capcodes);
});

module.exports = router;
