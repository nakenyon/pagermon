process.env.NODE_ENV = 'test';

// The acceptance tests for multi-system support.
//
// The premise of the whole feature is that a CAPCODE address is only unique
// within a paging system: address 0001000 is "West York" on one network and
// "Life Team EMS" on another. Before this, capcodes.address was matched
// globally, so one of those two silently won for every message. Everything here
// is a regression test against that returning.

const chai = require('chai');

const should = chai.should();
const chaiHttp = require('chai-http');

chai.use(chaiHttp);

const confFile = './config/config.json';
const nconf = require('nconf');

nconf.file({ file: confFile });
nconf.load();

const passportStub = require('passport-stub');
// eslint-disable-next-line vars-on-top
var server = require('../app');
const db = require('../knex/knex.js');
const systems = require('../lib/systems');
const refreshAliasIds = require('../lib/aliasrefresh');

passportStub.install(server);

// Keys used by these tests. Written into the live test config in before(), and
// removed again afterwards, so the rest of the suite sees the config it expects.
const KEY_A = 'multisystem-key-system-a';
const KEY_B = 'multisystem-key-system-b';
const KEY_SHARED = 'multisystem-key-shared';
const KEY_NOSYSTEM = 'multisystem-key-no-system';

let originalKeys;
let originalDupeFiltering;

before(() => {
        originalKeys = nconf.get('auth:keys') || [];
        originalDupeFiltering = nconf.get('messages:duplicateFiltering');
});

after(() => {
        nconf.set('auth:keys', originalKeys);
        nconf.set('messages:duplicateFiltering', originalDupeFiltering);
        nconf.save();
});

// Every test file's root-level hooks run for every test in the whole suite, in
// file-load order - so a file loaded after this one re-runs the schema rollback
// and reseed, destroying anything set up in a root hook here. Both the config
// keys and the fixture rows therefore live in a describe-scoped hook, which
// mocha runs after all root-level hooks.
function installTestKeys() {
        const base = (originalKeys || []).filter(k => k.key !== KEY_A && k.key !== KEY_B &&
                k.key !== KEY_SHARED && k.key !== KEY_NOSYSTEM);
        nconf.set('auth:keys', base.concat([
                { name: 'system-a-reader', key: KEY_A, system: 'Default' },
                { name: 'system-b-reader', key: KEY_B, system: 'Second' },
                {
                        name: 'shared-reader',
                        key: KEY_SHARED,
                        system: 'Default',
                        allowSourceOverride: true,
                        systems: ['Default', 'Second'],
                },
                // Deliberately has no `system`: this is the state every API key
                // in every existing install is in immediately after the
                // migration and before anyone edits config.json.
                { name: 'legacy-reader', key: KEY_NOSYSTEM },
        ]));
        nconf.save();
}

// Schema and base fixtures, matching the convention in the other test files.
// When this file runs alongside others, the last file's copy of this hook wins;
// the describe-scoped fixture below then runs after all of them.
beforeEach(() => db.migrate.rollback().then(() => db.migrate.latest()).then(() => db.seed.run()));

function installFixture() {
        installTestKeys();
        // The seed may not have run since the last rollback if another file's
        // hooks reset the schema after this file's, so make sure the systems
        // exist before inserting capcodes against them.
        return db('systems').count('id as count').then(rows => {
                const count = Number(rows[0].count || 0);
                if (count) return null;
                return db.seed.run();
        })
        // The colliding capcode that gives the feature its reason to exist:
        // the same address in both systems, with different agency and alias.
        .then(() => db('capcodes').insert([
                {
                        address: '0001000',
                        alias: 'West York',
                        agency: '1-FIRE',
                        icon: 'fire',
                        color: 'red',
                        ignore: 0,
                        system_id: 1,
                },
                {
                        address: '0001000',
                        alias: 'Life Team EMS',
                        agency: '1-EMS',
                        icon: 'ambulance',
                        color: 'green',
                        ignore: 0,
                        system_id: 2,
                },
                // Wildcard: '_' is a LIKE wildcard, not a literal.
                {
                        address: '013044_',
                        alias: 'Wildcard Station',
                        agency: 'CUMB',
                        icon: 'fire',
                        color: 'blue',
                        ignore: 0,
                        system_id: 2,
                },
        ]));
}

afterEach(() => db.migrate.rollback().then(() => passportStub.logout()));

function post(key, body) {
        return chai
                .request(server)
                .post('/api/messages')
                .set({ 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'CI-Test', apikey: key })
                .send(body);
}

// The stored message joined to the capcode it resolved to.
function storedMessage(id) {
        return db('messages')
                .leftJoin('capcodes', 'capcodes.id', '=', 'messages.alias_id')
                .select('messages.id', 'messages.address', 'messages.system_id', 'messages.alias_id',
                        'capcodes.alias', 'capcodes.agency')
                .where('messages.id', id)
                .first();
}

describe('Multi-system support', () => {
        beforeEach(() => installFixture());

describe('Multi-system ingest', () => {
        it('resolves the same capcode to each system\'s own alias', async () => {
                const resA = await post(KEY_A, {
                        address: '0001000', message: 'Structure fire', datetime: 1700000001, source: 'reader-a',
                });
                resA.status.should.eql(200);
                const resB = await post(KEY_B, {
                        address: '0001000', message: 'Medical call', datetime: 1700000002, source: 'reader-b',
                });
                resB.status.should.eql(200);

                const a = await storedMessage(Number(resA.text));
                const b = await storedMessage(Number(resB.text));

                // This is the whole point of the project.
                a.system_id.should.eql(1);
                a.alias.should.eql('West York');
                a.agency.should.eql('1-FIRE');

                b.system_id.should.eql(2);
                b.alias.should.eql('Life Team EMS');
                b.agency.should.eql('1-EMS');
        });

        it('stores an identical message from two systems as two messages', async () => {
                nconf.set('messages:duplicateFiltering', true);
                nconf.set('messages:duplicateLimit', 25);
                nconf.set('messages:duplicateTime', 300);
                nconf.save();

                const body = { address: '0001000', message: 'IDENTICAL TEXT', datetime: 1700000010 };
                const resA = await post(KEY_A, Object.assign({}, body, { source: 'reader-a' }));
                const resB = await post(KEY_B, Object.assign({}, body, { source: 'reader-b' }));

                // Both must be stored: they are two real pages on two networks
                // that happen to read the same, not a duplicate.
                const rows = await db('messages').where('message', 'IDENTICAL TEXT').select('system_id');
                rows.length.should.eql(2);
                rows.map(r => r.system_id).sort().should.eql([1, 2]);

                // ...and a genuine duplicate within one system is still dropped.
                const dupe = await post(KEY_A, Object.assign({}, body, { source: 'reader-a' }));
                dupe.text.should.eql('Ignoring duplicate');
                const after = await db('messages').where('message', 'IDENTICAL TEXT').select('id');
                after.length.should.eql(2);

                should.exist(resA);
                should.exist(resB);
                nconf.set('messages:duplicateFiltering', originalDupeFiltering);
                nconf.save();
        });

        it('stores unmatched traffic against the posting system', async () => {
                const res = await post(KEY_B, {
                        address: '9999999', message: 'No capcode for this', datetime: 1700000020, source: 'reader-b',
                });
                const row = await storedMessage(Number(res.text));
                // Unmatched traffic is real, and is exactly what an operator
                // looks at when onboarding a system - so it has to stay
                // attributable even with no alias.
                should.not.exist(row.alias_id);
                row.system_id.should.eql(2);
        });

        it('still matches wildcard capcodes within a system', async () => {
                const res = await post(KEY_B, {
                        address: '0130441', message: 'Wildcard match', datetime: 1700000030, source: 'reader-b',
                });
                const row = await storedMessage(Number(res.text));
                row.alias.should.eql('Wildcard Station');
                row.system_id.should.eql(2);
        });

        it('lands a key with no system configured in the default system', async () => {
                // The upgrade guarantee: an un-migrated config must not fail
                // ingest, and must not store a null system_id.
                const res = await post(KEY_NOSYSTEM, {
                        address: '0001000', message: 'Legacy reader', datetime: 1700000040, source: 'legacy',
                });
                res.status.should.eql(200);
                const row = await storedMessage(Number(res.text));
                row.system_id.should.eql(1);
                row.alias.should.eql('West York');
        });

        it('honours source override only for names the key permits', async () => {
                const override = await post(KEY_SHARED, {
                        address: '0001000', message: 'Routed by source', datetime: 1700000050, source: 'Second',
                });
                (await storedMessage(Number(override.text))).system_id.should.eql(2);

                // A source the key does not list falls back to the key's own
                // system rather than being honoured.
                const rejected = await post(KEY_SHARED, {
                        address: '0001000', message: 'Not permitted', datetime: 1700000051, source: 'Somewhere Else',
                });
                (await storedMessage(Number(rejected.text))).system_id.should.eql(1);
        });

        it('does not let a key without override select a system by source', async () => {
                const res = await post(KEY_A, {
                        address: '0001000', message: 'Trying to cross over', datetime: 1700000060, source: 'Second',
                });
                (await storedMessage(Number(res.text))).system_id.should.eql(1);
        });
});

describe('Multi-system alias refresh', () => {
        it('does not re-point another system\'s messages', async () => {
                await post(KEY_A, { address: '0001000', message: 'A message', datetime: 1700000100, source: 'a' });
                await post(KEY_B, { address: '0001000', message: 'B message', datetime: 1700000101, source: 'b' });

                const bCapcode = await db('capcodes').where({ address: '0001000', system_id: 2 }).first();

                // Edit system A's alias, then refresh everything.
                await db('capcodes').where({ address: '0001000', system_id: 1 }).update({ alias: 'West York Renamed' });
                await refreshAliasIds();

                const rows = await db('messages')
                        .leftJoin('capcodes', 'capcodes.id', '=', 'messages.alias_id')
                        .select('messages.system_id', 'capcodes.alias', 'messages.alias_id')
                        .whereIn('messages.message', ['A message', 'B message']);

                const a = rows.find(r => r.system_id === 1);
                const b = rows.find(r => r.system_id === 2);
                a.alias.should.eql('West York Renamed');
                // The damaging failure mode: B's messages silently re-pointed
                // at A's capcode.
                b.alias.should.eql('Life Team EMS');
                b.alias_id.should.eql(bCapcode.id);
        });

        it('limits a per-address refresh to the given system', async () => {
                // Distinct text per test: the duplicate-filter buffer is a
                // module global that outlives the per-test schema rollback, so
                // reusing a message body here would be dropped as a duplicate.
                await post(KEY_A, { address: '0001000', message: 'A scoped message', datetime: 1700000110, source: 'a' });
                await post(KEY_B, { address: '0001000', message: 'B scoped message', datetime: 1700000111, source: 'b' });

                // Break both messages' alias_id, then refresh system 1 only.
                await db('messages').whereIn('message', ['A scoped message', 'B scoped message']).update({ alias_id: null });
                await refreshAliasIds({ address: '0001000', systemId: 1 });

                const a = await db('messages').where('message', 'A scoped message').first();
                const b = await db('messages').where('message', 'B scoped message').first();
                should.exist(a.alias_id);
                should.not.exist(b.alias_id);
        });
});

describe('GET /api/capcodeCheck/:id', () => {
        it('does not report a cross-system address as a duplicate', done => {
                passportStub.login({ username: 'adminactive', password: 'changeme', role: 'admin' });
                chai.request(server)
                        // Session admin with no system named resolves to the
                        // default system, where 013044_ does not exist - it is
                        // system 2's capcode.
                        .get('/api/capcodeCheck/013044_')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                // An empty id means "free to use", which is what
                                // allows the same address in another system.
                                res.body.should.have.property('id').eql('');
                                done();
                        });
        });

        it('still reports a duplicate within the same system', done => {
                passportStub.login({ username: 'adminactive', password: 'changeme', role: 'admin' });
                chai.request(server)
                        .get('/api/capcodeCheck/013044_?system_id=2')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                res.body.should.have.property('alias').eql('Wildcard Station');
                                done();
                        });
        });
});

describe('Read path system filtering', () => {
        // Two messages in system 2 against the five the seed puts in system 1.
        beforeEach(() => db('messages').insert([
                {
                        address: '0001000', message: 'System two message one', source: 'reader-b',
                        timestamp: 1529495999, system_id: 2,
                },
                {
                        address: '0001000', message: 'System two message two', source: 'reader-b',
                        timestamp: 1529496000, system_id: 2,
                },
        ]));

        // Deliberately uses messages whose alias resolves, i.e. capcodes.ignore
        // is 0 rather than NULL. The list query ORs the ignore test, and an
        // ungrouped OR swallows the system filter for exactly these rows: a
        // fixture of unmatched messages passes while a real database does not.
        it('filters matched messages, not just unmatched ones', async () => {
                await db('messages').insert([
                        {
                                address: '1234567', message: 'Matched in system one', source: 'a',
                                timestamp: 1529496100, system_id: 1,
                                alias_id: (await db('capcodes').where({ address: '1234567', system_id: 1 }).first()).id,
                        },
                        {
                                address: '0001000', message: 'Matched in system two', source: 'b',
                                timestamp: 1529496101, system_id: 2,
                                alias_id: (await db('capcodes').where({ address: '0001000', system_id: 2 }).first()).id,
                        },
                ]);
                const res = await chai.request(server).get('/api/messages?system=2');
                res.status.should.eql(200);
                res.body.messages.every(m => m.system_id === 2).should.eql(true);
                // The count and the page must agree.
                res.body.messages.length.should.eql(res.body.init.msgCount);
        });

        it('filters GET /api/messages and keeps the count consistent', done => {
                chai.request(server)
                        .get('/api/messages?system=2')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                res.body.messages.length.should.eql(2);
                                res.body.messages.every(m => m.system_id === 2).should.eql(true);
                                // The count is computed by a separate query from
                                // the page; if the filter is missing from either,
                                // pagination describes a different result set.
                                res.body.init.msgCount.should.eql(2);
                                res.body.init.pageCount.should.eql(1);
                                done();
                        });
        });

        it('accepts several systems and returns all of them', done => {
                chai.request(server)
                        .get('/api/messages?system=1,2')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.body.init.msgCount.should.eql(7);
                                done();
                        });
        });

        it('returns every system when no filter is given', done => {
                chai.request(server)
                        .get('/api/messages')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.body.init.msgCount.should.eql(7);
                                done();
                        });
        });

        it('badges rows with their system', done => {
                chai.request(server)
                        .get('/api/messages?system=2')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.body.messages[0].should.have.property('system_name').eql('Second');
                                res.body.messages[0].should.have.property('system_color').eql('purple');
                                done();
                        });
        });

        it('filters the full-text search branch', done => {
                chai.request(server)
                        // 'message' matches seeded rows in both systems.
                        .get('/api/messageSearch?q=message&system=2')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                res.body.messages.length.should.be.above(0);
                                // No row from system 1 may leak through FTS.
                                res.body.messages.every(m => m.system_id === 2).should.eql(true);
                                done();
                        });
        });

        it('filters the structured search branch', done => {
                chai.request(server)
                        .get('/api/messageSearch?address=0001000&system=2')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.body.messages.every(m => m.system_id === 2).should.eql(true);
                                res.body.messages.length.should.eql(2);
                                done();
                        });
        });

        it('groups the address/source clause so agency still narrows it', done => {
                // Before the grouping fix this emitted
                //   address LIKE ? OR source = ? AND alias_id IN (...)
                // so the address matches came back whatever the agency was.
                chai.request(server)
                        .get('/api/messageSearch?address=1234567&agency=POLICE')
                        .end((err, res) => {
                                should.not.exist(err);
                                // Address 1234567 is FIRE, so pairing it with
                                // POLICE must return nothing.
                                res.body.messages.length.should.eql(0);
                                done();
                        });
        });
});

describe('/api/systems', () => {
        it('is readable by a plain user, not admin-only', done => {
                passportStub.login({ username: 'useractive', password: 'changeme', role: 'user' });
                chai.request(server)
                        .get('/api/systems')
                        .end((err, res) => {
                                should.not.exist(err);
                                res.status.should.eql(200);
                                res.body.should.be.a('array');
                                res.body.length.should.eql(2);
                                done();
                        });
        });

        it('refuses to delete a system that still has messages', async () => {
                await db('messages').insert({
                        address: '0001000', message: 'Still here', source: 'b', timestamp: 1529496001, system_id: 2,
                });
                passportStub.login({ username: 'adminactive', password: 'changeme', role: 'admin' });
                const res = await chai.request(server).delete('/api/systems/2');
                res.status.should.eql(400);
                // The row must survive: this guard is the only referential
                // integrity in the schema.
                should.exist(await db('systems').where('id', 2).first());
        });

        it('refuses to delete the default system', async () => {
                passportStub.login({ username: 'adminactive', password: 'changeme', role: 'admin' });
                const res = await chai.request(server).delete('/api/systems/1');
                res.status.should.eql(400);
                should.exist(await db('systems').where('id', 1).first());
        });

        it('deletes an empty non-default system', async () => {
                passportStub.login({ username: 'adminactive', password: 'changeme', role: 'admin' });
                await db('capcodes').where('system_id', 2).del();
                const res = await chai.request(server).delete('/api/systems/2');
                res.status.should.eql(200);
                should.not.exist(await db('systems').where('id', 2).first());
        });

        it('keeps exactly one default when a new one is set', async () => {
                passportStub.login({ username: 'adminactive', password: 'changeme', role: 'admin' });
                const res = await chai.request(server).post('/api/systems/2').send({
                        name: 'Second', label: 'Second System', is_default: 1,
                });
                res.status.should.eql(200);
                const defaults = await db('systems').where('is_default', 1);
                defaults.length.should.eql(1);
                defaults[0].id.should.eql(2);
        });

        it('rejects a duplicate system name', async () => {
                passportStub.login({ username: 'adminactive', password: 'changeme', role: 'admin' });
                const res = await chai.request(server).post('/api/systems').send({ name: 'Default' });
                res.status.should.eql(400);
        });
});

describe('Capcode admin with an API key', () => {
        // isAdmin accepts an API key, so capcode management can be scripted.
        // Those routes must honour an explicit system_id: resolving them the
        // way ingest does would force every alias into the key's own system,
        // silently writing to the wrong one - or failing on the unique index
        // if the address already existed there. Ingest itself must keep
        // ignoring the body, or a reader could write into any system.
        it('creates an alias in the system named in the request, not the key\'s', async () => {
                const res = await chai.request(server)
                        .post('/api/capcodes')
                        .set('apikey', KEY_A) // key's own system is 1
                        .send({ address: '0002000', alias: 'Across the way', agency: 'X', system_id: 2 });
                res.status.should.eql(200);
                const row = await db('capcodes').where('address', '0002000').first();
                row.system_id.should.eql(2);
        });

        it('allows the same address in a second system', async () => {
                // Exactly the collision the feature exists for: 0001000 already
                // exists in both systems from the fixture, so adding it again
                // to system 2 must fail, but a new address must not.
                const res = await chai.request(server)
                        .post('/api/capcodes')
                        .set('apikey', KEY_A)
                        .send({ address: '0003000', alias: 'In system two', agency: 'Y', system_id: 2 });
                res.status.should.eql(200);
                const res2 = await chai.request(server)
                        .post('/api/capcodes')
                        .set('apikey', KEY_B)
                        .send({ address: '0003000', alias: 'In system one', agency: 'Y', system_id: 1 });
                res2.status.should.eql(200);
                const rows = await db('capcodes').where('address', '0003000').orderBy('system_id');
                rows.length.should.eql(2);
                rows.map(r => r.system_id).should.eql([1, 2]);
        });

        it('still refuses to let a reader choose its own system at ingest', async () => {
                // Same body shape, message route: the key wins, body ignored.
                const res = await post(KEY_A, {
                        address: '0001000', message: 'Body says system two', datetime: 1700000200,
                        source: 'a', system_id: 2, system: 'Second',
                });
                const row = await storedMessage(Number(res.text));
                row.system_id.should.eql(1);
        });
});

describe('lib/systems', () => {
        it('parses a comma-separated system filter', () => {
                should.equal(systems.parseFilter(undefined), null);
                should.equal(systems.parseFilter(''), null);
                systems.parseFilter('1').should.eql([1]);
                systems.parseFilter('1,2').should.eql([1, 2]);
                systems.parseFilter(' 1 , 2 ').should.eql([1, 2]);
                // Garbage yields null - "apply no filter" - rather than an
                // empty list, which callers would turn into a whereIn that
                // matches nothing and an empty message list.
                should.equal(systems.parseFilter('nonsense'), null);
        });
});

});
