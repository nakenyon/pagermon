// knex middleware for API error Handling
function handleError(err, req, res, next) {
    var output = {
      error: {
        name: err.name,
        message: err.message,
        text: err.toString()
      }
    };
    var statusCode = err.status || 500;
    res.status(statusCode).json(output);
  }

  module.exports = handleError;