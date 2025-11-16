/* eslint-disable global-require, import/no-dynamic-require */
const fs = require('fs');
const nconf = require('nconf');
const util = require('util');

const confFile = './config/config.json';
nconf.file({ file: confFile });
nconf.load();
const logger = require('../log');

function handle(trigger, scope, data, callback) {
    const plugins = nconf.get('plugins');
    logger.main.debug('======================');
    logger.main.debug(`trigger: ${trigger} scope: ${scope}`);
    logger.main.debug('======================');
    logger.main.debug('data object');
    logger.main.debug(util.format('%o', data));
    logger.main.debug('plugins object');
    logger.main.debug(util.format('%o', plugins));
    logger.main.debug('======================');

    const pluginKeys = Object.keys(plugins || {});
    if (pluginKeys.length === 0) {
        logger.main.debug('No plugins configured');
        return callback(data);
    }

    const arr = pluginKeys.map((key) => ({ plugin: key, config: plugins[key] }));

    const promises = arr.map(
        (item) =>
            new Promise((resolve) => {
                const { plugin, config } = item;
                logger.main.debug('======================');
                logger.main.debug(`plugin: ${plugin}`);
                // note: fs is relative to the process working directory, not this file
                if (!config.enable) resolve('Plugin not enabled');

                if (fs.existsSync(`./plugins/${plugin}.json`) && fs.existsSync(`./plugins/${plugin}.js`)) {
                    const pConfig = require(`./${plugin}.json`);
                    // check scope
                    if (pConfig.trigger === trigger && pConfig.scope === scope && !pConfig.disable) {
                        logger.main.debug('RUNNING PLUGIN!');
                        const pRun = require(`./${plugin}`);
                        pRun.run(trigger, scope, data, config, (response, error) => {
                            if (error) logger.main.error(error);
                            // eslint-disable-next-line no-param-reassign
                            if (response) data = response;
                            resolve();
                        });
                    } else {
                        logger.main.debug('Plugin does not run in this scope');
                        resolve();
                    }
                } else {
                    logger.main.error(`Invalid plugin ${plugin} - could not find json or js file`);
                    resolve();
                }
            })
    );

    Promise.allSettled(promises)
        .then(() => {
            callback(data);
        })
        .catch((err) => {
            logger.main.error(`Plugin handler error: ${err}`);
            callback(data);
        });
}

module.exports = {
    handle,
};
