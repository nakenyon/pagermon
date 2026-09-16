var db = require('../knex/knex');

function activeImportJob() {
  return db.schema.hasTable('import_jobs').then(function (exists) {
    if (!exists) return null;
    return db('import_jobs').where('status', 'running').first('id', 'status', 'target_system_name', 'started_at');
  }).catch(function () {
    return null;
  });
}

function blockWritesDuringImport(req, res, next) {
  activeImportJob().then(function (job) {
    if (!job) return next();
    return res.status(503).json({
      status: 'maintenance',
      message: 'PagerMon is in import maintenance mode. Try again when the import completes.',
      job: job
    });
  }).catch(next);
}

module.exports = {
  activeImportJob: activeImportJob,
  blockWritesDuringImport: blockWritesDuringImport
};
