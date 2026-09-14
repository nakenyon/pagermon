process.env.NODE_ENV = 'test';
const assert = require('assert');
const knex = require('knex');
const uuid = require('node-uuid');
const migration = require('../knex/migrations/20260816120000_reader_health');
const { create } = require('../lib/readerhealth');
const config = require('../lib/readerhealthconfig');

describe('Reader health state machine (isolated database and clock)', function () {
    let db, values, conf, service, now, sent, keyA, keyB, dest;
    beforeEach(async function () {
        db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true, pool: { min: 1, max: 1 } });
        await migration.up(db);
        await db.schema.createTable('users', t => { t.integer('id').primary(); t.string('email'); });
        await db('users').insert([{ id: 1, email: 'one@example.com' }, { id: 2, email: 'two@example.com' }, { id: 3, email: 'one@example.com' }]);
        now = 100000;
        sent = [];
        keyA = uuid.v4(); keyB = uuid.v4(); dest = uuid.v4();
        values = {
            'global:monitorName': 'Test PagerMon',
            'auth:keys': [{ id: keyA, key: 'secretA', name: 'Reader A' }, { id: keyB, key: 'secretB', name: 'Reader B' }],
            readerHealth: {
                destinations: [{ id: dest, type: 'email', name: 'Operators', userIds: [1, 3] }],
                monitors: [keyA, keyB].map(keyId => ({ keyId, enabled: true, timeoutMinutes: 360, destinationIds: [dest], recoveryUserIds: [1, 2] }))
            }
        };
        conf = { get: key => values[key] };
        service = create(db, conf, { now: () => now, send: async (c, d, m) => sent.push({ d, m }) });
        await service.sync();
    });
    afterEach(async function () { await db.destroy(); });
    async function outage() { now += 21601; await service.tick(); }

    it('creates schema idempotently and rolls back cleanly', async function () {
        await migration.up(db);
        await migration.down(db);
        assert.equal(await db.schema.hasTable('reader_health'), false);
    });
    it('has a full grace period, alerts only after six hours, and deduplicates recipients', async function () {
        now += 21600;
        await service.tick(); assert.equal(sent.length, 0);
        now += 1;
        await service.tick(); assert.equal(sent.length, 2);
        await service.tick(); assert.equal(sent.length, 2);
        assert(!JSON.stringify(sent).includes('secretA'));
    });
    it('records each key independently and does not accept unknown identities', async function () {
        now += 20000; await service.record(keyA); await service.record('unknown');
        now += 1601; await service.tick();
        assert.equal(sent.length, 1);
        assert(sent[0].m.title.includes('Reader B'));
    });
    it('recovers once with additional emails, then opens a new incident after another outage', async function () {
        await outage();
        now += 1; await Promise.all([service.record(keyA), service.record(keyA)]);
        await service.tick();
        assert.equal(sent.length, 4);
        assert.equal(sent.filter(s => s.m.title.includes('recovered')).length, 2);
        await service.tick(); assert.equal(sent.length, 4);
        now += 21601; await service.tick(); assert.equal(sent.length, 5);
    });
    it('survives restart without resetting grace or repeating sent alerts', async function () {
        await outage();
        service = create(db, conf, { now: () => now, send: async (c, d, m) => sent.push({ d, m }) });
        await service.sync(); await service.tick(); assert.equal(sent.length, 2);
        await service.record(keyA); await service.tick(); assert.equal(sent.length, 4);
    });
    it('preserves overdue activity on restart before an incident was detected', async function () {
        now += 10; await service.record(keyA);
        now += 21601;
        service = create(db, conf, { now: () => now, send: async (c, d, m) => sent.push({ d, m }) });
        await service.tick(); assert.equal(sent.length, 2);
    });
    it('disabling cancels pending notifications, without recovery; re-enable starts a new grace', async function () {
        service = create(db, conf, { now: () => now, send: async () => { throw new Error('secret'); } });
        await outage();
        values.readerHealth.monitors[0].enabled = false;
        await service.sync();
        const disabled = await db('reader_incidents').where('key_id', keyA).first();
        assert.equal(disabled.status, 'disabled');
        assert.equal((await db('reader_deliveries').where('incident_id', disabled.id).first()).status, 'cancelled');
        values.readerHealth.monitors[0].enabled = true;
        await service.sync();
        await service.record(keyA);
        assert.equal((await db('reader_deliveries').where({ incident_id: disabled.id, kind: 'recovery' })).length, 0);
        assert.equal(Number((await db('reader_health').where('key_id', keyA).first()).started_at), now);
    });
    it('deleting a key disables its monitor; rename/rotation preserves identity and receipt', async function () {
        await service.record(keyA);
        values['auth:keys'][0].name = 'Renamed'; values['auth:keys'][0].key = 'rotated';
        await service.sync();
        assert.equal(Number((await db('reader_health').where('key_id', keyA).first()).last_received), now);
        values['auth:keys'].shift(); await service.sync();
        assert.equal((await db('reader_health').where('key_id', keyA).first()).enabled, 0);
    });
    it('retries failed delivery without repeating successful destinations and eventually stops', async function () {
        values.readerHealth.destinations[0].userIds = [1, 2];
        service = create(db, conf, { now: () => now, send: async (c, d, m) => {
            if (d.email === 'two@example.com') throw new Error('secret');
            sent.push({ d, m });
        } });
        await outage(); assert.equal(sent.length, 2);
        for (let i = 0; i < 7; i++) { now += 3600; await service.tick(); }
        assert.equal(sent.length, 2);
        const failures = await db('reader_deliveries').where('status', 'failed');
        assert.equal(failures.length, 2); assert.equal(failures[0].attempts, 6);
        assert(!JSON.stringify(failures).includes('secret'));
    });
    it('cancels stale outage retries and sends recovery after messages resume', async function () {
        let fail = true;
        service = create(db, conf, { now: () => now, send: async (c, d, m) => { if (fail) throw new Error('offline'); sent.push({ d, m }); } });
        await outage();
        await service.record(keyA); fail = false; await service.tick();
        assert.equal(sent.length, 2);
        assert(sent.every(s => s.m.title.includes('recovered')));
    });
    it('does not duplicate incidents when checks and receipts overlap', async function () {
        now += 21601;
        await Promise.all([service.record(keyA), service.tick(), service.tick()]);
        assert.equal((await db('reader_incidents').where('key_id', keyA)).length, 0);
        assert.equal((await db('reader_incidents').where('key_id', keyB)).length, 1);
    });
    it('allows receipt while a provider is in flight and orders recovery after outage', async function () {
        let release, started;
        const sending = new Promise(r => { started = r; });
        service = create(db, conf, { now: () => now, send: async (c, d, m) => {
            if (m.title.includes('inactive: Reader A')) { started(); await new Promise(r => { release = r; }); }
            sent.push({ d, m });
        } });
        now += 21601;
        const tick = service.tick(); await sending;
        await service.record(keyA);
        release(); await tick; await service.tick();
        const a = sent.filter(s => s.m.title.includes('Reader A'));
        assert(a[0].m.title.includes('inactive')); assert(a[1].m.title.includes('recovered'));
    });
    it('continues checking other keys while a provider is slow', async function () {
        values.readerHealth.monitors[1].timeoutMinutes = 720;
        let release, started;
        const sending = new Promise(r => { started = r; });
        service = create(db, conf, { now: () => now, send: async () => {
            started(); await new Promise(r => { release = r; });
        } });
        now += 21601;
        const tick = service.tick(); await sending;
        now += 21601;
        await service.tick();
        assert.equal((await db('reader_incidents').where('key_id', keyB)).length, 1);
        release(); await tick;
    });
    it('retries failed activity writes using the original receipt time', async function () {
        now += 20000;
        await db.schema.renameTable('reader_health', 'reader_health_held');
        await service.record(keyA);
        now += 1601;
        await service.tick(); assert.equal(sent.length, 0);
        await db.schema.renameTable('reader_health_held', 'reader_health');
        await service.tick();
        assert.equal(sent.length, 1); assert(sent[0].m.title.includes('Reader B'));
        assert.equal(Number((await db('reader_health').where('key_id', keyA).first()).last_received), now - 1601);
        assert.equal((await service.status()).error, null);
    });
    it('reclaims sending deliveries after a restart lease expires', async function () {
        await outage();
        await db('reader_deliveries').update({ status: 'sending', updated_at: now });
        sent = []; now += 301; await service.tick(); assert.equal(sent.length, 2);
    });
    it('reports database errors without rejecting receipt or exposing credentials', async function () {
        await db.schema.dropTable('reader_health');
        await service.record(keyA);
        const result = await service.status(); assert(result.error); assert(!result.error.includes('secret'));
    });
    it('tests destinations without changing health state', async function () {
        await service.test(dest); assert.equal(sent.length, 1);
        assert.equal((await db('reader_incidents')).length, 0);
        assert.equal((await db('reader_health').where('key_id', keyA).first()).last_received, null);
    });
    it('uses current user emails and cancels deliveries for deleted users', async function () {
        values.readerHealth.destinations[0].userIds = [1];
        await db('users').where('id', 1).update('email', 'new@example.com');
        await outage(); assert.equal(sent[0].d.email, 'new@example.com');
        await db('users').where('id', 1).del();
        await service.record(keyA); await service.tick();
        assert.equal(sent.filter(s => s.m.title.includes('recovered')).length, 1); // additional recipient 2
    });
    it('validates IDs, recipients, destination URLs and preserves masked credentials', async function () {
        const d = { id: dest, name: 'Discord', type: 'discord', webhook: 'https://discord.com/api/webhooks/123/abcDEF_123' };
        const previous = { auth: { keys: values['auth:keys'] }, readerHealth: { destinations: [d], monitors: [] } };
        const visible = config.publicSettings(previous, true);
        assert.equal(visible.readerHealth.destinations[0].webhook, '********');
        assert.equal(config.publicSettings(previous, false).readerHealth, undefined);
        const prepared = await config.prepare(visible, previous, db);
        assert.equal(prepared.readerHealth.destinations[0].webhook, d.webhook);
        prepared.readerHealth.destinations[0].webhook = 'https://127.0.0.1/api/webhooks/123/abc';
        await assert.rejects(config.prepare(prepared, previous, db), /Discord/);
        assert(!config.discordUrl('https://discord.com.evil.test/api/webhooks/123/abc'));
        assert(!config.discordUrl('https://discord.com/api/webhooks/123/abc?redirect=1'));
    });
    it('rejects unknown users, duplicate monitors, and changing a saved key ID', async function () {
        const original = { auth: { keys: values['auth:keys'] }, mail: { enabled: true, host: 'smtp.example.com', fromAddress: 'pager@example.com' }, readerHealth: values.readerHealth };
        const copy = () => JSON.parse(JSON.stringify(original));
        let next = copy(); next.readerHealth.monitors[0].recoveryUserIds = [999];
        await assert.rejects(config.prepare(next, copy(), db), /existing users/);
        next = copy(); next.readerHealth.monitors.push(next.readerHealth.monitors[0]);
        await assert.rejects(config.prepare(next, copy(), db), /unique existing/);
        next = copy(); next.auth.keys[0].id = uuid.v4();
        await assert.rejects(config.prepare(next, copy(), db), /cannot be changed/);
    });
});
