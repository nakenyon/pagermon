// Test helper for the CSRF protection on /auth.
//
// State-changing /auth requests must echo back the per-session token published
// in the XSRF-TOKEN cookie (see middleware/csrf.js). A bare chai.request() opens
// a fresh connection with no cookie jar, so it has neither a session nor a
// token. This returns a chai agent that has both.

var chai = require('chai');

// Resolves to { agent, token }. The agent keeps the session cookie, so requests
// made through it are recognised as the same session that owns the token.
//
// GET /auth/login is used to prime it because it is public and always renders,
// which is also exactly how a browser picks the token up.
function csrfAgent(server) {
    var agent = chai.request.agent(server);
    return agent.get('/auth/login').then(function (res) {
        var cookies = res.headers['set-cookie'] || [];
        var token = null;
        cookies.forEach(function (cookie) {
            var match = /^XSRF-TOKEN=([^;]*)/.exec(cookie);
            if (match) token = decodeURIComponent(match[1]);
        });
        return { agent: agent, token: token };
    });
}

module.exports = csrfAgent;
