process.env.NODE_ENV = 'test';

const chai = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const knex = require('knex');
const importer = require('../lib/importer');

const should = chai.should();

function sqlite(file) {
  return knex({ client: 'sqlite3', connection: { filename: file }, useNullAsDefault: true });
}

async function createSchema(db) {
  await db.schema.createTable('systems', table => {
    table.increments('id').primary();
    table.string('name');
    table.string('label');
    table.string('color');
    table.integer('enabled');
    table.integer('is_default');
    table.integer('sortorder');
  });
  await db.schema.createTable('capcodes', table => {
    table.increments('id').primary();
    table.string('address');
    table.text('alias');
    table.text('agency');
    table.text('icon');
    table.text('color');
    table.text('pluginconf');
    table.integer('ignore');
    table.integer('system_id');
  });
  await db.schema.createTable('messages', table => {
    table.increments('id').primary();
    table.string('address');
    table.text('message');
    table.text('source');
    table.integer('timestamp');
    table.integer('alias_id');
    table.integer('system_id');
  });
  await db.schema.createTable('users', table => {
    table.increments('id').primary();
    table.string('givenname');
    table.string('surname');
    table.string('username');
    table.string('password');
    table.string('email');
    table.string('role');
    table.string('status');
    table.datetime('lastlogondate');
  });
}

describe('importer', function () {
  let dir;
  let sourceFile;
  let targetFile;
  let source;
  let target;

  beforeEach(async function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pagermon-import-'));
    sourceFile = path.join(dir, 'source.db');
    targetFile = path.join(dir, 'target.db');
    source = sqlite(sourceFile);
    target = sqlite(targetFile);
    await createSchema(source);
    await createSchema(target);
    await target('systems').insert({ name: 'Default', label: 'Default', enabled: 1, is_default: 1, sortorder: 0 });
    await target('users').insert({ givenname: 'Target', surname: 'User', username: 'targetuser', password: 'targethash', email: 'same@example.com', role: 'admin', status: 'active' });
    await source('users').insert({ givenname: 'Source', surname: 'User', username: 'sourceuser', password: 'sourcehash', email: 'same@example.com', role: 'user', status: 'active' });
    await source('capcodes').insert({ address: '0001000', alias: 'Source Alias', agency: 'SRC', icon: 'fire', color: 'red', pluginconf: '{"ok":true}', ignore: 0 });
    await source('capcodes').insert({ address: '013044_', alias: 'Wildcard', agency: 'SRC', icon: 'star', color: 'blue', ignore: 0 });
    await source('messages').insert({ address: '0001000', message: 'imported message', source: 'reader', timestamp: 100, alias_id: 1 });
    await source('messages').insert({ address: '9999999', message: 'unmatched message', source: 'reader', timestamp: 101, alias_id: null });
  });

  afterEach(async function () {
    await source.destroy();
    await target.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('plans user merges by email', async function () {
    const plan = await importer.generatePlan({ source: sourceFile, system: 'York', targetDb: target });
    plan.counts.capcodes.should.equal(2);
    plan.counts.messages.should.equal(2);
    plan.users[0].action.should.equal('merge');
    plan.users[0].into.should.equal('targetuser');
    plan.users[0].matchedOn.should.equal('email');
  });

  it('blocks apply while users require review', async function () {
    await source('users').where('id', 1).update({ username: 'targetuser', email: 'different@example.com' });
    const plan = await importer.generatePlan({ source: sourceFile, system: 'York', targetDb: target });
    plan.users[0].action.should.equal('REVIEW');
    try {
      await importer.applyPlan(plan, { targetDb: target });
      throw new Error('apply should have failed');
    } catch (err) {
      err.message.should.contain('users require review');
    }
  });

  it('dry-run imports everything then rolls back', async function () {
    const plan = await importer.generatePlan({ source: sourceFile, system: 'York', targetDb: target });
    const summary = await importer.applyPlan(plan, { targetDb: target, dryRun: true });
    summary.dryRun.should.equal(true);
    summary.capcodesInserted.should.equal(2);
    summary.messagesInserted.should.equal(2);
    const messages = await target('messages').count('id as count').first();
    Number(messages.count).should.equal(0);
  });

  it('applies imports with remapped aliases, system ids, wildcards and unmatched messages', async function () {
    const plan = await importer.generatePlan({ source: sourceFile, system: 'York', targetDb: target });
    const summary = await importer.applyPlan(plan, { targetDb: target });
    summary.system.name.should.equal('York');
    summary.capcodesInserted.should.equal(2);
    summary.messagesInserted.should.equal(2);

    const system = await target('systems').where('name', 'York').first();
    const wildcard = await target('capcodes').where({ system_id: system.id, address: '013044_' }).first();
    should.exist(wildcard);
    const importedAlias = await target('capcodes').where({ system_id: system.id, address: '0001000' }).first();
    const matched = await target('messages').where({ address: '0001000' }).first();
    matched.system_id.should.equal(system.id);
    matched.alias_id.should.equal(importedAlias.id);
    const unmatched = await target('messages').where({ address: '9999999' }).first();
    unmatched.system_id.should.equal(system.id);
    should.equal(unmatched.alias_id, null);
  });

  it('is re-runnable and rejects changed sources', async function () {
    const plan = await importer.generatePlan({ source: sourceFile, system: 'York', targetDb: target });
    await importer.applyPlan(plan, { targetDb: target });
    const second = await importer.applyPlan(plan, { targetDb: target });
    second.capcodesSkipped.should.equal(2);
    second.messagesSkipped.should.equal(2);

    await source('messages').insert({ address: '0001000', message: 'changed source', source: 'reader', timestamp: 102, alias_id: 1 });
    try {
      await importer.applyPlan(plan, { targetDb: target });
      throw new Error('apply should have failed');
    } catch (err) {
      err.message.should.contain('fingerprint changed');
    }
  });
});
