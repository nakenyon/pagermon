#!/usr/bin/env node

var fs = require('fs');
var path = require('path');

process.chdir(__dirname);

var importer = require('./lib/importer');
var targetDb = require('./knex/knex');

function usage() {
  console.error('Usage:');
  console.error('  node import-instance.js plan  --source /path/messages.db --system Name --out plan.json [--users none] [--label Label] [--color Color]');
  console.error('  node import-instance.js apply --plan plan.json [--dry-run]');
}

function parseArgs(argv) {
  var args = { _: [] };
  for (var i = 0; i < argv.length; i += 1) {
    var arg = argv[i];
    if (arg.indexOf('--') !== 0) {
      args._.push(arg);
    } else {
      var key = arg.substring(2);
      if (key === 'dry-run') {
        args.dryRun = true;
      } else {
        args[key] = argv[i + 1];
        i += 1;
      }
    }
  }
  return args;
}

function printSummary(summary) {
  console.log(JSON.stringify(summary, null, 2));
}

var args = parseArgs(process.argv.slice(2));
var command = args._[0];

var work;
if (command === 'plan') {
  if (!args.source || !args.system || !args.out) {
    usage();
    process.exit(2);
  }
  work = importer.generatePlan({
    targetDb: targetDb,
    source: args.source,
    system: args.system,
    label: args.label,
    color: args.color,
    users: args.users
  }).then(function (plan) {
    fs.writeFileSync(path.resolve(args.out), JSON.stringify(plan, null, 2) + '\n');
    console.log('Wrote import plan: ' + path.resolve(args.out));
    console.log('Capcodes: ' + plan.counts.capcodes + ', messages: ' + plan.counts.messages + ', users: ' + plan.counts.users);
    if (plan.warnings && plan.warnings.length) {
      console.log('Warnings:');
      plan.warnings.forEach(function (warning) { console.log('  - ' + warning); });
    }
  });
} else if (command === 'apply') {
  if (!args.plan) {
    usage();
    process.exit(2);
  }
  var plan = JSON.parse(fs.readFileSync(path.resolve(args.plan), 'utf8'));
  work = importer.applyPlan(plan, {
    targetDb: targetDb,
    dryRun: !!args.dryRun,
    progress: function (state) {
      if (state.processedMessages) console.error('Processed messages: ' + state.processedMessages + '/' + state.totalMessages);
    }
  }).then(printSummary);
} else {
  usage();
  process.exit(2);
}

work.then(function () {
  return targetDb.destroy();
}).then(function () {
  process.exit(0);
}).catch(function (err) {
  console.error(err.stack || err.message || err);
  targetDb.destroy().then(function () {
    process.exit(1);
  });
});
