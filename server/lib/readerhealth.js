const uuid = require('node-uuid');
const config = require('./readerhealthconfig');
const transport = require('../notifications/readerHealth');
const logger = require('../log');

// One server process owns a database (the supported deployment). Serialize short
// DB operations across receipt/config/checker paths. Never hold this queue or a
// database transaction while talking to a notification provider.
function create(db, conf, options) {
    options = options || {};
    const clock = options.now || (() => Math.floor(Date.now() / 1000));
    const send = options.send || transport.send;
    let queue = Promise.resolve();
    let working = false;
    let error = null;
    const failedReceipts = new Map();
    function serial(fn) {
        const result = queue.then(fn);
        queue = result.catch(() => {});
        return result;
    }
    function settings() { return config.health({ readerHealth: conf.get('readerHealth') }); }
    function keys() { return conf.get('auth:keys') || []; }
    function monitors() { return settings().monitors.filter(m => m.enabled === true && keys().some(k => k.id === m.keyId)); }
    function fail() {
        const message = 'Reader health storage/check failed; activity tracking may be incomplete. Check server logs.';
        if (!error) logger.main.error(message);
        error = message;
    }

    async function cancel(trx, incidentId, now) {
        if (!incidentId) return;
        await trx('reader_incidents').where('id', incidentId).update({ status: 'disabled' });
        await trx('reader_deliveries').where('incident_id', incidentId).whereIn('status', ['pending', 'failed']).update({ status: 'cancelled', updated_at: now });
    }
    async function reconcile(trx, now) {
        const enabled = monitors();
        const rows = await trx('reader_health').select('*');
        for (const row of rows) {
            if (row.enabled && !enabled.some(m => m.keyId === row.key_id)) {
                await cancel(trx, row.incident_id, now);
                await trx('reader_health').where('key_id', row.key_id).update({ enabled: 0, incident_id: null });
            }
        }
        for (const monitor of enabled) {
            const row = rows.find(r => r.key_id === monitor.keyId);
            if (!row) await trx('reader_health').insert({ key_id: monitor.keyId, enabled: 1, started_at: now });
            else if (!row.enabled) await trx('reader_health').where('key_id', monitor.keyId).update({ enabled: 1, started_at: now, last_received: null, incident_id: null });
        }
    }
    async function targets(monitor, trx) {
        const users = await trx('users').select('id', 'email');
        function uniqueEmails(ids) {
            const seen = new Set();
            return ids.filter(id => {
                const u = users.find(u => Number(u.id) === Number(id));
                if (!u || !u.email || seen.has(u.email.toLowerCase())) return false;
                seen.add(u.email.toLowerCase());
                return true;
            }).map(id => 'email:' + id);
        }
        let userIds = [];
        const other = [];
        for (const id of monitor.destinationIds) {
            const d = settings().destinations.find(d => d.id === id);
            if (!d) continue;
            if (d.type === 'email') userIds = userIds.concat(d.userIds);
            else other.push('destination:' + id);
        }
        return {
            outage: [...new Set(other.concat(uniqueEmails(userIds)))],
            recovery: [...new Set(other.concat(uniqueEmails(userIds.concat(monitor.recoveryUserIds))))]
        };
    }
    async function enqueue(trx, incident, kind, refs, now) {
        for (const target of refs) await trx('reader_deliveries').insert({
            id: uuid.v4(), incident_id: incident, target, kind, status: 'pending', attempts: 0, next_attempt: now, updated_at: now
        });
    }

    async function record(keyId, receivedAt) {
        // Capture arrival time before waiting for other requests. Retrying a
        // failed write must preserve that time, not pretend a new page arrived.
        const now = receivedAt === undefined ? clock() : receivedAt;
        try {
            if (!keyId || !monitors().some(m => m.keyId === keyId)) {
                failedReceipts.delete(keyId);
                return;
            }
            await serial(() => db.transaction(async trx => {
                await reconcile(trx, now);
                const state = await trx('reader_health').where('key_id', keyId).first();
                if (!state || !state.enabled) return;
                if (state.incident_id) {
                    const incident = await trx('reader_incidents').where('id', state.incident_id).first();
                    if (incident && incident.status === 'open') {
                        await trx('reader_incidents').where('id', incident.id).update({ status: 'recovered', recovered_at: now });
                        await trx('reader_deliveries').where({ incident_id: incident.id, kind: 'outage', status: 'pending' }).update({ status: 'cancelled', updated_at: now });
                        await enqueue(trx, incident.id, 'recovery', JSON.parse(incident.targets).recovery, now);
                    }
                }
                await trx('reader_health').where('key_id', keyId).update({ last_received: Math.max(now, Number(state.last_received) || 0), incident_id: null });
            }));
            if ((failedReceipts.get(keyId) || 0) <= now) failedReceipts.delete(keyId);
        } catch (_) {
            failedReceipts.set(keyId, Math.max(now, failedReceipts.get(keyId) || 0));
            fail(); // Never drop paging messages because monitoring failed.
        }
    }

    async function check() {
        const now = clock();
        await serial(() => db.transaction(async trx => {
            await reconcile(trx, now);
            for (const monitor of monitors()) {
                const state = await trx('reader_health').where('key_id', monitor.keyId).first();
                const last = Number(state.last_received === null ? state.started_at : state.last_received);
                if (state.incident_id || now - last <= monitor.timeoutMinutes * 60) continue;
                const key = keys().find(k => k.id === monitor.keyId);
                const refs = await targets(monitor, trx);
                const id = uuid.v4();
                await trx('reader_incidents').insert({
                    id, key_id: monitor.keyId, reader_name: (key.name || 'Reader').slice(0, 255),
                    last_received: state.last_received, started_at: last + monitor.timeoutMinutes * 60,
                    detected_at: now, status: 'open', targets: JSON.stringify(refs)
                });
                await trx('reader_health').where('key_id', monitor.keyId).update({ incident_id: id });
                await enqueue(trx, id, 'outage', refs.outage, now);
            }
        }));
    }

    async function destination(target) {
        if (target.startsWith('email:')) {
            const user = await db('users').where('id', Number(target.slice(6))).first();
            if (!user || !user.email) return null;
            return { type: 'email', email: user.email };
        }
        return settings().destinations.find(d => 'destination:' + d.id === target);
    }
    function message(incident, kind, history) {
        const format = value => value === null ? 'No message received since monitoring was enabled' : new Date(Number(value) * 1000).toISOString();
        const recovery = kind === 'recovery';
        const title = (conf.get('global:monitorName') || 'PagerMon') + ' — Reader ' + (recovery ? 'recovered: ' : 'inactive: ') + incident.reader_name;
        return { title, text: [
            recovery ? 'Valid messages are being received again.' : 'No valid messages received within the configured timeout. Check the reader, decoder and network connection.',
            'Reader: ' + incident.reader_name,
            'Last receipt before outage: ' + format(incident.last_received),
            'Timeout exceeded: ' + format(incident.started_at),
            recovery ? 'Recovered: ' + format(incident.recovered_at) : 'Detected: ' + format(incident.detected_at),
            recovery ? 'Outage delivery status: ' + history.map(d => d.status).join(', ') : 'A quiet paging network can also cause this alert.',
            'Incident: ' + incident.id,
            'Times are UTC.'
        ].join('\n') };
    }
    async function deliver() {
        // A sending row left by a crash is retried after a lease. Supported
        // transports have deadlines shorter than this lease. Provider acceptance
        // followed by a crash can still duplicate delivery (at-least-once).
        const pending = await db('reader_deliveries').where(function () {
            this.where({ status: 'pending' }).andWhere('next_attempt', '<=', clock());
        }).orWhere(function () {
            this.where({ status: 'sending' }).andWhere('updated_at', '<', clock() - 300);
        }).orderBy('updated_at').limit(50);
        for (const item of pending) {
            const job = await serial(() => db.transaction(async trx => {
                const row = await trx('reader_deliveries').where('id', item.id).first();
                if (!row || !['pending', 'sending'].includes(row.status)) return null;
                const incident = await trx('reader_incidents').where('id', row.incident_id).first();
                if (!incident || incident.status === 'disabled' || !monitors().some(m => m.keyId === incident.key_id) || (row.kind === 'outage' && incident.status !== 'open')) {
                    await trx('reader_deliveries').where('id', row.id).update({ status: 'cancelled', updated_at: clock() });
                    return null;
                }
                const history = await trx('reader_deliveries').where({ incident_id: incident.id, kind: 'outage' });
                if (row.kind === 'recovery' && history.some(d => d.target === row.target && d.status === 'sending')) return null;
                await trx('reader_deliveries').where('id', row.id).update({ status: 'sending', attempts: row.attempts + 1, updated_at: clock() });
                return { row, incident, history };
            }));
            if (!job) continue;
            let failure = false;
            let missing = false;
            try {
                const d = await destination(job.row.target);
                if (!d) missing = true;
                else await send(conf, d, message(job.incident, job.row.kind, job.history));
            } catch (_) { failure = true; }
            const attempts = job.row.attempts + 1;
            await serial(() => db.transaction(async trx => {
                const incident = await trx('reader_incidents').where('id', job.incident.id).first();
                const stale = incident.status === 'disabled' || (job.row.kind === 'outage' && incident.status !== 'open');
                await trx('reader_deliveries').where('id', job.row.id).update({
                    status: missing ? 'cancelled' : !failure ? 'sent' : stale ? 'cancelled' : attempts >= 6 ? 'failed' : 'pending',
                    next_attempt: clock() + Math.min(3600, 60 * Math.pow(2, attempts - 1)), updated_at: clock(),
                    error: missing ? 'Destination no longer exists' : failure ? 'Delivery failed; check credentials, connectivity and provider limits' : null
                });
            }));
            if (failure) logger.main.warn('Reader health: notification delivery failed (credentials redacted)');
        }
    }
    async function tick() {
        // Checking must continue every minute even if a previous tick is still
        // delivering to slow providers. Only the delivery worker is singleton.
        try {
            for (const [keyId, receivedAt] of Array.from(failedReceipts)) await record(keyId, receivedAt);
            // Do not infer reader failure from a timestamp we know is stale.
            if (failedReceipts.size) return;
            await check();
            if (!failedReceipts.size) error = null;
        } catch (_) { fail(); return; }
        if (working) return;
        working = true;
        try { await deliver(); } catch (_) { fail(); }
        finally { working = false; }
    }
    async function sync() {
        await serial(() => db.transaction(trx => reconcile(trx, clock())));
    }
    async function status() {
        try {
            return {
                error, monitors: await db('reader_health').select('*'),
                incidents: await db('reader_incidents').orderBy('detected_at', 'desc').limit(100),
                deliveries: await db('reader_deliveries').orderBy('updated_at', 'desc').limit(200)
            };
        } catch (_) { fail(); return { error, monitors: [], incidents: [], deliveries: [] }; }
    }
    async function test(id) {
        const d = settings().destinations.find(d => d.id === id);
        if (!d) throw new Error('Save a valid destination first');
        const msg = { title: (conf.get('global:monitorName') || 'PagerMon') + ' — Reader health test', text: 'Test notification only. No reader or incident state was changed.' };
        if (d.type === 'email') {
            const users = await db('users').whereIn('id', d.userIds).select('email');
            if (!users.length) throw new Error('No recipients');
            for (const email of new Set(users.map(u => u.email))) await send(conf, { type: 'email', email }, msg);
        } else await send(conf, d, msg);
    }
    return { record, tick, sync, status, test, reportError: fail };
}
let singleton;
function instance() {
    if (!singleton) singleton = create(require('../knex/knex'), require('nconf'));
    return singleton;
}
module.exports = { create, instance };
