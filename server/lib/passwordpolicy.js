// Shared password rules, applied everywhere a password is set: self
// registration, the logged-in change form, the emailed reset flow, and the admin
// user create/update endpoints. Previously each of those did its own ad-hoc
// check (or none), so a password rejected in one place was accepted in another.

var nconf = require('nconf');

// bcrypt only hashes the first 72 bytes of input; anything past that silently
// does not contribute to the hash. Rejecting long inputs outright is clearer
// than accepting a password whose tail is ignored, and also stops a
// multi-megabyte body burning CPU in the KDF.
var MAX_LENGTH = 72;
var DEFAULT_MIN_LENGTH = 10;

function minLength(conf) {
    var source = conf || nconf;
    var configured = Number(source.get('auth:minPasswordLength'));
    if (!Number.isInteger(configured) || configured < 8) return DEFAULT_MIN_LENGTH;
    return configured;
}

// Returns null when acceptable, or a user-facing message explaining why not.
// `user` is optional and only used for the similarity checks.
function validate(password, user, conf) {
    var min = minLength(conf);

    if (typeof password !== 'string' || !password.length) {
        return 'Password is required';
    }
    // Byte length, not character length - a password of emoji is well under 72
    // characters but can exceed 72 bytes.
    if (Buffer.byteLength(password, 'utf8') > MAX_LENGTH) {
        return 'Password must be ' + MAX_LENGTH + ' bytes or fewer';
    }
    if (password.length < min) {
        return 'Password must be at least ' + min + ' characters';
    }
    if (user) {
        var lower = password.toLowerCase();
        if (user.username && lower === String(user.username).toLowerCase()) {
            return 'Password must not be the same as your username';
        }
        if (user.email && lower === String(user.email).toLowerCase()) {
            return 'Password must not be the same as your email address';
        }
    }
    return null;
}

module.exports = { validate: validate, minLength: minLength, MAX_LENGTH: MAX_LENGTH };
