class NotAuthorizedError extends Error {
        constructor(message, options) {
                super(message || 'You are not authorized to access this resource', options);

                // assign the error class name in your custom error (as a shortcut)
                this.name = this.constructor.name;
                this.status = 403;

                // capturing the stack trace keeps the reference to your error class
                Error.captureStackTrace(this, this.constructor);

                // you may also assign additional properties to your error
                this.isSleepy = true;
        }
}

class NotAuthenticatedError extends Error {
        constructor(message, options) {
                super(message || 'Not authorized', options);

                // assign the error class name in your custom error (as a shortcut)
                this.name = this.constructor.name;
                this.status = 401;

                // capturing the stack trace keeps the reference to your error class
                Error.captureStackTrace(this, this.constructor);

                // you may also assign additional properties to your error
                this.isSleepy = true;
        }
}

class InvalidRequestError extends Error {
        constructor(message, options) {
                super(message || 'Invalid request', options);

                // assign the error class name in your custom error (as a shortcut)
                this.name = this.constructor.name;
                this.status = 400;

                // capturing the stack trace keeps the reference to your error class
                Error.captureStackTrace(this, this.constructor);

                // you may also assign additional properties to your error
                this.isSleepy = true;
        }
}

module.exports = {
        NotAuthorizedError,
        NotAuthenticatedError,
        InvalidRequestError
};
