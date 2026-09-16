exports.up = function (db, Promise) {
  return db.schema.hasTable('import_jobs').then(function (exists) {
    if (exists) return Promise.resolve('Not Required');
    return db.schema.createTable('import_jobs', table => {
      table.charset('utf8');
      table.collate('utf8_general_ci');
      table.increments('id').primary().notNullable();
      table.string('status', 32).notNullable().defaultTo('analyzed');
      table.string('source_path', 1024).notNullable();
      table.string('target_system_name', 64).notNullable();
      table.text('plan_json').notNullable();
      table.text('progress_json');
      table.text('summary_json');
      table.text('error');
      table.datetime('created_at');
      table.datetime('updated_at');
      table.datetime('started_at');
      table.datetime('finished_at');
    });
  });
};

exports.down = function (db, Promise) {
  return db.schema.dropTableIfExists('import_jobs');
};
