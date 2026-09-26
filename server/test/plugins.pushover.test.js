const assert = require('assert');
const EventEmitter = require('events');
const https = require('https');
const pushover = require('../plugins/Pushover');

describe('Pushover plugin (no external traffic)', function () {
    let originalRequest, requests, response;
    beforeEach(function () {
        originalRequest = https.request;
        requests = []; response = { status: 1 };
        https.request = (options, callback) => {
            const req = new EventEmitter();
            let body = '';
            req.write = chunk => { body += chunk; };
            req.end = () => {
                requests.push({ options, body });
                process.nextTick(() => {
                    const res = new EventEmitter(); res.statusCode = 200;
                    callback(res); res.emit('data', JSON.stringify(response)); res.emit('end');
                });
            };
            return req;
        };
    });
    afterEach(function () { https.request = originalRequest; });

    const data = () => ({
        address: '0290000', message: 'Box:29-3 test', agency: '29-FIRE', alias: 'Test',
        pluginconf: { Pushover: { enable: true, group: 'group', priority: { value: '0' } } }
    });

    it('sends and calls back on success', function (done) {
        pushover.run('message', 'after', data(), { pushAPIKEY: 'app' }, function () {
            assert.equal(requests.length, 1);
            done();
        });
    });

    it('logs API errors instead of throwing an uncaughtException', function (done) {
        response = { status: 0, errors: ['group has no users or active devices in it'] };
        const listeners = process.listeners('uncaughtException');
        process.removeAllListeners('uncaughtException');
        let thrown;
        const trap = err => { thrown = err; };
        process.on('uncaughtException', trap);
        pushover.run('message', 'after', data(), { pushAPIKEY: 'app' }, function () {
            setImmediate(() => {
                process.removeListener('uncaughtException', trap);
                listeners.forEach(l => process.on('uncaughtException', l));
                assert.equal(thrown, undefined);
                done();
            });
        });
    });
});
