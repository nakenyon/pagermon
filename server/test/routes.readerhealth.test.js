process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../app');
const db = require('../knex/knex');
const nconf = require('nconf');
const passportStub = require('passport-stub');
const health = require('../lib/readerhealth').instance();
const uuid = require('node-uuid');
passportStub.install(app);

describe('Reader health HTTP integration', function () {
    let original, settings, key, dest, calls, record;
    beforeEach(async function () {
        await db.migrate.latest();
        await db.seed.run();
        original = fs.readFileSync('./config/config.json', 'utf8');
        settings = JSON.parse(original);
        key = uuid.v4(); dest = uuid.v4();
        settings.auth.keys = [{ id: key, name: 'Reader test', key: 'health-test-secret' }];
        settings.plugins = {};
        settings.messages.duplicateFiltering = true;
        settings.messages.duplicateLimit = 10;
        settings.messages.duplicateTime = 60;
        settings.readerHealth = {
            destinations: [{ id: dest, name: 'Discord test', type: 'discord', webhook: 'https://discord.com/api/webhooks/123/test_TOKEN' }],
            monitors: [{ keyId: key, enabled: true, timeoutMinutes: 360, destinationIds: [dest], recoveryUserIds: [] }]
        };
        fs.writeFileSync('./config/config.json', JSON.stringify(settings)); nconf.load();
        calls = []; record = health.record;
        health.record = async id => { calls.push(id); return record(id); };
        passportStub.logout();
    });
    afterEach(async function () {
        health.record = record;
        fs.writeFileSync('./config/config.json', original); nconf.load();
        passportStub.logout();
        await db.migrate.rollback();
    });
    function post(body, secret) {
        return chai.request(app).post('/api/messages').set('apikey', secret || 'health-test-secret').send(body);
    }
    it('counts authenticated duplicates and ignored aliases before discard', async function () {
        const body = { address: '9999998', message: 'health-' + uuid.v4(), datetime: Math.floor(Date.now() / 1000), source: 'HEALTH' };
        assert.equal((await post(body)).status, 200);
        assert.equal((await post(body)).status, 200);
        await db('capcodes').insert({ address: '9999997', alias: 'Ignored', agency: 'Test', ignore: 1 });
        assert.equal((await post(Object.assign({}, body, { address: '9999997' }))).status, 200);
        assert.deepEqual(calls, [key, key, key]);
        assert((await db('reader_health').where('key_id', key).first()).last_received);
    });
    it('does not count invalid authentication, malformed messages, API reads or session-admin posts', async function () {
        await post({ address: '9999998', message: 'test' }, 'incorrect');
        await post({ address: '9999998' });
        await chai.request(app).get('/api/messages').set('apikey', 'health-test-secret');
        passportStub.login({ username: 'admin', role: 'admin' });
        await post({ address: '9999998', message: 'session-' + uuid.v4(), datetime: 1 });
        assert.equal(calls.length, 0);
    });
    it('counts messages discarded by a before-message plugin', async function () {
        const plugins = require('../plugins/pluginHandler');
        const handle = plugins.handle;
        plugins.handle = (trigger, scope, data, callback) => { data.pluginData.ignore = true; callback(data); };
        try {
            const res = await post({ address: '9999998', message: 'plugin-' + uuid.v4(), datetime: 1 });
            assert.equal(res.status, 200); assert.deepEqual(calls, [key]);
        } finally { plugins.handle = handle; }
    });
    it('accepts legacy numeric addresses as valid activity', async function () {
        await post({ address: 9999996, message: 'numeric-' + uuid.v4(), datetime: 1 });
        assert.deepEqual(calls, [key]);
    });
    it('denies health endpoints to ingestion keys and ordinary users', async function () {
        assert.equal((await chai.request(app).get('/admin/readerHealth').set('apikey', 'health-test-secret')).status, 403);
        assert.equal((await chai.request(app).post('/admin/readerHealth/test').set('apikey', 'health-test-secret').send({ destinationId: dest })).status, 403);
        passportStub.login({ username: 'user', role: 'user' });
        assert.equal((await chai.request(app).get('/admin/readerHealth')).status, 403);
    });
    it('redacts credentials for admins and hides health settings from API-key clients', async function () {
        let response = await chai.request(app).get('/admin/settingsData').set('apikey', 'health-test-secret');
        assert.equal(response.status, 200); assert.equal(response.body.settings.readerHealth, undefined);
        passportStub.login({ username: 'admin', role: 'admin' });
        response = await chai.request(app).get('/admin/settingsData');
        assert.equal(response.body.settings.readerHealth.destinations[0].webhook, '********');
        assert(!JSON.stringify(response.body).includes('test_TOKEN'));
        assert.equal((await chai.request(app).get('/admin/readerHealth')).status, 200);
    });
    it('requires CSRF for settings changes and rejects API-key attempts to erase monitoring', async function () {
        const next = JSON.parse(JSON.stringify(settings)); delete next.readerHealth;
        assert.equal((await chai.request(app).post('/admin/settingsData').set('apikey', 'health-test-secret').send(next)).status, 403);
        passportStub.login({ username: 'admin', role: 'admin' });
        assert.equal((await chai.request(app).post('/admin/settingsData').send(settings)).status, 403);
        assert.equal((await chai.request(app).post('/admin/readerHealth/test').send({ destinationId: dest })).status, 403);
    });
    it('preserves Docker-style configuration symlinks when saving', async function () {
        passportStub.login({ username: 'admin', role: 'admin' });
        const agent = chai.request.agent(app);
        fs.renameSync('./config/config.json', './config/health-original.json');
        fs.writeFileSync('./config/health-target.json', JSON.stringify(settings), { flag: 'wx' });
        fs.symlinkSync('health-target.json', './config/config.json');
        try {
            const response = await agent.get('/admin/settingsData');
            const cookie = response.headers['set-cookie'].find(c => c.startsWith('XSRF-TOKEN='));
            const token = decodeURIComponent(cookie.split(';')[0].slice('XSRF-TOKEN='.length));
            const next = response.body.settings; next.readerHealth.monitors[0].timeoutMinutes = 400;
            const saved = await agent.post('/admin/settingsData').set('X-XSRF-TOKEN', token).send(next);
            assert.equal(saved.status, 200, JSON.stringify(saved.body));
            assert(fs.lstatSync('./config/config.json').isSymbolicLink());
            assert.equal(JSON.parse(fs.readFileSync('./config/health-target.json', 'utf8')).readerHealth.monitors[0].timeoutMinutes, 400);
        } finally {
            agent.close();
            fs.unlinkSync('./config/config.json'); fs.unlinkSync('./config/health-target.json');
            fs.renameSync('./config/health-original.json', './config/config.json'); nconf.load();
        }
    });
    it('saves masked credentials, preserves key IDs on rename/rotation and reconciles disable immediately', async function () {
        passportStub.login({ username: 'admin', role: 'admin' });
        const agent = chai.request.agent(app);
        try {
            const response = await agent.get('/admin/settingsData');
            const cookie = response.headers['set-cookie'].find(c => c.startsWith('XSRF-TOKEN='));
            const token = decodeURIComponent(cookie.split(';')[0].slice('XSRF-TOKEN='.length));
            const next = response.body.settings;
            next.auth.keys[0].name = 'Renamed'; next.auth.keys[0].key = 'new-secret';
            next.readerHealth.monitors[0].enabled = false;
            const saved = await agent.post('/admin/settingsData').set('X-XSRF-TOKEN', token).send(next);
            assert.equal(saved.status, 200, JSON.stringify(saved.body));
            assert.equal(nconf.get('auth:keys')[0].id, key);
            assert.equal(nconf.get('readerHealth').destinations[0].webhook, 'https://discord.com/api/webhooks/123/test_TOKEN');
            assert.equal(saved.body.settings.readerHealth.destinations[0].webhook, '********');
        } finally { agent.close(); }
    });
});
