const express = require('express');

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
        var output = {
                error: {
                        name: err.name,
                        message: err.message,
                        text: err.toString(),
                },
        };
        var statusCode = err.status || 500;
        res.status(statusCode).json(output);
}
router.use(handleError);

module.exports = router;
