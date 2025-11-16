/*
Regex Replace
Allows matching and replacing
*/
const logger = require('../log');

function run(trigger, scope, data, config, callback) {
    if (config.regexReplaceMatchRegex) {
        if (data.message.match(new RegExp(config.regexReplaceMatchRegex))) {
            logger.main.info('RegexReplace: Found a match, replacing it');
            // eslint-disable-next-line no-param-reassign
            data.message = data.message.replace(new RegExp(config.regexReplaceMatchRegex), config.regexReplaceString);
            logger.main.debug(`RegexReplace: Message has change to: ${data.message}`);
        }
    }
    callback(data);
}

module.exports = {
    run,
};
