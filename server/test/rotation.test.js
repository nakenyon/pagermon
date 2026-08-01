process.env.NODE_ENV = 'test';

const chai = require('chai');

const should = chai.should();

// Require the app before knex: on a fresh checkout (CI) config/config.json
// does not exist yet, and knexfile.js needs it to resolve the database client.
// app.js creates the config from defaults on load. Mocha loads this file
// before the routes.* files (alphabetical), so it cannot rely on them having
// done it.
require('../app');

const db = require('../knex/knex.js');
const rotation = require('../cron/messageRotation');

// purge() takes nconf as a parameter and only calls .get() on it, so the tests
// drive it with a stub rather than mutating the real config file.
function confStub(values) {
        return { get: key => values[key] };
}

const DAY = 24 * 60 * 60;
const now = Math.floor(Date.now() / 1000);

// horizon with days=7, keep=4 is 28 days
const enabledConf = confStub({
        'messages:rotationEnabled': true,
        'messages:rotateDays': 7,
        'messages:rotateKeep': 4,
});

function seedMessages() {
        // Start from an empty messages table: the shared seed data includes
        // messages with old timestamps, which would otherwise be purged too and
        // make the deleted-row counts nondeterministic.
        return db('messages').del().then(() => db('messages').insert([
                { address: '1111111', message: 'ancient message', source: 'TEST', timestamp: now - 40 * DAY },
                { address: '2222222', message: 'old message', source: 'TEST', timestamp: now - 29 * DAY },
                { address: '3333333', message: 'recent message', source: 'TEST', timestamp: now - 1 * DAY },
                { address: '4444444', message: 'fresh message', source: 'TEST', timestamp: now },
        ]));
}

beforeEach(() => db.migrate.rollback().then(() => db.migrate.latest()).then(() => db.seed.run()));

afterEach(() => db.migrate.rollback());

describe('message rotation purge', () => {
        it('deletes messages older than rotateDays * rotateKeep and keeps the rest', () =>
                seedMessages()
                        .then(() => rotation.purge(db, enabledConf))
                        .then(count => {
                                count.should.eql(2);
                                return db('messages').whereIn('address', ['1111111', '2222222', '3333333', '4444444']).select('address');
                        })
                        .then(rows => {
                                const addresses = rows.map(r => r.address).sort();
                                addresses.should.eql(['3333333', '4444444']);
                        }));

        it('deletes nothing when rotation is disabled', () =>
                seedMessages()
                        .then(() => rotation.purge(db, confStub({
                                'messages:rotationEnabled': false,
                                'messages:rotateDays': 7,
                                'messages:rotateKeep': 4,
                        })))
                        .then(count => {
                                count.should.eql(0);
                                return db('messages').whereIn('address', ['1111111', '2222222', '3333333', '4444444']).count('id as n').first();
                        })
                        .then(row => row.n.should.eql(4)));

        it('treats a legacy truthy-but-not-boolean flag as disabled', () =>
                // Old configs may carry strings or other truthy junk; only an
                // explicit boolean true - what the settings UI checkbox writes -
                // may destroy data.
                seedMessages()
                        .then(() => rotation.purge(db, confStub({
                                'messages:rotationEnabled': 'true',
                                'messages:rotateDays': 7,
                                'messages:rotateKeep': 4,
                        })))
                        .then(count => count.should.eql(0)));

        it('deletes nothing on invalid day/keep values', () => {
                const bads = [
                        { 'messages:rotationEnabled': true, 'messages:rotateDays': 0, 'messages:rotateKeep': 4 },
                        { 'messages:rotationEnabled': true, 'messages:rotateDays': 7, 'messages:rotateKeep': -1 },
                        { 'messages:rotationEnabled': true, 'messages:rotateDays': 'weekly', 'messages:rotateKeep': 4 },
                        { 'messages:rotationEnabled': true, 'messages:rotateDays': 7.5, 'messages:rotateKeep': 4 },
                        { 'messages:rotationEnabled': true },
                ];
                return seedMessages()
                        .then(() => Promise.all(bads.map(b => rotation.purge(db, confStub(b)))))
                        .then(counts => {
                                counts.forEach(c => c.should.eql(0));
                                return db('messages').whereIn('address', ['1111111', '2222222', '3333333', '4444444']).count('id as n').first();
                        })
                        .then(row => row.n.should.eql(4));
        });

        it('is idempotent - a second run deletes nothing further', () =>
                seedMessages()
                        .then(() => rotation.purge(db, enabledConf))
                        .then(() => rotation.purge(db, enabledConf))
                        .then(count => count.should.eql(0)));
});
