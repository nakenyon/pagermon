process.env.NODE_ENV = 'test';

const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const chai = require('chai');
const chaiHttp = require('chai-http');
const nconf = require('nconf');
const passportStub = require('passport-stub');

const server = require('../app');

chai.use(chaiHttp);
passportStub.install(server);

const THEMES = ['default', 'Dark', 'Compact Default', 'Compact Dark'];

// A request rejected by body-parser never reaches the routers that set the
// template locals, so this is the case that used to fall through to Express's
// bare "<pre>Bad Request</pre>".
function malformedLogin() {
    return chai.request(server)
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .send('{not json');
}

describe('Error page', function () {
    let savedGa;
    before(function () { savedGa = nconf.get('monitoring:gaEnable'); });
    afterEach(function () {
        nconf.set('monitoring:gaEnable', savedGa);
        passportStub.logout();
    });

    it('renders the themed page for an error raised before any router runs', async function () {
        const res = await malformedLogin();
        assert.equal(res.status, 400);
        assert.equal(res.type, 'text/html');
        assert(res.text.includes('id="error-body"'), res.text);
        // body-parser's own message, e.g. "Expected property name ... in JSON"
        assert(/<h1>[^<]*JSON[^<]*<\/h1>/.test(res.text), res.text);
    });

    it('renders for a logged-in user, whose menu reads user.role', async function () {
        passportStub.login({ id: 1, username: 'admin', role: 'admin' });
        const res = await malformedLogin();
        assert.equal(res.status, 400);
        assert(res.text.includes('id="error-body"'), res.text);
        assert(res.text.includes('admin'));
    });

    it('renders with Google Analytics enabled, which reads gaTrackingCode', async function () {
        nconf.set('monitoring:gaEnable', true);
        const res = await malformedLogin();
        assert.equal(res.status, 400);
        assert(res.text.includes('id="error-body"'), res.text);
    });

    // Belt and braces for the HTTP tests above, which only exercise the
    // configured theme: every theme's error template must render from the
    // locals the error handler sets and nothing else.
    for (const theme of THEMES) {
        it(`${theme} error template needs only the error handler's locals`, async function () {
            const base = {
                title: 'PagerMon', message: 'Bad Request', error: {}, version: '0', faKey: 'k',
                gaTrackingCode: '', monitorName: 'PagerMon', register: false
            };
            const file = path.join(__dirname, '..', 'themes', theme, 'views', 'global', 'error.ejs');
            for (const extra of [
                { login: false, user: false, gaEnable: false },
                { login: true, user: { username: 'u', role: 'admin' }, gaEnable: true }
            ]) {
                await new Promise((resolve, reject) => ejs.renderFile(file, Object.assign({}, base, extra), {},
                    (err, html) => (err ? reject(err) : resolve(html))));
            }
        });
    }
});
