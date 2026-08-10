process.env.NODE_ENV = 'test';

const chai = require('chai');

const should = chai.should();
const chaiHttp = require('chai-http');

chai.use(chaiHttp);

const nconf = require('nconf');

const server = require('../app');
const db = require('../knex/knex.js');
const usertokens = require('../lib/usertokens');
const mailer = require('../mail/mailer');
const csrfAgent = require('./helpers/csrfAgent');

const confFile = './config/config.json';
nconf.file({ file: confFile });
nconf.load();

// The feature is gated on mailer.isConfigured(), which needs a site URL and a
// mail host. Rather than writing those into config.json (the suite shares one
// nconf singleton and one config file with every other test file), the sends
// are intercepted: mailer.send is replaced with a recorder and isConfigured is
// forced true. Both are restored afterwards.
const realSend = mailer.send;
const realIsConfigured = mailer.isConfigured;
let sentMail = [];

// The link in the email is the only place the raw token exists, so the tests
// read it back out of the recorded message exactly as a user would.
function tokenFromMail(message) {
    const match = /\/auth\/reset-password\/([A-Za-z0-9_-]+)/.exec(message.text);
    return match ? match[1] : null;
}

function verifyTokenFromMail(message) {
    const match = /\/auth\/verify-email\/([A-Za-z0-9_-]+)/.exec(message.text);
    return match ? match[1] : null;
}

let agent;
let csrfToken;

const recordMail = (conf, message) => {
    sentMail.push(message);
    return Promise.resolve({ messageId: 'test' });
};

// Wrapped in a describe so these hooks belong to this suite. At the top level
// of a file they would be ROOT hooks, and mocha runs those before every test
// in the whole run - the mailer stub and the site-url override would leak into
// every other spec file.
describe("self-service password reset", () => {
before(() => {
    mailer.isConfigured = () => true;
    mailer.send = recordMail;
});

after(() => {
    mailer.send = realSend;
    mailer.isConfigured = realIsConfigured;
    nconf.set('auth:passwordReset', false);
    nconf.set('global:siteUrl', '');
});

beforeEach(() => {
    sentMail = [];
    return db.migrate
        .rollback()
        .then(() => db.migrate.latest())
        .then(() => db.seed.run())
        // See the note in routes.auth.test.js - brute-knex creates `protection`
        // outside the migrations, so a rollback never clears the lockout counters.
        .then(() => db('protection').del().catch(() => {}))
        .then(() => {
            // Set after the migrations, not in before(). Several migration files
            // call nconf.file() at module scope, and knex only requires them when
            // migrate runs - that call swaps in a fresh store and discards
            // anything set in memory beforehand.
            nconf.set('auth:passwordReset', true);
            nconf.set('global:siteUrl', 'https://pagermon.test');
        })
        .then(() => csrfAgent(server))
        .then(result => {
            agent = result.agent;
            csrfToken = result.token;
        });
});

afterEach(() =>
    db.migrate.rollback().then(() => agent && agent.close()));

const post = path => agent.post(path).set('X-XSRF-TOKEN', csrfToken);

// Logging in regenerates the session (session fixation defence), which retires
// the old CSRF secret and issues a new cookie. A browser picks that up
// automatically; here the token has to be re-read, or every later POST in the
// test would send a stale one and be correctly rejected.
function loginAs(username, password) {
    return post('/auth/login')
        .send({ username: username, password: password })
        .then(res => {
            (res.headers['set-cookie'] || []).forEach(cookie => {
                const match = /^XSRF-TOKEN=([^;]*)/.exec(cookie);
                if (match) csrfToken = decodeURIComponent(match[1]);
            });
            return res;
        });
}

// The SPA's $resource calls send this, and it is what makes middleware answer
// with a 401 rather than a redirect to the login page.
const getJson = path => agent.get(path).set('Accept', 'application/json');

// Drives the flow up to the point of holding a valid token, which almost every
// test below needs.
function requestReset(email) {
    return post('/auth/forgot')
        .send({ email: email || 'none1@none.com' })
        .then(() => tokenFromMail(sentMail[0]));
}

describe('POST /auth/forgot', () => {
    it('should send a reset link to a registered address', () => {
        return post('/auth/forgot')
            .send({ email: 'none1@none.com' })
            .then(res => {
                res.status.should.eql(200);
                res.body.status.should.eql('ok');
                sentMail.length.should.eql(1);
                sentMail[0].to.should.eql('none1@none.com');
                should.exist(tokenFromMail(sentMail[0]));
            });
    });

    it('should build the link from the configured site URL, not the request host', () => {
        // A Host header an attacker controls must not end up in the email.
        return agent
            .post('/auth/forgot')
            .set('X-XSRF-TOKEN', csrfToken)
            .set('Host', 'evil.example.com')
            .send({ email: 'none1@none.com' })
            .then(() => {
                sentMail[0].text.should.contain('https://pagermon.test/auth/reset-password/');
                sentMail[0].text.should.not.contain('evil.example.com');
            });
    });

    it('should match the address case-insensitively', () => {
        return post('/auth/forgot')
            .send({ email: 'NONE1@None.com' })
            .then(res => {
                res.status.should.eql(200);
                sentMail.length.should.eql(1);
            });
    });

    // The three cases below must be indistinguishable from the success case, or
    // the endpoint becomes an account oracle.
    it('should answer identically for an unknown address', () => {
        let registered;
        return post('/auth/forgot')
            .send({ email: 'none1@none.com' })
            .then(res => {
                registered = res;
                sentMail = [];
                return post('/auth/forgot').send({ email: 'nobody@nowhere.com' });
            })
            .then(res => {
                res.status.should.eql(registered.status);
                JSON.stringify(res.body).should.eql(JSON.stringify(registered.body));
                sentMail.length.should.eql(0);
            });
    });

    it('should answer identically for a disabled account', () => {
        return post('/auth/forgot')
            .send({ email: 'none3@none.com' }) // admindisabled
            .then(res => {
                res.status.should.eql(200);
                res.body.status.should.eql('ok');
                sentMail.length.should.eql(0);
            });
    });

    it('should answer identically when sending the mail fails', () => {
        mailer.send = () => Promise.reject(new Error('smtp exploded'));
        return post('/auth/forgot')
            .send({ email: 'none1@none.com' })
            .then(res => {
                res.status.should.eql(200);
                res.body.status.should.eql('ok');
            })
            .then(() => {
                mailer.send = recordMail;
            });
    });

    it('should throttle repeated requests for the same account', () => {
        return post('/auth/forgot')
            .send({ email: 'none1@none.com' })
            .then(() => post('/auth/forgot').send({ email: 'none1@none.com' }))
            .then(res => {
                res.status.should.eql(200);
                // Same reply, but no second email - the per-account throttle is
                // what stops a distributed attempt mail-bombing one user, since
                // express-brute only keys on IP.
                sentMail.length.should.eql(1);
            });
    });

    it('should require an email address', () => {
        return post('/auth/forgot')
            .send({})
            .then(res => {
                res.status.should.eql(400);
            });
    });

    it('should lock out after too many attempts', function() {
        this.timeout(20000);
        // freeRetries is 5, and the 6th starts the wait timer rather than being
        // rejected itself, so the 7th is the first to actually see a 429.
        const attempt = n =>
            post('/auth/forgot')
                .send({ email: 'nobody' + n + '@nowhere.com' })
                .then(res => {
                    if (n <= 6) return attempt(n + 1);
                    res.status.should.eql(429);
                    res.body.status.should.eql('lockedout');
                    return null;
                });
        return attempt(1);
    });
});

describe('POST /auth/reset-password', () => {
    it('should set a new password with a valid token', () => {
        return requestReset()
            .then(token => post('/auth/reset-password').send({ token, password: 'a-brand-new-password' }))
            .then(res => {
                res.status.should.eql(200);
                res.body.status.should.eql('ok');
                // Deliberately not logged in - the redirect goes to the login page.
                res.body.redirect.should.eql('/auth/login');
                return db('users').where('username', 'useractive').first();
            })
            .then(user => {
                require('bcryptjs').compareSync('a-brand-new-password', user.password).should.eql(true);
            });
    });

    it('should notify the account owner that the password changed', () => {
        return requestReset()
            .then(token => post('/auth/reset-password').send({ token, password: 'a-brand-new-password' }))
            .then(() => {
                const notice = sentMail[sentMail.length - 1];
                notice.to.should.eql('none1@none.com');
                notice.subject.should.contain('password was changed');
            });
    });

    it('should reject a token the second time it is used', () => {
        let saved;
        return requestReset()
            .then(token => {
                saved = token;
                return post('/auth/reset-password').send({ token, password: 'a-brand-new-password' });
            })
            .then(() => post('/auth/reset-password').send({ token: saved, password: 'another-new-password' }))
            .then(res => {
                res.status.should.eql(400);
                res.body.error.should.eql('That reset link is invalid or has expired');
                return db('users').where('username', 'useractive').first();
            })
            .then(user => {
                // The first password must have survived the second attempt.
                require('bcryptjs').compareSync('a-brand-new-password', user.password).should.eql(true);
            });
    });

    it('should reject an expired token', () => {
        return requestReset()
            .then(token =>
                db('user_tokens')
                    .update({ expires: usertokens.nowSeconds() - 1 })
                    .then(() => post('/auth/reset-password').send({ token, password: 'a-brand-new-password' }))
            )
            .then(res => {
                res.status.should.eql(400);
                res.body.error.should.eql('That reset link is invalid or has expired');
            });
    });

    it('should reject a token that was never issued', () => {
        return post('/auth/reset-password')
            .send({ token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', password: 'a-brand-new-password' })
            .then(res => {
                res.status.should.eql(400);
                return db('users').where('username', 'useractive').first();
            })
            .then(user => {
                require('bcryptjs').compareSync('changeme', user.password).should.eql(true);
            });
    });

    it('should give the same message whether a token is unknown or expired', () => {
        let expiredResponse;
        return requestReset()
            .then(token =>
                db('user_tokens')
                    .update({ expires: usertokens.nowSeconds() - 1 })
                    .then(() => post('/auth/reset-password').send({ token, password: 'a-brand-new-password' }))
            )
            .then(res => {
                expiredResponse = res;
                return post('/auth/reset-password').send({ token: 'nope', password: 'a-brand-new-password' });
            })
            .then(res => {
                res.status.should.eql(expiredResponse.status);
                res.body.error.should.eql(expiredResponse.body.error);
            });
    });

    it('should invalidate an earlier token when a new one is issued', () => {
        let first;
        return requestReset()
            .then(token => {
                first = token;
                // Clear the per-account throttle so a second link can be issued.
                return db('user_tokens').update({ created: usertokens.nowSeconds() - 3600 });
            })
            .then(() => post('/auth/forgot').send({ email: 'none1@none.com' }))
            .then(() => post('/auth/reset-password').send({ token: first, password: 'a-brand-new-password' }))
            .then(res => {
                res.status.should.eql(400);
                // And the newest link still works.
                const latest = tokenFromMail(sentMail[sentMail.length - 1]);
                return post('/auth/reset-password').send({ token: latest, password: 'a-brand-new-password' });
            })
            .then(res => {
                res.status.should.eql(200);
            });
    });

    it('should refuse a token for an account disabled since it was issued', () => {
        return requestReset()
            .then(token =>
                db('users')
                    .where('username', 'useractive')
                    .update({ status: 'disabled' })
                    .then(() => post('/auth/reset-password').send({ token, password: 'a-brand-new-password' }))
            )
            .then(res => {
                res.status.should.eql(400);
            });
    });

    it('should enforce the password policy', () => {
        return requestReset()
            .then(token => post('/auth/reset-password').send({ token, password: 'short' }))
            .then(res => {
                res.status.should.eql(400);
                res.body.error.should.match(/at least 10 characters/);
            });
    });

    it('should not let a policy failure be retried with the same token', () => {
        // The token is spent even when the password is rejected, so a stolen link
        // cannot be used to hunt for an accepted password.
        let saved;
        return requestReset()
            .then(token => {
                saved = token;
                return post('/auth/reset-password').send({ token, password: 'short' });
            })
            .then(() => post('/auth/reset-password').send({ token: saved, password: 'a-brand-new-password' }))
            .then(res => {
                res.status.should.eql(400);
            });
    });

    it('should stamp pwchangedat so existing sessions are evicted', () => {
        return requestReset()
            .then(token => post('/auth/reset-password').send({ token, password: 'a-brand-new-password' }))
            .then(() => db('users').where('username', 'useractive').first())
            .then(user => {
                should.exist(user.pwchangedat);
                user.pwchangedat.should.be.above(0);
            });
    });

    it('should store only a hash of the token, never the token', () => {
        return requestReset().then(token =>
            db('user_tokens')
                .first()
                .then(row => {
                    row.tokenhash.should.not.eql(token);
                    row.tokenhash.length.should.eql(64);
                    JSON.stringify(row).should.not.contain(token);
                })
        );
    });
});

describe('GET /auth/reset-password/:token', () => {
    it('should keep the token out of referrers and caches', () => {
        return chai
            .request(server)
            .get('/auth/reset-password/sometoken')
            .then(res => {
                res.status.should.eql(200);
                res.headers['referrer-policy'].should.eql('no-referrer');
                res.headers['cache-control'].should.contain('no-store');
            });
    });
});

describe('Session invalidation after a password change', () => {
    it('should drop a session that predates the change', () => {
        // Log in for real so the session carries a pwstamp, then change the
        // password out from under it the way a reset would.
        return loginAs('useractive', 'changeme')
            .then(res => {
                res.status.should.eql(200);
                return getJson('/auth/profile/me');
            })
            .then(res => {
                res.status.should.eql(200);
                return db('users')
                    .where('username', 'useractive')
                    .update({ pwchangedat: usertokens.nowSeconds() + 10 });
            })
            .then(() => getJson('/auth/profile/me'))
            .then(res => {
                res.status.should.eql(401);
            });
    });

    it('should keep the session that made the change', () => {
        return loginAs('useractive', 'changeme')
            .then(() =>
                post('/auth/reset').send({
                    currentpassword: 'changeme',
                    password: 'a-brand-new-password',
                })
            )
            .then(res => {
                res.status.should.eql(200);
                return getJson('/auth/profile/me');
            })
            .then(res => {
                res.status.should.eql(200);
            });
    });
});

describe('Email change verification', () => {
    const login = () => loginAs('useractive', 'changeme');

    it('should not write the new address until it is confirmed', () => {
        return login()
            .then(() =>
                post('/auth/profile/me').send({
                    username: 'useractive',
                    givenname: 'Active',
                    surname: 'User',
                    email: 'newaddress@none.com',
                })
            )
            .then(res => {
                res.status.should.eql(200);
                res.body.emailPending.should.eql(true);
                return db('users').where('username', 'useractive').first();
            })
            .then(user => {
                user.email.should.eql('none1@none.com');
            });
    });

    it('should mail the new address and warn the old one', () => {
        return login()
            .then(() =>
                post('/auth/profile/me').send({
                    username: 'useractive',
                    givenname: 'Active',
                    email: 'newaddress@none.com',
                })
            )
            .then(() => {
                const recipients = sentMail.map(m => m.to);
                recipients.should.contain('newaddress@none.com');
                recipients.should.contain('none1@none.com');
            });
    });

    it('should commit the address once the token is redeemed', () => {
        return login()
            .then(() =>
                post('/auth/profile/me').send({
                    username: 'useractive',
                    givenname: 'Active',
                    email: 'newaddress@none.com',
                })
            )
            .then(() => {
                const confirmation = sentMail.filter(m => m.to === 'newaddress@none.com')[0];
                return post('/auth/verify-email').send({ token: verifyTokenFromMail(confirmation) });
            })
            .then(res => {
                res.status.should.eql(200);
                return db('users').where('username', 'useractive').first();
            })
            .then(user => {
                user.email.should.eql('newaddress@none.com');
            });
    });

    it('should refuse an address that another account already has', () => {
        return login()
            .then(() =>
                post('/auth/profile/me').send({
                    username: 'useractive',
                    givenname: 'Active',
                    email: 'none2@none.com', // adminactive
                })
            )
            .then(res => {
                res.status.should.eql(400);
                res.body.error.should.eql('That email address is already in use');
            });
    });

    it('should still save the other profile fields', () => {
        return login()
            .then(() =>
                post('/auth/profile/me').send({
                    username: 'useractive',
                    givenname: 'Renamed',
                    surname: 'Person',
                    email: 'newaddress@none.com',
                })
            )
            .then(() => db('users').where('username', 'useractive').first())
            .then(user => {
                user.givenname.should.eql('Renamed');
                user.surname.should.eql('Person');
            });
    });
});

describe('Token cleanup', () => {
    it('should remove used and expired tokens and keep live ones', () => {
        const now = usertokens.nowSeconds();
        return db('user_tokens')
            .insert([
                { userid: 2, purpose: 'password_reset', tokenhash: 'a'.repeat(64), expires: now + 600, created: now },
                { userid: 2, purpose: 'password_reset', tokenhash: 'b'.repeat(64), expires: now - 1, created: now - 700 },
                {
                    userid: 2,
                    purpose: 'password_reset',
                    tokenhash: 'c'.repeat(64),
                    expires: now + 600,
                    created: now,
                    usedat: now,
                },
            ])
            .then(() => require('../cron/tokenCleanup').purge(db))
            .then(deleted => {
                deleted.should.eql(2);
                return db('user_tokens').select('tokenhash');
            })
            .then(rows => {
                rows.length.should.eql(1);
                rows[0].tokenhash.should.eql('a'.repeat(64));
            });
    });
});
});
