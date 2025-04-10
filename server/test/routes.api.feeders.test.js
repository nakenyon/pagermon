process.env.NODE_ENV = 'test';

const chai = require('chai');
const moment = require('moment');

const should = chai.should();
const chaiHttp = require('chai-http');

chai.use(chaiHttp);

const confFile = './config/config.json';
// load the config file
const nconf = require('nconf');

nconf.file({ file: confFile });
nconf.load();

const passportStub = require('passport-stub');
// eslint-disable-next-line vars-on-top
var server = require('../app.js');
const db = require('../knex/knex.js');
// This needs to be sorted out, use a different config file when testing?

passportStub.install(server);
// set required settings in config file

beforeEach(() =>
        db.migrate.rollback().then(() =>
                db.migrate.latest().then(() =>
                        db.seed.run().then(() => {
                                nconf.set('messages:HideSource', false);
                                nconf.set('messages:apiSecurity', false);
                                nconf.set('messages:HideCapcode', false);
                        })
                )
        )
);
afterEach(() => db.migrate.rollback().then(() => passportStub.logout()));

describe('GET /api/feeders', () => {
        it('should return all feeders when logged in as admin', done => {
                passportStub.login({
                        username: 'adminactive',
                        password: 'changeme',
                        role: 'admin',
                });
                chai.request(server)
                        .get('/api/feeders')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                res.type.should.eql('application/json');
                                res.body.should.be.a('array');
                                res.body[0].should.have.property('id');
                                res.body[0].should.have.property('name');
                                res.body[0].should.have.property('description');
                                res.body[0].should.have.property('last_message');
                                res.body[0].should.have.property('heartbeat_enabled');
                                res.body[0].should.have.property('heartbeat_interval');
                                res.body[0].should.have.property('last_heartbeat');
                                res.body[0].should.have.property('updated_at');
                                res.body[0].should.have.property('created_at');
                                res.body[0].should.not.have.property('apikey');
                                res.body.length.should.eql(2);
                                done();
                        });
        });
        it('should return all feeders when api key provided', done => {
                chai.request(server)
                        .get('/api/feeders')
                        .set('apikey', 'reallylongkeythatneedstobechanged')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                res.type.should.eql('application/json');
                                res.body.should.be.a('array');
                                res.body[0].should.have.property('id');
                                res.body[0].should.have.property('name');
                                res.body[0].should.have.property('description');
                                res.body[0].should.have.property('last_message');
                                res.body[0].should.have.property('heartbeat_enabled');
                                res.body[0].should.have.property('heartbeat_interval');
                                res.body[0].should.have.property('last_heartbeat');
                                res.body[0].should.have.property('updated_at');
                                res.body[0].should.have.property('created_at');
                                res.body[0].should.not.have.property('apikey');
                                res.body.length.should.eql(2);
                                done();
                        });
        });
        it('should return a 403 when not admin', done => {
                passportStub.login({
                        username: 'useractive',
                        password: 'changeme',
                        role: 'user',
                });
                chai.request(server)
                        .get('/api/feeders')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(403);
                                res.type.should.eql('application/json');
                                done();
                        });
        });
        it('should return a 401 when not logged in', done => {
                chai.request(server)
                        .get('/api/feeders')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(401);
                                res.type.should.eql('application/json');
                                done();
                        });
        });
        it('should return a 401 when incorrect api key provided', done => {
                chai.request(server)
                        .get('/api/feeders')
                        .set('apikey', 'shortkeythatdoesntexist')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(401);
                                res.type.should.eql('application/json');
                                done();
                        });
        });
});

describe('POST /api/feeders', () => {});

describe('GET /api/feeders/:id', () => {
        it('should return specific feeder when logged in as admin', done => {
                passportStub.login({
                        username: 'adminactive',
                        password: 'changeme',
                        role: 'admin',
                });
                chai.request(server)
                        .get('/api/feeders/0')
                        .end((err, res) => {
                                res.status.should.eql(200);
                                res.type.should.eql('application/json');
                                res.body.should.be.a('object');
                                res.body.should.have.property('id');
                                res.body.id.should.eql(0);
                                res.body.should.have.property('name');
                                res.body.name.should.eql('Test Feeder 0');
                                res.body.should.have.property('description');
                                res.body.description.should.eql('This is a test feeder with heartbeat every 5 seconds');
                                res.body.should.have.property('last_message');
                                res.body.should.have.property('heartbeat_enabled');
                                res.body.heartbeat_enabled.should.eql(true);
                                res.body.should.have.property('heartbeat_interval');
                                res.body.heartbeat_interval.should.eql(5);
                                res.body.should.have.property('last_heartbeat');
                                res.body.last_heartbeat.should.be.a('string');
                                moment(res.body.last_heartbeat, 'YYYY-MM-DD HH:mm:ss', true).isValid().should.be.true;
                                res.body.should.have.property('updated_at');
                                res.body.updated_at.should.be.a('string');
                                res.body.should.have.property('created_at');
                                res.body.created_at.should.be.a('string');
                                res.body.should.not.have.property('apikey');
                                done();
                        });
        });
        it('should return specific feeder when api key provided', done => {
                chai.request(server)
                        .get('/api/feeders/0')
                        .set('apikey', 'reallylongkeythatneedstobechanged')
                        .end((err, res) => {
                                res.status.should.eql(200);
                                res.type.should.eql('application/json');
                                res.body.should.be.a('object');
                                res.body.should.have.property('id');
                                res.body.id.should.eql(0);
                                res.body.should.have.property('name');
                                res.body.name.should.eql('Test Feeder 0');
                                res.body.should.have.property('description');
                                res.body.description.should.eql('This is a test feeder with heartbeat every 5 seconds');
                                res.body.should.have.property('last_message');
                                res.body.should.have.property('heartbeat_enabled');
                                res.body.heartbeat_enabled.should.eql(true);
                                res.body.should.have.property('heartbeat_interval');
                                res.body.heartbeat_interval.should.eql(5);
                                res.body.should.have.property('last_heartbeat');
                                res.body.last_heartbeat.should.be.a('string');
                                moment(res.body.last_heartbeat, 'YYYY-MM-DD HH:mm:ss', true).isValid().should.be.true;
                                res.body.should.have.property('updated_at');
                                res.body.updated_at.should.be.a('string');
                                res.body.should.have.property('created_at');
                                res.body.created_at.should.be.a('string');
                                res.body.should.not.have.property('apikey');
                                done();
                        });
        });
        it('should return a 403 when not admin', done => {
                passportStub.login({
                        username: 'useractive',
                        password: 'changeme',
                        role: 'user',
                });
                chai.request(server)
                        .get('/api/feeders/0')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(403);
                                res.type.should.eql('application/json');
                                done();
                        });
        });
        it('should return a 401 when not logged in', done => {
                chai.request(server)
                        .get('/api/feeders/0')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(401);
                                res.type.should.eql('application/json');
                                done();
                        });
        });
        it('should return a 401 when incorrect api key provided', done => {
                chai.request(server)
                        .get('/api/feeders/0')
                        .set('apikey', 'shortkeythatdoesntexist')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(401);
                                res.type.should.eql('application/json');
                                done();
                        });
        });
});

describe('POST /api/feeders/:id', () => {});

describe('DELETE /api/feeders/:id', () => {
        it('should delete a feeder when logged in as admin', function(done) {
                // Log in as admin
                passportStub.login({
                        username: 'adminactive',
                        password: 'changeme',
                        role: 'admin',
                });

                // First, send the DELETE request
                chai.request(server)
                        .delete('/api/feeders/0')
                        .then(delRes => {
                                // Assert the DELETE response
                                delRes.should.have.status(200);
                                delRes.body.should.be.an('object');
                                delRes.body.status.should.eql('Deleted');

                                // Then, send the GET request to verify deletion
                                return chai.request(server).get('/api/feeders/0');
                        })
                        .then(getRes => {
                                // Assert the GET response
                                getRes.should.have.status(404);
                                getRes.type.should.eql('application/json');
                                getRes.body.should.be.an('object');
                                getRes.body.should.have.property('error');
                                getRes.body.error.should.eql('Not found');
                                done();
                        })
                        .catch(err => done(err)); // Catch any errors during the requests
        });

        it('should delete a feeder when api key is provided', done => {
                // First, send the DELETE request
                chai.request(server)
                        .delete('/api/feeders/0')
                        .set('apikey', 'reallylongkeythatneedstobechanged')
                        .then(delRes => {
                                // Assert the DELETE response
                                delRes.should.have.status(200);
                                delRes.body.should.be.an('object');
                                delRes.body.status.should.eql('Deleted');

                                // Then, send the GET request to verify deletion
                                return chai
                                        .request(server)
                                        .get('/api/feeders/0')
                                        .set('apikey', 'reallylongkeythatneedstobechanged');
                        })
                        .then(getRes => {
                                // Assert the GET response
                                getRes.should.have.status(404);
                                getRes.type.should.eql('application/json');
                                getRes.body.should.be.an('object');
                                getRes.body.should.have.property('error');
                                getRes.body.error.should.eql('Not found');
                                done();
                        })
                        .catch(err => done(err)); // Catch any errors during the requests
        });

        it('should return a 403 when not admin', done => {
                passportStub.login({
                        username: 'useractive',
                        password: 'changeme',
                        role: 'user',
                });
                chai.request(server)
                        .delete('/api/feeders/0')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(403);
                                res.type.should.eql('application/json');
                                done();
                        });
        });
        it('should return a 401 when not logged in', done => {
                chai.request(server)
                        .delete('/api/feeders/0')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(401);
                                res.type.should.eql('application/json');
                                done();
                        });
        });
        it('should return a 401 when incorrect api key provided', done => {
                chai.request(server)
                        .delete('/api/feeders/0')
                        .set('apikey', 'shortkeythatdoesntexist')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(401);
                                res.type.should.eql('application/json');
                                done();
                        });
        });
});

describe('POST /api/feeders/:id/heartbeat', () => {
        it('should update heartbeat when identified as client', done => {
                chai.request(server)
                        .post('/api/feeders/0/heartbeat')
                        .set('apikey', 'testfeeder0')
                        .end((err, res) => {
                                res.status.should.eql(200);
                                res.type.should.eql('application/json');
                                res.body.should.be.a('object');
                                res.body.should.have.property('status');
                                res.body.status.should.eql('ok');
                                res.body.should.have.property('message');
                                res.body.message.should.eql('Heartbeat updated');
                                done();
                        });
        });
        it('should return a 401 when presented with invalid key', done => {
                chai.request(server)
                        .post('/api/feeders/0/heartbeat')
                        .set('apikey', 'shortkeythatdoesntexist')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(401);
                                res.type.should.eql('application/json');
                                done();
                        });
        });
        it('should return a 401 when not logged in', done => {
                chai.request(server)
                        .post('/api/feeders/0/heartbeat')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(401);
                                res.type.should.eql('application/json');
                                done();
                        });
        });
        it('shout return a 403 when logged in as admin', done => {
                passportStub.login({
                        username: 'adminactive',
                        password: 'changeme',
                        role: 'admin',
                });
                chai.request(server)
                        .post('/api/feeders/0/heartbeat')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(403);
                                res.type.should.eql('application/json');
                                done();
                        });
        });
        it('should return a 403 when logged in as user', done => {
                passportStub.login({
                        username: 'useractive',
                        password: 'changeme',
                        role: 'user',
                });
                chai.request(server)
                        .post('/api/feeders/0/heartbeat')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(403);
                                res.type.should.eql('application/json');
                                done();
                        });
        });
        it('should return a 403 when logged in as another client', done => {
                chai.request(server)
                        .post('/api/feeders/0/heartbeat')
                        .set('apikey', 'testfeeder1')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(403);
                                res.type.should.eql('application/json');
                                done();
                        });
        });
});

describe('GET /api/feeders/:id/heartbeat', () => {
        it('should return heartbeat when logged in as admin', done => {
                passportStub.login({
                        username: 'adminactive',
                        password: 'changeme',
                        role: 'admin',
                });
                chai.request(server)
                        .get('/api/feeders/0/heartbeat')
                        .end((err, res) => {
                                console.log(res.body);
                                res.status.should.eql(200);
                                res.type.should.eql('application/json');
                                res.body.should.be.a('object');
                                res.body.should.have.property('status');
                                res.body.status.should.eql('online');
                                res.body.should.have.property('last_heartbeat');
                                res.body.last_heartbeat.should.be.a('string');
                                done();
                        });
        });
        it('should return heartbeat when api key provided', done => {
                chai.request(server)
                        .get('/api/feeders/0/heartbeat')
                        .set('apikey', 'testfeeder0')
                        .end((err, res) => {
                                console.log(res.body);
                                res.status.should.eql(200);
                                res.type.should.eql('application/json');
                                res.body.should.be.a('object');
                                res.body.should.have.property('status');
                                res.body.status.should.eql('online');
                                res.body.should.have.property('last_heartbeat');
                                res.body.last_heartbeat.should.be.a('string');
                                done();
                        });
        });
        it('should return a 401 when not logged in', done => {
                chai.request(server)
                        .get('/api/feeders/0/heartbeat')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(401);
                                res.type.should.eql('application/json');
                                done();
                        });
        });
        it('should return a 403 when not admin', done => {
                passportStub.login({
                        username: 'useractive',
                        password: 'changeme',
                        role: 'user',
                });
                chai.request(server)
                        .get('/api/feeders/0/heartbeat')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(403);
                                res.type.should.eql('application/json');
                                done();
                        });
        });
        it('should return a 401 when incorrect api key provided', done => {
                chai.request(server)
                        .get('/api/feeders/0/heartbeat')
                        .set('apikey', 'shortkeythatdoesntexist')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(401);
                                res.type.should.eql('application/json');
                                done();
                        });
        });
        it('should return online if heartbeat is disabled', done => {
                chai.request(server)
                        .get('/api/feeders/1/heartbeat')
                        .set('apikey', 'testfeeder1')
                        .end((err, res) => {
                                console.log(res.body);
                                res.status.should.eql(200);
                                res.type.should.eql('application/json');
                                res.body.should.be.a('object');
                                res.body.should.have.property('status');
                                res.body.status.should.eql('online');
                                res.body.should.have.property('message');
                                res.body.message.should.eql('Heartbeat is disabled');
                                done();
                        });
        });
        it('should return offline if heartbeat is missing', done => {
                setTimeout(() => {
                        chai.request(server)
                                .get('/api/feeders/0/heartbeat')
                                .set('apikey', 'testfeeder0')
                                .end((err, res) => {
                                        console.log(res.body);
                                        res.status.should.eql(200);
                                        res.type.should.eql('application/json');
                                        res.body.should.be.a('object');
                                        res.body.should.have.property('status');
                                        res.body.status.should.eql('offline');
                                        res.body.should.have.property('message');
                                        res.body.message.should.eql('Heartbeat is missing');
                                        done();
                                });
                }, 7000);
        });
});
