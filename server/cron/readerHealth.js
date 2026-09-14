const logger = require('../log');

async function schedule(conf) {
    // Upgrade config separately from schema migrations; never store a key secret
    // in SQL. IDs survive renames and rotation of the secret within a key entry.
    const keys = conf.get('auth:keys') || [];
    if (keys.some(k => !k.id)) {
        const settings = { auth: { keys } };
        require('../lib/readerhealthconfig').keyIds(settings);
        conf.set('auth:keys', settings.auth.keys);
        await new Promise((resolve, reject) => conf.save(err => err ? reject(err) : resolve()));
    }
    const health = require('../lib/readerhealth').instance();
    await health.sync();
    const CronJob = require('cron').CronJob;
    const job = new CronJob('0 * * * * *', () => health.tick(), null, true);
    health.tick(); // Delivery may be slow; do not delay scheduling future checks.
    logger.main.info('Reader health: minute checker scheduled (per-key opt-in)');
    return job;
}
module.exports = { schedule };
