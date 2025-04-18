const express = require('express');
const logger = require('../../log');

const messagesRouter = require('./messages');
const capcodesRouter = require('./capcodes');

const router = express.Router();

router.use(function(req, res, next) {
        res.locals.login = req.isAuthenticated();
        res.locals.user = req.user || false;
        next();
});

router.use(messagesRouter);
router.use(capcodesRouter);

function handleError(err, req, res, next) {
        logger.main.error(err);

        // Write errors to the console in test mode, if they don't have a status -> Are not willingly sent by us.
        if (process.env.NODE_ENV === 'test' && !err.status) console.log(err.message);
        const output = {
                error: {
                        name: err.name,
                        message: err.message,
                        text: err.toString(),
                },
        };
        const statusCode = err.status || 500;
        res.status(statusCode).json(output);
}
router.use(handleError);

module.exports = router;
