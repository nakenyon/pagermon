process.env.NODE_ENV = 'test';

const chai = require('chai');

const should = chai.should();

// Require the app before anything that reaches for knex: on a fresh checkout
// (CI) config/config.json does not exist yet, and knexfile.js needs it to
// resolve the database client. app.js creates it from defaults on load. This
// file sorts first of all the specs, so it cannot rely on another having done
// it - see the same note in rotation.test.js.
require('../app');

const siteurl = require('../lib/siteurl');
const passwordpolicy = require('../lib/passwordpolicy');
const usertokens = require('../lib/usertokens');
const cookieoptions = require('../lib/cookieoptions');
const mailer = require('../mail/mailer');
const templates = require('../mail/templates');

// A stand-in for nconf: these modules take their config source as an argument
// precisely so they can be driven without touching the shared singleton or the
// on-disk config file.
function fakeConf(values) {
    return {
        get: key => {
            if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
            // Support both 'mail' and 'mail:host' style lookups.
            const parts = key.split(':');
            let node = values[parts[0]];
            for (let i = 1; i < parts.length && node; i += 1) node = node[parts[i]];
            return node;
        },
    };
}

describe('lib/siteurl', () => {
    afterEach(() => {
        delete process.env.PAGERMON_URL;
    });

    it('should return a configured https url', () => {
        siteurl.resolve(fakeConf({ 'global:siteUrl': 'https://pager.example.com' }))
            .should.eql('https://pager.example.com');
    });

    it('should strip a trailing slash', () => {
        siteurl.resolve(fakeConf({ 'global:siteUrl': 'https://pager.example.com/' }))
            .should.eql('https://pager.example.com');
    });

    it('should keep a path prefix for a sub-path deployment', () => {
        siteurl.resolve(fakeConf({ 'global:siteUrl': 'https://example.com/pager/' }))
            .should.eql('https://example.com/pager');
    });

    it('should accept a port', () => {
        siteurl.resolve(fakeConf({ 'global:siteUrl': 'http://192.168.1.30:3000' }))
            .should.eql('http://192.168.1.30:3000');
    });

    it('should let PAGERMON_URL win over the config', () => {
        process.env.PAGERMON_URL = 'https://from-env.example.com';
        siteurl.resolve(fakeConf({ 'global:siteUrl': 'https://from-config.example.com' }))
            .should.eql('https://from-env.example.com');
    });

    // Returning null is what keeps the reset feature switched off rather than
    // letting it build links that do not work - or, worse, letting a caller fall
    // back to the request's Host header.
    it('should return null when unset', () => {
        should.equal(siteurl.resolve(fakeConf({})), null);
        should.equal(siteurl.resolve(fakeConf({ 'global:siteUrl': '   ' })), null);
    });

    it('should return null without a scheme, rather than guessing one', () => {
        should.equal(siteurl.resolve(fakeConf({ 'global:siteUrl': 'pager.example.com' })), null);
    });

    it('should return null for a non-http scheme', () => {
        should.equal(siteurl.resolve(fakeConf({ 'global:siteUrl': 'javascript:alert(1)' })), null);
        should.equal(siteurl.resolve(fakeConf({ 'global:siteUrl': 'ftp://example.com' })), null);
    });

    it('should report https correctly', () => {
        siteurl.isHttps(fakeConf({ 'global:siteUrl': 'https://a.example.com' })).should.eql(true);
        siteurl.isHttps(fakeConf({ 'global:siteUrl': 'http://a.example.com' })).should.eql(false);
        siteurl.isHttps(fakeConf({})).should.eql(false);
    });

    it('should build absolute links', () => {
        const conf = fakeConf({ 'global:siteUrl': 'https://a.example.com' });
        siteurl.build('/auth/reset-password/abc', conf).should.eql('https://a.example.com/auth/reset-password/abc');
        siteurl.build('auth/x', conf).should.eql('https://a.example.com/auth/x');
        should.equal(siteurl.build('/auth/x', fakeConf({})), null);
    });
});

describe('lib/cookieoptions', () => {
    // The value is memoised so the session and CSRF cookies can never disagree,
    // so each case has to start from a clean slate.
    beforeEach(() => cookieoptions.reset());
    afterEach(() => {
        delete process.env.SECURE_COOKIES;
        cookieoptions.reset();
    });

    it('should follow the site url scheme by default', () => {
        cookieoptions.secure(fakeConf({ 'global:siteUrl': 'https://a.example.com' })).should.eql(true);
        cookieoptions.reset();
        cookieoptions.secure(fakeConf({ 'global:siteUrl': 'http://a.example.com' })).should.eql(false);
    });

    it('should let SECURE_COOKIES override in both directions', () => {
        process.env.SECURE_COOKIES = 'false';
        cookieoptions.secure(fakeConf({ 'global:siteUrl': 'https://a.example.com' })).should.eql(false);
        cookieoptions.reset();
        process.env.SECURE_COOKIES = 'true';
        cookieoptions.secure(fakeConf({ 'global:siteUrl': 'http://a.example.com' })).should.eql(true);
    });

    it('should not change once resolved', () => {
        cookieoptions.secure(fakeConf({ 'global:siteUrl': 'http://a.example.com' })).should.eql(false);
        // Changing the setting at runtime must not flip only one of the two
        // cookies - that combination breaks login and is hard to diagnose.
        cookieoptions.secure(fakeConf({ 'global:siteUrl': 'https://a.example.com' })).should.eql(false);
    });

    it('should always set httpOnly and sameSite', () => {
        const base = cookieoptions.base(fakeConf({}));
        base.httpOnly.should.eql(true);
        base.sameSite.should.eql('lax');
    });
});

describe('lib/passwordpolicy', () => {
    const conf = fakeConf({ 'auth:minPasswordLength': 10 });

    it('should accept a compliant password', () => {
        should.equal(passwordpolicy.validate('a-compliant-password', null, conf), null);
    });

    it('should reject an empty or missing password', () => {
        passwordpolicy.validate('', null, conf).should.match(/required/);
        passwordpolicy.validate(undefined, null, conf).should.match(/required/);
    });

    it('should enforce the minimum length', () => {
        passwordpolicy.validate('short', null, conf).should.match(/at least 10/);
    });

    it('should reject anything past bcrypt 72-byte truncation point', () => {
        // Beyond 72 bytes the tail does not contribute to the hash at all, so
        // accepting it would silently ignore part of what the user typed.
        passwordpolicy.validate('x'.repeat(73), null, conf).should.match(/72 bytes or fewer/);
    });

    it('should measure bytes, not characters', () => {
        // 30 four-byte emoji is 120 bytes but only 60 UTF-16 code units.
        passwordpolicy.validate('😀'.repeat(30), null, conf).should.match(/72 bytes or fewer/);
    });

    it('should reject a password equal to the username or email', () => {
        const user = { username: 'someusername', email: 'someone@example.com' };
        passwordpolicy.validate('someusername', user, conf).should.match(/username/);
        passwordpolicy.validate('SOMEONE@example.com', user, conf).should.match(/email/);
    });

    it('should fall back to a sane minimum for a missing or silly config', () => {
        passwordpolicy.minLength(fakeConf({})).should.eql(10);
        passwordpolicy.minLength(fakeConf({ 'auth:minPasswordLength': 2 })).should.eql(10);
        passwordpolicy.minLength(fakeConf({ 'auth:minPasswordLength': 14 })).should.eql(14);
    });
});

describe('mail/mailer', () => {
    it('should default the port from the transport mode', () => {
        mailer.config(fakeConf({ mail: { secure: true } })).port.should.eql(465);
        mailer.config(fakeConf({ mail: { secure: false } })).port.should.eql(587);
        mailer.config(fakeConf({ mail: { port: 2525 } })).port.should.eql(2525);
    });

    it('should require STARTTLS on the submission port unless told otherwise', () => {
        mailer.config(fakeConf({ mail: {} })).requireTLS.should.eql(true);
        mailer.config(fakeConf({ mail: { requireTLS: false } })).requireTLS.should.eql(false);
        // Meaningless when the connection is already encrypted.
        mailer.config(fakeConf({ mail: { secure: true } })).requireTLS.should.eql(false);
    });

    it('should verify certificates by default', () => {
        // Deliberately unlike plugins/SMTP.js, which disables this outright.
        mailer.config(fakeConf({ mail: {} })).rejectUnauthorized.should.eql(true);
        mailer.config(fakeConf({ mail: { rejectUnauthorized: false } })).rejectUnauthorized.should.eql(false);
    });

    it('should not consider itself configured without a site url', () => {
        const withoutUrl = fakeConf({
            mail: { enabled: true, host: 'smtp.example.com', fromAddress: 'a@example.com' },
        });
        mailer.isConfigured(withoutUrl).should.eql(false);
    });

    it('should be configured with mail settings and a site url', () => {
        const complete = fakeConf({
            'global:siteUrl': 'https://a.example.com',
            mail: { enabled: true, host: 'smtp.example.com', fromAddress: 'a@example.com' },
        });
        mailer.isConfigured(complete).should.eql(true);
    });

    it('should not be configured while disabled', () => {
        mailer
            .isConfigured(
                fakeConf({
                    'global:siteUrl': 'https://a.example.com',
                    mail: { enabled: false, host: 'smtp.example.com', fromAddress: 'a@example.com' },
                })
            )
            .should.eql(false);
    });

    it('should refuse to send when not enabled', () => {
        return mailer
            .send(fakeConf({ mail: {} }), { to: 'a@example.com', subject: 'x' })
            .then(() => Promise.reject(new Error('should not have resolved')))
            .catch(err => {
                err.message.should.match(/not enabled/);
            });
    });
});

describe('mail/templates', () => {
    const user = { username: 'someone', givenname: 'Someone', email: 'someone@example.com' };

    it('should include the link in both the text and html bodies', () => {
        const message = templates.passwordReset(user, 'https://a.example.com/auth/reset-password/tok', 60, 'PagerMon');
        message.text.should.contain('https://a.example.com/auth/reset-password/tok');
        message.html.should.contain('https://a.example.com/auth/reset-password/tok');
        message.text.should.contain('60 minutes');
    });

    it('should escape user-controlled values in html', () => {
        // givenname is whatever the user typed into their profile - unescaped it
        // would inject markup into a mail somebody else receives.
        const nasty = { username: '<script>alert(1)</script>', givenname: 'Bobby "><b>', email: 'x@y.z' };
        const message = templates.passwordReset(nasty, 'https://a/b', 60, 'PagerMon');
        message.html.should.not.contain('<script>');
        message.html.should.contain('&lt;script&gt;');
    });

    it('should tell the user what to do if a change was not theirs', () => {
        templates.passwordChanged(user, 'PagerMon').text.should.match(/administrator immediately/);
    });
});

describe('lib/usertokens', () => {
    const db = require('../knex/knex.js');

    beforeEach(() =>
        db.migrate
            .rollback()
            .then(() => db.migrate.latest())
            .then(() => db.seed.run()));

    afterEach(() => db.migrate.rollback());

    it('should return a token that is not what gets stored', () => {
        return usertokens.issue(db, 2, usertokens.PASSWORD_RESET, 600).then(issued => {
            issued.token.length.should.be.above(40);
            return db('user_tokens')
                .first()
                .then(row => {
                    row.tokenhash.should.not.eql(issued.token);
                    row.userid.should.eql(2);
                });
        });
    });

    it('should issue distinct tokens', () => {
        return usertokens
            .issue(db, 2, usertokens.PASSWORD_RESET, 600)
            .then(first =>
                usertokens
                    .issue(db, 3, usertokens.PASSWORD_RESET, 600)
                    .then(second => first.token.should.not.eql(second.token))
            );
    });

    it('should consume a valid token exactly once', () => {
        return usertokens.issue(db, 2, usertokens.PASSWORD_RESET, 600).then(issued =>
            usertokens
                .consume(db, usertokens.PASSWORD_RESET, issued.token)
                .then(result => {
                    result.ok.should.eql(true);
                    result.user.username.should.eql('useractive');
                    return usertokens.consume(db, usertokens.PASSWORD_RESET, issued.token);
                })
                .then(second => {
                    second.ok.should.eql(false);
                    second.reason.should.eql('already used');
                })
        );
    });

    it('should not accept a token issued for another purpose', () => {
        // Otherwise an email-confirmation link would double as a password reset.
        return usertokens.issue(db, 2, usertokens.EMAIL_CHANGE, 600, { payload: 'x@y.z' }).then(issued =>
            usertokens.consume(db, usertokens.PASSWORD_RESET, issued.token).then(result => {
                result.ok.should.eql(false);
            })
        );
    });

    it('should carry the payload through to redemption', () => {
        return usertokens.issue(db, 2, usertokens.EMAIL_CHANGE, 600, { payload: 'new@example.com' }).then(issued =>
            usertokens.consume(db, usertokens.EMAIL_CHANGE, issued.token).then(result => {
                result.ok.should.eql(true);
                result.row.payload.should.eql('new@example.com');
            })
        );
    });

    it('should reject an empty or non-string token without touching the database', () => {
        return usertokens
            .consume(db, usertokens.PASSWORD_RESET, '')
            .then(result => {
                result.ok.should.eql(false);
                return usertokens.consume(db, usertokens.PASSWORD_RESET, null);
            })
            .then(result => {
                result.ok.should.eql(false);
            });
    });

    it('should throttle a repeat request but not a spaced-out one', () => {
        return usertokens
            .issue(db, 2, usertokens.PASSWORD_RESET, 600, { throttleSeconds: 60 })
            .then(() => usertokens.issue(db, 2, usertokens.PASSWORD_RESET, 600, { throttleSeconds: 60 }))
            .then(second => {
                second.throttled.should.eql(true);
                return db('user_tokens').update({ created: usertokens.nowSeconds() - 120 });
            })
            .then(() => usertokens.issue(db, 2, usertokens.PASSWORD_RESET, 600, { throttleSeconds: 60 }))
            .then(third => {
                should.exist(third.token);
            });
    });

    it('should record the requesting ip for the audit trail', () => {
        return usertokens
            .issue(db, 2, usertokens.PASSWORD_RESET, 600, { ip: '203.0.113.9' })
            .then(() => db('user_tokens').first())
            .then(row => row.requestip.should.eql('203.0.113.9'));
    });
});
