var fingerprint = require('./fingerprint');
var sourceDb = require('./sourceDb');

var DRY_RUN = new Error('PAGERMON_IMPORT_DRY_RUN_ROLLBACK');

function assertNoReview(plan) {
  var review = (plan.users || []).filter(function (user) { return user.action === 'REVIEW'; });
  if (review.length) throw new Error('Cannot apply import plan: ' + review.length + ' users require review');
}

function verifyFingerprint(plan) {
  return fingerprint.fingerprintFile(plan.source).then(function (fp) {
    if (fp !== plan.sourceFingerprint) {
      throw new Error('Source fingerprint changed; re-run plan before applying');
    }
  });
}

function getTargetSystem(trx, plan) {
  var target = plan.targetSystem || {};
  if (!target.name) throw new Error('Plan targetSystem.name is required');

  return trx('systems').where('name', target.name).first('*').then(function (row) {
    if (row) return row;
    if (target.create === false) throw new Error('Target system does not exist: ' + target.name);
    return trx('systems').insert({
      name: target.name,
      label: target.label || target.name,
      color: target.color || null,
      enabled: 1,
      is_default: 0,
      sortorder: target.sortorder || 0
    }).then(function () {
      return trx('systems').where('name', target.name).first('*');
    });
  });
}

function applyUsers(trx, source, plan, summary) {
  var actions = plan.users || [];
  if (!actions.length) return Promise.resolve({});

  return source('users').select('*').then(function (sourceUsers) {
    var byId = {};
    sourceUsers.forEach(function (user) { byId[user.id] = user; });

    var userIdMap = {};
    return actions.reduce(function (promise, action) {
      return promise.then(function () {
        var sourceUser = byId[action.sourceId];
        if (!sourceUser) return null;

        if (action.action === 'skip') {
          summary.usersSkipped += 1;
          return null;
        }

        if (action.action === 'merge') {
          if (!action.into) throw new Error('User merge for ' + action.source + ' does not name a target user');
          return trx('users').where('username', action.into).first('id').then(function (targetUser) {
            if (!targetUser) throw new Error('Merge target user does not exist: ' + action.into);
            userIdMap[sourceUser.id] = targetUser.id;
            summary.usersMerged += 1;
          });
        }

        if (action.action === 'create') {
          return trx('users').where(function () {
            this.where('username', sourceUser.username).orWhere('email', sourceUser.email);
          }).first('id', 'username', 'email').then(function (existing) {
            if (existing) throw new Error('Cannot create source user ' + sourceUser.username + ': username or email already exists');
            return trx('users').insert({
              givenname: sourceUser.givenname,
              surname: sourceUser.surname,
              username: sourceUser.username,
              password: sourceUser.password,
              email: sourceUser.email,
              role: sourceUser.role || 'user',
              status: sourceUser.status || 'disabled',
              lastlogondate: null
            });
          }).then(function () {
            return trx('users').where('username', sourceUser.username).first('id');
          }).then(function (created) {
            userIdMap[sourceUser.id] = created.id;
            summary.usersCreated += 1;
          });
        }

        throw new Error('Unsupported user action for ' + action.source + ': ' + action.action);
      });
    }, Promise.resolve()).then(function () { return userIdMap; });
  }).catch(function (err) {
    if (/no such table: users/i.test(err.message)) return {};
    throw err;
  });
}

function importCapcodes(trx, source, systemId, summary) {
  var map = {};
  return source('capcodes').select('*').then(function (rows) {
    return rows.reduce(function (promise, row) {
      return promise.then(function () {
        return trx('capcodes')
          .where({ system_id: systemId, address: row.address })
          .first('id')
          .then(function (existing) {
            if (existing) {
              map[row.id] = existing.id;
              summary.capcodesSkipped += 1;
              return null;
            }
            return trx('capcodes').insert({
              address: row.address,
              alias: row.alias,
              agency: row.agency,
              icon: row.icon,
              color: row.color,
              pluginconf: row.pluginconf,
              ignore: row.ignore || 0,
              system_id: systemId
            }).then(function () {
              return trx('capcodes').where({ system_id: systemId, address: row.address }).first('id');
            }).then(function (created) {
              map[row.id] = created.id;
              summary.capcodesInserted += 1;
            });
          });
      });
    }, Promise.resolve()).then(function () { return map; });
  });
}

function flushMessages(trx, pending, summary) {
  if (!pending.length) return Promise.resolve();
  var rows = pending.splice(0, pending.length);
  return trx('messages').insert(rows).then(function () {
    summary.messagesInserted += rows.length;
  });
}

function importMessages(trx, source, systemId, capcodeMap, summary, progress) {
  var pending = [];
  var processed = 0;
  return source('messages').select('*').then(function (rows) {
    return rows.reduce(function (promise, row) {
      return promise.then(function () {
        processed += 1;
        return trx('messages')
          .where({
            system_id: systemId,
            address: row.address,
            timestamp: row.timestamp,
            message: row.message
          })
          .first('id')
          .then(function (existing) {
            if (existing) {
              summary.messagesSkipped += 1;
              return null;
            }
            pending.push({
              address: row.address,
              message: row.message,
              source: row.source,
              timestamp: row.timestamp,
              alias_id: row.alias_id ? (capcodeMap[row.alias_id] || null) : null,
              system_id: systemId
            });
            if (progress && processed % 1000 === 0) progress({ processedMessages: processed, totalMessages: rows.length });
            if (pending.length >= 100) return flushMessages(trx, pending, summary);
            return null;
          });
      });
    }, Promise.resolve()).then(function () {
      return flushMessages(trx, pending, summary);
    });
  });
}

function applyPlan(plan, options) {
  options = options || {};
  if (!plan) return Promise.reject(new Error('plan is required'));
  if (!options.targetDb) return Promise.reject(new Error('targetDb is required'));
  assertNoReview(plan);

  var targetDb = options.targetDb;
  var source;
  var summary = {
    dryRun: !!options.dryRun,
    system: null,
    capcodesInserted: 0,
    capcodesSkipped: 0,
    messagesInserted: 0,
    messagesSkipped: 0,
    usersCreated: 0,
    usersMerged: 0,
    usersSkipped: 0
  };

  return verifyFingerprint(plan).then(function () {
    source = sourceDb.openSource(plan.source);
    return targetDb.transaction(function (trx) {
      return getTargetSystem(trx, plan).then(function (system) {
        summary.system = { id: system.id, name: system.name };
        return applyUsers(trx, source, plan, summary).then(function () {
          return importCapcodes(trx, source, system.id, summary);
        }).then(function (capcodeMap) {
          return importMessages(trx, source, system.id, capcodeMap, summary, options.progress);
        }).then(function () {
          if (options.dryRun) return Promise.reject(DRY_RUN);
          return summary;
        });
      });
    });
  }).catch(function (err) {
    if (err === DRY_RUN || err.message === DRY_RUN.message) return summary;
    throw err;
  }).finally(function () {
    return sourceDb.closeSource(source);
  });
}

module.exports = {
  applyPlan: applyPlan
};
