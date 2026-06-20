const { WebhookClient, EmbedBuilder } = require('discord.js');
const toHex = require('colornames');
const logger = require('../log');
const util = require('util');

function run(trigger, scope, data, config, callback) {
    const dConf = data.pluginconf.Discord;
    if (dConf && dConf.enable) {
        if (!dConf.webhook) {
            logger.main.error('Discord: ' + data.address + ' No Webhook URL set. Please enter Webhook URL.');
            return callback();
        }

        const hostname = process.env.HOSTNAME || '';
        const d = new WebhookClient({ url: dConf.webhook });

        const isHex = /^#[0-9A-F]{6}$/i.test(data.color);
        const discordcolor = (!isHex && data.color) ? toHex(data.color) : data.color;

        const notificationembed = new EmbedBuilder()
            .setTimestamp()
            .setColor(discordcolor)
            .setTitle(`${data.agency} - ${data.alias}`)
            .setDescription(`${data.message}`)
            .setAuthor(hostname
                ? { name: 'PagerMon', url: hostname }
                : { name: 'PagerMon', url: 'https://github.com/davidmckenzie/pagermon' }
            );

        logger.main.debug(util.format('%o', notificationembed));
        d.send({ embeds: [notificationembed] })
            .then(() => logger.main.info('Discord: Message Sent'))
            .catch(err => logger.main.error('Discord: ' + err))
            .finally(() => d.destroy());

        callback();
    } else {
        callback();
    }
}

module.exports = { run };
