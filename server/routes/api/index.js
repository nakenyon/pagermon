const express = require('express');

const messageRouter = require('./messages');

const router = express.Router();

router.use(function(req, res, next) {
        res.locals.login = req.isAuthenticated();
        res.locals.user = req.user || false;
        next();
});

router.use(messageRouter);

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
