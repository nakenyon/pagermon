process.env.NODE_ENV = 'test';

const chai = require('chai');

const should = chai.should();
const chaiHttp = require('chai-http');

chai.use(chaiHttp);

const confFile = './config/config.json';
// load the config file
const nconf = require('nconf');

const server = require('../app');
const db = require('../knex/knex.js');
// This needs to be sorted out, use a different config file when testing?
const passportStub = require('passport-stub');

passportStub.install(server);

nconf.file({ file: confFile });
nconf.load();
// set required settings in config file

const csrfAgent = require('./helpers/csrfAgent');

// Every state-changing /auth request needs a session-bound CSRF token, so these
// are set up per test and used through post() below rather than a bare
// chai.request().
let agent;
let csrfToken;

beforeEach(() =>
        db.migrate
                .rollback()
                .then(() => db.migrate.latest())
                .then(() => db.seed.run())
                // express-brute keeps its lockout counters in the `protection` table,
                // which brute-knex creates itself rather than via a knex migration - so
                // the rollback above never clears it. Every test file shares one mocha
                // process and one source IP, so without this the counter accumulates
                // across the whole run and unrelated tests start getting 429s.
                .then(() => db('protection').del().catch(() => {}))
                .then(() => csrfAgent(server))
                .then(result => {
                        agent = result.agent;
                        csrfToken = result.token;
                }));

afterEach(() =>
        db.migrate
                .rollback()
                .then(() => passportStub.logout())
                .then(() => agent && agent.close()));

// Stands in for `chai.request(server).post(...)` - same chain, but through the
// session-carrying agent and with the CSRF token attached.
const post = path => agent.post(path).set('X-XSRF-TOKEN', csrfToken);

describe('GET /auth/login', () => {
        it('should return the login page', done => {
                chai.request(server)
                        .get('/auth/login')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                res.type.should.eql('text/html');
                                done();
                        });
        });
        it('should return the index if a user is logged in', done => {
                passportStub.login({
                        username: 'useractive',
                        password: 'changeme',
                });
                chai.request(server)
                        .get('/auth/login')
                        .redirects(0)
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(302);
                                res.should.redirectTo('/');
                                done();
                        });
        });
});

describe('POST /auth/login', () => {
        it('should log the user in if correct credentials are provided', done => {
                post('/auth/login')
                        .send({
                                username: 'useractive',
                                password: 'changeme',
                        })
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                res.body.status.should.eql('ok');
                                res.body.redirect.should.eql('/');
                                done();
                        });
        });
        it('should log the admin in if correct credentials are provided', done => {
                post('/auth/login')
                        .send({
                                username: 'adminactive',
                                password: 'changeme',
                        })
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                res.body.status.should.eql('ok');
                                res.body.redirect.should.eql('/admin');
                                done();
                        });
        });
        it('should not login on invalid username', done => {
                post('/auth/login')
                        .send({
                                username: 'notarealuser',
                                password: 'changeme',
                        })
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(401);
                                res.body.status.should.eql('failed');
                                res.body.error.should.eql('Check Details and try again');
                                done();
                        });
        });
        it('should not login on invalid password', done => {
                post('/auth/login')
                        .send({
                                username: 'useractive',
                                password: 'changeme2',
                        })
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(401);
                                res.body.status.should.eql('failed');
                                res.body.error.should.eql('Check Details and try again');
                                done();
                        });
        });
        it('should not login when user is disabled', done => {
                post('/auth/login')
                        .send({
                                username: 'admindisabled',
                                password: 'changeme',
                        })
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(401);
                                res.body.status.should.eql('failed');
                                res.body.error.should.eql('User Disabled');
                                done();
                        });
        });
        it('should return a 429 with too many invalid attempts', done => {
                // routes/auth.js sets freeRetries: 5, so the 6th attempt is the one that
                // locks out. This previously made only 2 attempts and passed solely
                // because the brute-force counter was still polluted by earlier tests in
                // the run; now that the counter starts clean it has to trip the limit on
                // its own.
                // The 6th request is the one that starts the minWait timer rather than
                // being rejected itself, so the 7th - arriving immediately, inside that
                // wait - is the first to actually get a 429.
                const ATTEMPTS_BEFORE_LOCKOUT = 6;
                const attempt = n => {
                        post('/auth/login')
                                .send({
                                        username: 'admindisabled',
                                        password: 'changeme',
                                })
                                .end((err, res) => {
                                        if (n <= ATTEMPTS_BEFORE_LOCKOUT) {
                                                return attempt(n + 1);
                                        }
                                        res.status.should.eql(429);
                                        res.body.status.should.eql('lockedout');
                                        res.body.error.should.eql('Too many attempts, please try again later');
                                        return done();
                                });
                };
                attempt(1);
        });
});

describe('GET /auth/logout', () => {
        it('should log the user out', done => {
                passportStub.login({
                        username: 'useractive',
                        password: 'changeme',
                });
                chai.request(server)
                        .get('/auth/logout')
                        .redirects(0)
                        .end((err, res) => {
                                should.not.exist(err);
                                res.should.redirectTo('/');
                                done();
                        });
        });
});

describe('GET /auth/profile', () => {
        it('should return the profile page if user is logged in', done => {
                passportStub.login({
                        username: 'useractive',
                        password: 'changeme',
                });
                chai.request(server)
                        .get('/auth/profile')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                res.type.should.eql('text/html');
                                done();
                        });
        });
        it('should return an error if not logged in ', done => {
                chai.request(server)
                        .get('/auth/profile')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(401);
                                done();
                        });
        });
});

describe('GET /auth/profile/:id', () => {
        it('should return the information of the logged in user', done => {
                passportStub.login({
                        username: 'useractive',
                        password: 'changeme',
                });
                chai.request(server)
                        .get('/auth/profile/1')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.should.be.json;
                                res.body.should.be.a('object');
                                res.body.should.have.property('id');
                                res.body.id.should.equal(2);
                                res.body.should.have.property('givenname');
                                res.body.givenname.should.equal('Active');
                                res.body.should.have.property('surname');
                                res.body.surname.should.equal('User');
                                res.body.should.have.property('username');
                                res.body.username.should.equal('useractive');
                                res.body.should.have.property('email');
                                res.body.email.should.equal('none1@none.com');
                                done();
                        });
        });
        it('should not return the information of other users', done => {
                passportStub.login({
                        username: 'useractive',
                        password: 'changeme',
                });
                chai.request(server)
                        .get('/auth/profile/2')
                        .send({ 'user.username': 'adminactive' })
                        .end((err, res) => {
                                should.not.exist(err);
                                res.should.be.json;
                                res.body.should.be.a('object');
                                res.body.should.have.property('id');
                                res.body.id.should.equal(2);
                                res.body.should.have.property('givenname');
                                res.body.givenname.should.equal('Active');
                                res.body.should.have.property('surname');
                                res.body.surname.should.equal('User');
                                res.body.should.have.property('username');
                                res.body.username.should.equal('useractive');
                                res.body.should.have.property('email');
                                res.body.email.should.equal('none1@none.com');
                                done();
                        });
        });
        it('should not return anything if no user is logged in', done => {
                chai.request(server)
                        .get('/auth/profile/2')
                        .send({ 'user.username': 'adminactive' })
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(401);
                                done();
                        });
        });
});

describe('POST /auth/profile/:id', () => {
        it('should save the information of the logged in user', done => {
                passportStub.login({
                        username: 'useractive',
                        password: 'changeme',
                });
                post('/auth/profile/1')
                        .send({
                                username: 'useractive',
                                givenname: 'User',
                                surname: 'Active',
                                email: 'none1@none1.com',
                        })
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                res.body.status.should.eql('ok');
                                // Previously asserted `id === 1`, which was knex's
                                // affected-row count rather than a user id - useractive is
                                // actually id 2. Check the write instead of the echo.
                                db('users')
                                        .where('username', 'useractive')
                                        .first()
                                        .then(user => {
                                                res.body.id.should.eql(user.id);
                                                user.surname.should.eql('Active');
                                                done();
                                        })
                                        .catch(done);
                        });
        });
        it('should not allow saving of other users information', done => {
                passportStub.login({
                        username: 'useractive',
                        password: 'changeme',
                });
                post('/auth/profile/1')
                        .send({
                                username: 'adminactive',
                                givenname: 'Admin',
                                surname: 'Active',
                                email: 'none2@none2.com',
                        })
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(401);
                                res.body.message.should.eql('Please update your own details only');
                                done();
                        });
        });
        it('should not allow saving of invalid information', done => {
                passportStub.login({
                        username: 'useractive',
                        password: 'changeme',
                });
                post('/auth/profile/1')
                        .send({
                                username: 'useractive',
                                givenname: 'User',
                                surname: 'Active',
                                email: null,
                        })
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(400);
                                done();
                        });
        });
        it('should not allow saving of information if no user is logged in ', done => {
                post('/auth/profile/1')
                        .send({
                                username: 'adminactive',
                                givenname: 'Admin',
                                surname: 'Active',
                                email: 'none2@none2.com',
                        })
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(401);
                                done();
                        });
        });
});

describe('GET /auth/register', () => {
        nconf.set('auth:registration', true);
        nconf.save();
        it('should return the registration page if enabled', done => {
                chai.request(server)
                        .get('/auth/register')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                res.type.should.eql('text/html');
                                done();
                        });
        });

        it('should return the index if disabled', done => {
                nconf.set('auth:registration', false);
                nconf.save();
                chai.request(server)
                        .get('/auth/register')
                        .redirects(0)
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(302);
                                res.should.redirectTo('/');
                                done();
                        });
        });
});

describe('POST /auth/register', () => {
        it('should register a new user', done => {
                nconf.set('auth:registration', true);
                nconf.save();
                post('/auth/register')
                        .send({
                                username: 'test',
                                password: '$2a$08$De/aXnQkZIEbQ9p8J22tHuzLltqIbsAxE2CGgRMPLaaIwwHmVrpsu',
                                givenname: 'Test',
                                surname: 'User',
                                email: 'Test@test.com',
                        })
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                res.type.should.eql('application/json');
                                res.body.status.should.eql('ok');
                                done();
                        });
        });
        it('should not register a duplicate user', done => {
                post('/auth/register')
                        .send({
                                username: 'adminactive',
                                password: '$2a$08$De/aXnQkZIEbQ9p8J22tHuzLltqIbsAxE2CGgRMPLaaIwwHmVrpsu',
                                givenname: 'Admin',
                                surname: 'User',
                                email: 'Test@test.com',
                        })
                        .end((err, res) => {
                                res.status.should.eql(401);
                                res.type.should.eql('application/json');
                                res.body.error.should.eql('access denied');
                                done();
                        });
        });
        it('should not allow registration when registration is disabled in config', done => {
                nconf.set('auth:registration', false);
                nconf.save();
                post('/auth/register')
                        .send({
                                username: 'test',
                                password: '$2a$08$De/aXnQkZIEbQ9p8J22tHuzLltqIbsAxE2CGgRMPLaaIwwHmVrpsu',
                                givenname: 'Admin',
                                surname: 'User',
                                email: 'Test@test.com',
                        })
                        .end((err, res) => {
                                res.status.should.eql(400);
                                res.type.should.eql('application/json');
                                res.body.error.should.eql('registration disabled');
                                done();
                        });
        });
        it('should not register a user with invalid data', done => {
                nconf.set('auth:registration', true);
                nconf.save();
                post('/auth/register')
                        .send({
                                username: 'testuser3',
                                password: '$2a$08$De/aXnQkZIEbQ9p8J22tHuzLltqIbsAxE2CGgRMPLaaIwwHmVrpsu',
                                givenname: 'Test',
                                surname: 'User',
                                email: null,
                        })
                        .end((err, res) => {
                                res.status.should.eql(400);
                                res.type.should.eql('application/json');
                                res.body.error.should.eql('invalid data');
                                done();
                        });
        });
        it('should not register a user with invalid data', done => {
                nconf.set('auth:registration', true);
                nconf.save();
                post('/auth/register')
                        .send({
                                username: '',
                                password: '$2a$08$De/aXnQkZIEbQ9p8J22tHuzLltqIbsAxE2CGgRMPLaaIwwHmVrpsu',
                                givenname: 'Test',
                                surname: 'User',
                                email: 'unique@snowflake.com',
                        })
                        .end((err, res) => {
                                res.status.should.eql(500);
                                res.type.should.eql('application/json');
                                res.body.status.should.eql('failed');
                                done();
                        });
        });
});

describe('GET /auth/reset', () => {
        it('should return the reset page if user is logged in', done => {
                passportStub.login({
                        username: 'useractive',
                        password: 'changeme',
                });
                chai.request(server)
                        .get('/auth/reset')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                res.type.should.eql('text/html');
                                done();
                        });
        });
        it('should redirect to login page if no user logged in', done => {
                chai.request(server)
                        .get('/auth/reset')
                        .redirects(0)
                        .end((err, res) => {
                                should.not.exist(err);
                                res.should.redirectTo('/auth/login');
                                done();
                        });
        });
});

describe('POST /auth/reset', () => {
        // The route now loads the user fresh from the database rather than
        // trusting the session copy, so the stub only needs to identify who is
        // logged in.
        const login = () =>
                passportStub.login({
                        username: 'useractive',
                });

        it('should change the password when the current one is supplied', done => {
                login();
                post('/auth/reset')
                        .send({
                                currentpassword: 'changeme',
                                password: 'a-much-longer-password',
                        })
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                res.body.status.should.eql('ok');
                                res.body.redirect.should.eql('/');
                                done();
                        });
        });
        it('should stamp pwchangedat so older sessions are invalidated', done => {
                login();
                post('/auth/reset')
                        .send({
                                currentpassword: 'changeme',
                                password: 'a-much-longer-password',
                        })
                        .end(err => {
                                should.not.exist(err);
                                db('users')
                                        .where('username', 'useractive')
                                        .first()
                                        .then(user => {
                                                should.exist(user.pwchangedat);
                                                user.pwchangedat.should.be.above(0);
                                                done();
                                        })
                                        .catch(done);
                        });
        });
        it('should refuse without the current password', done => {
                login();
                post('/auth/reset')
                        .send({
                                password: 'a-much-longer-password',
                        })
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(400);
                                res.body.status.should.eql('failed');
                                res.body.error.should.eql('Your current password is required');
                                done();
                        });
        });
        it('should refuse when the current password is wrong', done => {
                login();
                post('/auth/reset')
                        .send({
                                currentpassword: 'not-the-right-one',
                                password: 'a-much-longer-password',
                        })
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(400);
                                res.body.error.should.eql('Your current password is not correct');
                                done();
                        });
        });
        it('should not leave the password changed when the current one is wrong', done => {
                login();
                post('/auth/reset')
                        .send({
                                currentpassword: 'not-the-right-one',
                                password: 'a-much-longer-password',
                        })
                        .end(err => {
                                should.not.exist(err);
                                db('users')
                                        .where('username', 'useractive')
                                        .first()
                                        .then(user => {
                                                require('bcryptjs')
                                                        .compareSync('changeme', user.password)
                                                        .should.eql(true);
                                                done();
                                        })
                                        .catch(done);
                        });
        });
        it('should not accept the same password', done => {
                login();
                post('/auth/reset')
                        .send({
                                currentpassword: 'changeme',
                                password: 'changeme',
                        })
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(400);
                                res.body.status.should.eql('failed');
                                // The seeded password is 8 characters, so the policy check
                                // fires before the same-password check does.
                                res.body.error.should.match(/at least|different/);
                                done();
                        });
        });
        it('should enforce the minimum password length', done => {
                login();
                post('/auth/reset')
                        .send({
                                currentpassword: 'changeme',
                                password: 'short',
                        })
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(400);
                                res.body.error.should.match(/at least 10 characters/);
                                done();
                        });
        });
});

describe('CSRF protection on /auth', () => {
        it('should reject a POST with no token', done => {
                agent.post('/auth/login')
                        .send({ username: 'useractive', password: 'changeme' })
                        .end((err, res) => {
                                res.status.should.eql(403);
                                res.body.error.should.eql('Invalid or missing CSRF token');
                                done();
                        });
        });
        it('should reject a POST with the wrong token', done => {
                agent.post('/auth/login')
                        .set('X-XSRF-TOKEN', 'not-the-real-token')
                        .send({ username: 'useractive', password: 'changeme' })
                        .end((err, res) => {
                                res.status.should.eql(403);
                                done();
                        });
        });
        it('should reject a token that belongs to a different session', done => {
                // The token is only meaningful alongside the session it was issued
                // to - a value copied from elsewhere must not work.
                csrfAgent(server).then(other => {
                        agent.post('/auth/login')
                                .set('X-XSRF-TOKEN', other.token)
                                .send({ username: 'useractive', password: 'changeme' })
                                .end((err, res) => {
                                        res.status.should.eql(403);
                                        other.agent.close();
                                        done();
                                });
                });
        });
        it('should publish a readable XSRF-TOKEN cookie on a page load', done => {
                chai.request(server)
                        .get('/auth/login')
                        .end((err, res) => {
                                const cookies = res.headers['set-cookie'] || [];
                                const xsrf = cookies.filter(c => c.indexOf('XSRF-TOKEN=') === 0);
                                xsrf.length.should.eql(1);
                                // Angular has to read it, so it must not be httpOnly.
                                xsrf[0].toLowerCase().should.not.contain('httponly');
                                xsrf[0].toLowerCase().should.contain('samesite=lax');
                                done();
                        });
        });
});

// These endpoints answer only whether a value is taken. They used to echo back
// the matching row, which made them a public account-enumeration service and
// would have flatly contradicted the deliberately uninformative response from
// POST /auth/forgot.
describe('GET /auth/userCheck/username/:id', () => {
        it('should report a username as taken when it exists', done => {
                chai.request(server)
                        .get('/auth/userCheck/username/useractive')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                res.type.should.eql('application/json');
                                res.body.taken.should.eql(true);
                                done();
                        });
        });
        it('should report a username as free when it does not exist', done => {
                chai.request(server)
                        .get('/auth/userCheck/username/idontexist')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                res.type.should.eql('application/json');
                                res.body.taken.should.eql(false);
                                done();
                        });
        });
        it('should not leak any account detail beyond the taken flag', done => {
                chai.request(server)
                        .get('/auth/userCheck/username/useractive')
                        .end((err, res) => {
                                should.not.exist(err);
                                Object.keys(res.body).should.eql(['taken']);
                                done();
                        });
        });
});

describe('GET /auth/userCheck/email/:id', () => {
        it('should report an email as taken when it exists', done => {
                chai.request(server)
                        .get('/auth/userCheck/email/none1@none.com')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                res.type.should.eql('application/json');
                                res.body.taken.should.eql(true);
                                done();
                        });
        });
        it('should report an email as free when it does not exist', done => {
                chai.request(server)
                        .get('/auth/userCheck/email/idontexist@none.com')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                res.type.should.eql('application/json');
                                res.body.taken.should.eql(false);
                                done();
                        });
        });
        it('should not leak any account detail beyond the taken flag', done => {
                chai.request(server)
                        .get('/auth/userCheck/email/none1@none.com')
                        .end((err, res) => {
                                should.not.exist(err);
                                Object.keys(res.body).should.eql(['taken']);
                                done();
                        });
        });
});
