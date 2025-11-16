const Telegram = require('telegram-bot-api');
const util = require('util');
const logger = require('../log');

function run(trigger, scope, data, config, callback) {
    const tConf = data.pluginconf.Telegram;
    if (tConf && tConf.enable) {
        const telekey = config.teleAPIKEY;
        const t = new Telegram({
            token: telekey,
        });
        if (tConf.chat === 0 || !tConf.chat) {
            logger.main.error(`Telegram: ${data.address} No ChatID key set. Please enter ChatID.`);
            callback();
        } else {
            // Notification formatted in Markdown for pretty notifications
            const notificationText =
                `<b>${escapeTelegramHTML(data.agency)} - ${escapeTelegramHTML(data.alias)}</b>\n` +
                `Message: ${escapeTelegramHTML(data.message)}`;

            t.sendMessage({
                chat_id: tConf.chat,
                text: notificationText,
                parse_mode: 'HTML',
            })
                .then((d) => {
                    logger.main.debug(`Telegram: ${util.inspect(d, false, null)}`);
                    callback();
                })
                .catch((err) => {
                    logger.main.error(`Telegram: ${err}`);
                    callback();
                });
        }
    } else {
        callback();
    }
}

function escapeTelegramHTML(string) {
    return string.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = {
    run,
};
