const assert = require('assert');
const util = require('util');
const nconf = require('nconf');
const { Writable } = require('stream');
const winston = require('winston');
const redact = require('../lib/redact');
const logger = require('../log');

const M = redact.MASK;
const WEBHOOK = 'https://discord.com/api/webhooks/1259392693369569300/3cmkeCoUjp8fN7RCfPPzEmZEcFvtX8kmAMuHQiqkam';
const BCRYPT = '$2a$10$' + 'N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

describe('Log redaction', function () {
    describe('object()', function () {
        it('masks credentials in plugin config and alias pluginconf without touching the original', function () {
            const plugins = {
                SMTP: { enable: true, server: 'smtp.example.com', username: 'me@example.com', password: 'hunter2hunter2' },
                Pushover: { enable: true, pushAPIKEY: 'aqtsx6vhsgn92a3pjtmp' },
                Telegram: { teleAPIKEY: '123456:ABCDEF' }
            };
            const out = redact.object(plugins);
            assert.equal(out.SMTP.password, M);
            assert.equal(out.Pushover.pushAPIKEY, M);
            assert.equal(out.Telegram.teleAPIKEY, M);
            assert.equal(out.SMTP.server, 'smtp.example.com');
            assert.equal(out.SMTP.username, 'me@example.com');
            assert.equal(out.SMTP.enable, true);
            assert.equal(plugins.SMTP.password, 'hunter2hunter2');
        });

        it('masks per-alias keys and recipients, keeping only the host of webhook URLs', function () {
            const out = redact.object({
                pluginconf: {
                    Discord: { enable: true, webhook: WEBHOOK },
                    Pushover: { enable: true, group: 'gfkv32utfnrgzybwsf67', sound: { value: 'pushover' } },
                    SMTP: { enable: true, mailto: 'abc123@pomail.net' },
                    Slack: { bottoken: 'xoxb-1-2-3' }
                }
            });
            assert.equal(out.pluginconf.Discord.webhook, 'https://discord.com/' + M);
            assert.equal(out.pluginconf.Pushover.group, M);
            assert.equal(out.pluginconf.Pushover.sound.value, 'pushover');
            assert.equal(out.pluginconf.SMTP.mailto, M);
            assert.equal(out.pluginconf.Slack.bottoken, M);
        });

        it('leaves look-alike settings that are not credentials alone', function () {
            const out = redact.object({
                keyId: 'b08903e1', passwordReset: true, minPasswordLength: 10, siteUrl: 'https://x.example',
                system: 'Dauphin', password: '', auth: { keys: [{ name: 'CUMB', key: 'abcdef123456', id: 'u-1' }] }
            });
            assert.equal(out.keyId, 'b08903e1');
            assert.equal(out.passwordReset, true);
            assert.equal(out.minPasswordLength, 10);
            assert.equal(out.siteUrl, 'https://x.example');
            assert.equal(out.system, 'Dauphin');
            assert.equal(out.password, '');
            assert.equal(out.auth.keys[0].key, M);
            assert.equal(out.auth.keys[0].name, 'CUMB');
        });

        it('passes non-objects through and survives cycles', function () {
            assert.equal(redact.object('request body empty'), 'request body empty');
            assert.equal(redact.object(undefined), undefined);
            const a = { password: 'secretsecret' }; a.self = a;
            assert.equal(redact.object(a).self.password, M);
        });
    });

    it('query() redacts pluginconf JSON bound into a knex statement', function () {
        const msg = { method: 'update', sql: 'update `capcodes` set `pluginconf` = ?', bindings: ['66', JSON.stringify({ Discord: { webhook: WEBHOOK } })] };
        const out = JSON.stringify(redact.query(msg));
        assert(!out.includes('3cmkeCoUjp8f'), out);
        assert(out.includes('66'));
        assert.equal(msg.bindings[1].includes('3cmkeCoUjp8f'), true);
    });

    describe('scrub()', function () {
        it('masks secret fields as util.inspect, JSON and escaped JSON print them', function () {
            const inspected = util.format('%o', { SMTP: { password: 'baz*xud2kwg.HBH-yje' } });
            const json = JSON.stringify({ pushAPIKEY: 'aqtsx6vhsgn92a3pjtmp', name: 'ok' });
            const nested = JSON.stringify({ bindings: [JSON.stringify({ SMTP: { mailto: 'abc123@pomail.net' } })] });
            for (const [text, secret] of [[inspected, 'baz*xud2kwg'], [json, 'aqtsx6vhsgn9'], [nested, 'abc123@pomail']]) {
                const out = redact.scrub(text);
                assert(!out.includes(secret), out);
                assert(out.includes(M), out);
            }
            assert(redact.scrub(json).includes('"name":"ok"'));
        });

        it('masks secrets that have a recognisable format anywhere in a line', function () {
            const out = redact.scrub(`hash ${BCRYPT} hook ${WEBHOOK} bot 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawE ` +
                '"GET /auth/reset-password/Zk3j-9_xYt HTTP/1.1" POST /x?token=abc&y=1');
            for (const s of ['N9qo8uLOick', '3cmkeCoUjp8f', 'AAHdqTcvCH1v', 'Zk3j-9_xYt', 'token=abc']) {
                assert(!out.includes(s), `${s} in ${out}`);
            }
            assert(out.includes('https://discord.com/api/webhooks/' + M));
            assert(out.includes('/auth/reset-password/' + M));
            assert(out.includes('&y=1'));
        });

        it('masks any value currently held in a secret config field', function () {
            const before = nconf.get('plugins:SMTP:password');
            nconf.set('plugins:SMTP:password', 'plain-text-in-an-error');
            redact.resetCache();
            try {
                assert.equal(redact.scrub('SMTP:Error: Invalid login for plain-text-in-an-error'), 'SMTP:Error: Invalid login for ' + M);
            } finally {
                nconf.set('plugins:SMTP:password', before);
                redact.resetCache();
            }
        });

        it('leaves ordinary message traffic alone', function () {
            const line = 'Box:29-3 Loc:36 JACOBS CHURCH RD WYT DAUP Class:3#:F20260011076 at 20:23:52 key_id 2cdb815b';
            assert.equal(redact.scrub(line), line);
        });
    });

    it('is applied by the logger itself, at every level', function () {
        let written = '';
        const sink = new winston.transports.Stream({
            level: 'silly',
            stream: new Writable({ write(chunk, enc, cb) { written += chunk; cb(); } })
        });
        const wasSilent = logger.main.silent;
        logger.main.silent = false;
        logger.main.add(sink);
        try {
            for (const level of ['error', 'warn', 'info', 'debug']) {
                logger.main[level](util.format('%o', { Pushover: { pushAPIKEY: 'leaky-' + level + '-key' } }));
            }
            logger.main.error(new Error('failed posting to ' + WEBHOOK));
        } finally {
            logger.main.remove(sink);
            logger.main.silent = wasSilent;
        }
        assert(written.length > 0);
        assert(!/leaky-\w+-key/.test(written), written);
        assert(!written.includes('3cmkeCoUjp8f'), written);
    });
});
