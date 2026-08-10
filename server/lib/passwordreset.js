// Feature gate for self-service password reset.
//
// Two conditions, both required. The admin toggle is the deliberate opt-in; the
// mailer check is what stops the feature being switched on before it can work,
// which would otherwise present users with a form that silently does nothing.
// mailer.isConfigured() also covers the site URL, without which no usable link
// can be built - see lib/siteurl.js.

var nconfDefault = require('nconf');
var mailer = require('../mail/mailer');

var DEFAULT_TTL_MINUTES = 60;

function isEnabled(conf) {
    var source = conf || nconfDefault;
    return source.get('auth:passwordReset') === true && mailer.isConfigured(source);
}

// How long a reset link stays valid. Short enough that an old email in a mailbox
// is not a standing key to the account, long enough to survive greylisting and a
// user who reads mail on their phone an hour later.
function ttlMinutes(conf) {
    var source = conf || nconfDefault;
    var configured = Number(source.get('auth:passwordResetTTL'));
    if (!Number.isInteger(configured) || configured < 5 || configured > 1440) {
        return DEFAULT_TTL_MINUTES;
    }
    return configured;
}

function ttlSeconds(conf) {
    return ttlMinutes(conf) * 60;
}

module.exports = {
    isEnabled: isEnabled,
    ttlMinutes: ttlMinutes,
    ttlSeconds: ttlSeconds,
    DEFAULT_TTL_MINUTES: DEFAULT_TTL_MINUTES,
};
