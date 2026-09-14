const assert = require('assert');
const EventEmitter = require('events');
const https = require('https');
const mailer = require('../mail/mailer');
const notifications = require('../notifications/readerHealth');

describe('Reader health notification adapters (no external traffic)', function () {
    let originalRequest, originalMail, requests, response, status;
    beforeEach(function () {
        originalRequest = https.request; originalMail = mailer.send;
        requests = []; status = 200; response = { status: 1, ok: true };
        https.request = (url, options, callback) => {
            const req = new EventEmitter();
            req.destroy = err => { req.emit('error', err); req.emit('close'); };
            req.end = body => {
                requests.push({ url, options, body: JSON.parse(body) });
                process.nextTick(() => {
                    const res = new EventEmitter(); res.statusCode = status;
                    callback(res); res.emit('data', JSON.stringify(response)); res.emit('end'); req.emit('close');
                });
            };
            return req;
        };
    });
    afterEach(function () { https.request = originalRequest; mailer.send = originalMail; });
    const message = { title: 'PagerMon — Reader inactive', text: 'Quiet reader @everyone _plain text_' };
    it('uses transactional email without requiring a password-reset Site URL', async function () {
        mailer.send = async (conf, msg) => requests.push(msg);
        await notifications.send({}, { type: 'email', email: 'user@example.com' }, message);
        assert.equal(requests[0].to, 'user@example.com');
        assert.equal(requests[0].text, message.text);
    });
    it('sends normal-priority Pushover messages and checks API-level acceptance', async function () {
        const destination = { type: 'pushover', token: 'app', userKey: 'user' };
        await notifications.send({}, destination, message);
        assert.equal(requests[0].url, 'https://api.pushover.net/1/messages.json');
        assert.equal(requests[0].body.priority, 0);
        response = { status: 0 };
        await assert.rejects(notifications.send({}, destination, message), /Notification failed/);
    });
    it('sends Telegram as plain text with no markup parsing and checks ok', async function () {
        const destination = { type: 'telegram', token: '123:SECRET', chatId: '-456' };
        await notifications.send({}, destination, message);
        assert.equal(requests[0].body.chat_id, '-456');
        assert.equal(requests[0].body.parse_mode, undefined);
        assert(requests[0].body.text.includes('_plain text_'));
        response = { ok: false };
        await assert.rejects(notifications.send({}, destination, message), /Notification failed/);
    });
    it('waits for Discord acceptance and disables mentions', async function () {
        await notifications.send({}, { type: 'discord', webhook: 'https://discord.com/api/webhooks/123/SECRET' }, message);
        assert(requests[0].url.endsWith('?wait=true'));
        assert.deepEqual(requests[0].body.allowed_mentions, { parse: [] });
    });
    it('rejects arbitrary Discord URLs without issuing a request', async function () {
        await assert.rejects(notifications.send({}, { type: 'discord', webhook: 'http://localhost/admin' }, message));
        assert.equal(requests.length, 0);
    });
    it('does not follow redirects and exposes no provider secrets on errors', async function () {
        status = 302;
        await assert.rejects(notifications.send({}, { type: 'telegram', token: '123:SECRET', chatId: '12' }, message), err => {
            assert(!err.message.includes('SECRET')); return true;
        });
        assert.equal(requests.length, 1);
    });
    it('redacts SMTP transport errors', async function () {
        mailer.send = async () => { throw new Error('password=SECRET'); };
        await assert.rejects(notifications.send({}, { type: 'email', email: 'user@example.com' }, message), err => {
            assert(!err.message.includes('SECRET')); return true;
        });
    });
});
