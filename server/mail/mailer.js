// General-purpose transactional mailer, used for password reset and email-change
// verification.
//
// Separate from plugins/SMTP.js on purpose. That plugin is a per-capcode
// notification sender the admin may have disabled, and it sets
// tls.rejectUnauthorized: false unconditionally - meaning it will happily hand
// credentials and message content to whatever answers on the configured host.
// That is not an acceptable basis for account recovery, so this module verifies
// certificates by default and only turns that off if the admin explicitly asks.
//
// Config is read at call time, not at require time, so changes made in the admin
// settings UI take effect without a restart (admin saves call nconf.load() on the
// shared singleton). nconf is injected for testability, following the pattern in
// cron/messageRotation.js.

var nodemailer = require('nodemailer');
var nconfDefault = require('nconf');
var logger = require('../log');
var siteurl = require('../lib/siteurl');

function config(conf) {
    var source = conf || nconfDefault;
    var mail = source.get('mail') || {};
    var secure = mail.secure === true;

    return {
        enabled: mail.enabled === true,
        host: (mail.host || '').trim(),
        // Implicit TLS is 465, submission with STARTTLS is 587.
        port: Number(mail.port) || (secure ? 465 : 587),
        secure: secure,
        // On 587 the connection starts in the clear and upgrades. Without
        // requireTLS a server that does not offer STARTTLS gets the mail in
        // plaintext instead of an error, so this defaults on.
        requireTLS: secure ? false : mail.requireTLS !== false,
        rejectUnauthorized: mail.rejectUnauthorized !== false,
        username: mail.username || '',
        password: mail.password || '',
        fromAddress: (mail.fromAddress || '').trim(),
        fromName: mail.fromName || 'PagerMon',
    };
}

// True when mail can actually be sent AND an absolute link can be built for it.
// The site URL is part of this check because a reset email without a working
// link is useless, and guessing the link from the request would be host-header
// injection - see lib/siteurl.js.
function isConfigured(conf) {
    var c = config(conf);
    return c.enabled && !!c.host && !!c.fromAddress && siteurl.resolve(conf) !== null;
}

function transport(conf) {
    var c = config(conf);
    var options = {
        host: c.host,
        port: c.port,
        secure: c.secure,
        requireTLS: c.requireTLS,
        tls: { rejectUnauthorized: c.rejectUnauthorized },
    };
    // An unauthenticated relay is legitimate on an internal network; passing
    // empty credentials makes nodemailer attempt AUTH and fail.
    if (c.username) {
        options.auth = { user: c.username, pass: c.password };
    }
    return nodemailer.createTransport(options);
}

// Checks connectivity, TLS and credentials without sending anything. Backs the
// admin "Send test email" button so misconfiguration is diagnosable from the UI
// rather than from container logs.
function verify(conf) {
    var c = config(conf);
    if (!c.host) return Promise.reject(new Error('No mail server configured'));
    if (!c.fromAddress) return Promise.reject(new Error('No from address configured'));
    return transport(conf).verify();
}

// Resolves on success and rejects on failure. Callers on the reset path must
// swallow the rejection: whether mail was delivered is not something an
// unauthenticated caller should be able to observe.
function send(conf, message) {
    var c = config(conf);

    if (!c.enabled) return Promise.reject(new Error('Mail is not enabled'));
    if (!c.host || !c.fromAddress) return Promise.reject(new Error('Mail is not configured'));
    if (!message || !message.to) return Promise.reject(new Error('No recipient'));

    return transport(conf)
        .sendMail({
            from: '"' + c.fromName + '" <' + c.fromAddress + '>',
            to: message.to,
            subject: message.subject,
            text: message.text,
            html: message.html,
        })
        .then(function (info) {
            logger.main.info('Mail: sent "' + message.subject + '" (' + info.messageId + ')');
            return info;
        });
}

module.exports = { isConfigured: isConfigured, verify: verify, send: send, config: config };
