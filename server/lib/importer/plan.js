var path = require('path');
var fingerprint = require('./fingerprint');
var sourceDb = require('./sourceDb');
var userMatching = require('./userMatching');

function countRows(db, table) {
  return db(table).count('id as count').then(function (rows) {
    var row = rows && rows[0] ? rows[0] : {};
    return Number(row.count || row.COUNT || 0);
  });
}

function estimateDuplicateMessages(targetDb, systemId, messages) {
  var skipped = 0;
  return messages.reduce(function (promise, message) {
    return promise.then(function () {
      return targetDb('messages')
        .where({
          system_id: systemId,
          address: message.address,
          timestamp: message.timestamp,
          message: message.message
        })
        .first('id')
        .then(function (row) {
          if (row) skipped += 1;
        });
    });
  }, Promise.resolve()).then(function () { return skipped; });
}

function generatePlan(options) {
  if (!options || !options.source) return Promise.reject(new Error('source is required'));
  if (!options.system) return Promise.reject(new Error('system is required'));
  if (!options.targetDb) return Promise.reject(new Error('targetDb is required'));

  var targetDb = options.targetDb;
  var sourcePath = path.resolve(options.source);
  var source;
  var plan = {
    format: 'pagermon-import-plan-v1',
    source: sourcePath,
    generatedAt: new Date().toISOString(),
    targetSystem: {
      name: options.system,
      create: true,
      label: options.label || options.system,
      color: options.color || null
    },
    counts: {},
    users: [],
    warnings: []
  };

  return fingerprint.fingerprintFile(sourcePath).then(function (fp) {
    plan.sourceFingerprint = fp;
    source = sourceDb.openSource(sourcePath);
    return Promise.all([
      countRows(source, 'capcodes'),
      countRows(source, 'messages'),
      countRows(source, 'users').catch(function () { return 0; }),
      targetDb('systems').where('name', options.system).first('id', 'name', 'label', 'color')
    ]);
  }).then(function (values) {
    plan.counts.capcodes = values[0];
    plan.counts.messages = values[1];
    plan.counts.users = values[2];
    var existingSystem = values[3];
    if (existingSystem) {
      plan.targetSystem.create = false;
      plan.targetSystem.id = existingSystem.id;
      plan.targetSystem.label = existingSystem.label;
      plan.targetSystem.color = existingSystem.color;
    }

    var dupPromise = Promise.resolve(0);
    if (existingSystem) {
      dupPromise = source('messages')
        .select('address', 'timestamp', 'message')
        .then(function (messages) { return estimateDuplicateMessages(targetDb, existingSystem.id, messages); });
    }

    return Promise.all([
      source('users').select('*').catch(function () { return []; }),
      targetDb('users').select('*'),
      dupPromise
    ]);
  }).then(function (values) {
    var sourceUsers = values[0];
    var targetUsers = values[1];
    var skippedDuplicates = values[2];
    var userPlan = options.users === 'none' ? { users: [], warnings: ['User import disabled for this plan.'] } : userMatching.buildUserPlan(sourceUsers, targetUsers);

    plan.counts.skippedDuplicates = skippedDuplicates;
    plan.users = userPlan.users;
    plan.warnings = plan.warnings.concat(userPlan.warnings);
    if (plan.users.some(function (user) { return user.action === 'REVIEW'; })) {
      plan.warnings.push(plan.users.filter(function (user) { return user.action === 'REVIEW'; }).length + ' users require review before apply');
    }
    return plan;
  }).finally(function () {
    return sourceDb.closeSource(source);
  });
}

module.exports = {
  generatePlan: generatePlan
};
