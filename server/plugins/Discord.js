const discord = require('discord.js');
const toHex = require('colornames');
const util = require('util');
const logger = require('../log');

function run(trigger, scope, data, config, callback) {
    const dConf = data.pluginconf.Discord;
    if (dConf && dConf.enable) {
        // var hostname = nconf.get('hostname');
        const hostname = process.env.HOSTNAME || '';
        // Ensure webhook ID and Token have been entered into the alias.
        if (dConf.webhook === 0 || !dConf.webhook) {
            logger.main.error(`Discord: ${data.address} No Webhook URL set. Please enter Webhook URL.`);
            callback();
        } else {
            // we should probably not do this and take the id/token separately
            const webhook = dConf.webhook.split('/');
            const discwebhookid = webhook[5];
            const discwebhooktoken = webhook[6];

            const d = new discord.WebhookClient(discwebhookid, discwebhooktoken);

            // Use embedded discord notification format from discord.js
            const notificationembed = new discord.RichEmbed({
                timestamp: new Date(),
            });
            // toHex doesn't support putting HEX in, needs to check and skip over if already hex.
            const isHex = /^#[0-9A-F]{6}$/i.test(data.color);
            const discordcolor = isHex ? data.color : toHex(data.color);
            notificationembed.setColor(discordcolor);
            notificationembed.setTitle(`**${data.agency} - ${data.alias}**`);
            notificationembed.setDescription(`${data.message}`);
            if (hostname === undefined || !hostname) {
                logger.main.debug('Discord: Hostname not set in config file using pagermon github');
                notificationembed.setAuthor('PagerMon', '', `https://github.com/davidmckenzie/pagermon`);
            } else {
                notificationembed.setAuthor('PagerMon', '', `${hostname}`);
            }
            // Print notification template when debugging enabled
            logger.main.debug(util.format('%o', notificationembed));
            d.send(notificationembed)
                .then(logger.main.info(`Discord: Message Sent`))
                .catch((err) => {
                    `Discord: ${logger.main.error(err)}`;
                });
            callback();
        }
    } else {
        callback();
    }
}

module.exports = {
    run,
};
