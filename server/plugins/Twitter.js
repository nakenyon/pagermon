const Twitter = require('twit');
const logger = require('../log');

function run(trigger, scope, data, config, callback) {
    const tConf = data.pluginconf.Twitter;
    if (tConf && tConf.enable) {
        if (
            config.consKey === 0 ||
            !config.consKey ||
            config.consSecret === 0 ||
            !config.consSecret ||
            config.accToken === 0 ||
            !config.accToken ||
            config.accSecret === 0 ||
            !config.accSecret
        ) {
            logger.main.error(`Twitter: ${data.address} No API keys set. Please check API keys.`);
            callback();
        } else {
            const tw = new Twitter({
                consumer_key: config.consKey,
                consumer_secret: config.consSecret,
                access_token: config.accToken,
                access_token_secret: config.accSecret,
            });

            const twittertext =
                `${data.agency} - ${data.alias} \n` +
                `${data.message} \n` +
                `${tConf.hashtag} ${config.globalHashtags}`;

            if (twittertext.length > 280) {
                // Check if message > 280 Chars
                const twitterPayload = twittertext.match(/.{1,278}/g); // use regex to split allowing 2 spaces for the spacer
                const spacer = ' …'; // Space + unicode/U+2026
                twitterPayload.forEach((x) => {
                    // Iterate over message chunks
                    if (x === twitterPayload.length - 1) {
                        // If its the last message dont add spacer
                        tw.post(
                            'statuses/update',
                            {
                                status: twitterPayload[x],
                            },
                            (err) => {
                                if (err) {
                                    logger.main.error(`Twitter: ${err}`);
                                } else {
                                    logger.main.info('Twitter: Tweet Posted');
                                }
                                callback();
                            }
                        );
                    } else {
                        // If its not the last message add spacer
                        tw.post(
                            'statuses/update',
                            {
                                status: twitterPayload[x] + spacer,
                            },
                            (err) => {
                                if (err) {
                                    logger.main.error(`Twitter: ${err}`);
                                } else {
                                    logger.main.info('Twitter: Tweet Posted');
                                }
                                callback();
                            }
                        );
                    }
                });
            } else {
                // if not, post message
                tw.post(
                    'statuses/update',
                    {
                        status: twittertext,
                    },
                    (err) => {
                        if (err) {
                            logger.main.error(`Twitter: ${err}`);
                        } else {
                            logger.main.info('Twitter: Tweet Posted');
                        }
                        callback();
                    }
                );
            }
        }
    } else {
        callback();
    }
}

module.exports = {
    run,
};
