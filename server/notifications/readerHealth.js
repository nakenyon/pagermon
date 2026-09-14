// Operational alerts deliberately bypass per-capcode message plugins. All
// transports resolve only after provider acceptance and reject on failure.
const https = require('https');
const mailer = require('../mail/mailer');
const { discordUrl } = require('../lib/readerhealthconfig');

function post(url, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = https.request(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, res => {
            let data = '';
            res.on('data', chunk => {
                data += chunk;
                if (data.length > 65536) req.destroy(new Error('Response too large'));
            });
            res.on('error', reject);
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('Provider rejected notification'));
                try { resolve(data ? JSON.parse(data) : {}); } catch (_) { reject(new Error('Invalid provider response')); }
            });
        });
        // Overall deadline also covers DNS/TLS setup, not just an idle socket.
        const timer = setTimeout(() => req.destroy(new Error('Notification timed out')), 15000);
        req.on('close', () => clearTimeout(timer));
        req.on('error', reject);
        req.end(payload);
    });
}

async function send(conf, destination, message) {
    try {
        if (destination.type === 'email') {
            // Receipt alerts need no absolute link, so do not use the password
            // reset isConfigured() check, which also requires a Site URL.
            await mailer.send(conf, { to: destination.email, subject: message.title, text: message.text });
        } else if (destination.type === 'pushover') {
            const result = await post('https://api.pushover.net/1/messages.json', {
                token: destination.token, user: destination.userKey,
                title: message.title.slice(0, 250), message: message.text.slice(0, 1024), priority: 0
            });
            if (result.status !== 1) throw new Error('Rejected');
        } else if (destination.type === 'telegram') {
            const result = await post('https://api.telegram.org/bot' + destination.token + '/sendMessage', {
                chat_id: destination.chatId, text: (message.title + '\n' + message.text).slice(0, 4096)
            });
            if (result.ok !== true) throw new Error('Rejected');
        } else if (destination.type === 'discord') {
            if (!discordUrl(destination.webhook)) throw new Error('Invalid webhook');
            await post(destination.webhook + '?wait=true', {
                content: (message.title + '\n' + message.text).slice(0, 2000), allowed_mentions: { parse: [] }
            });
        } else throw new Error('Unknown channel');
    } catch (_) {
        // SDK/network exceptions can include tokens, URLs, or SMTP credentials.
        throw new Error('Notification failed; check channel credentials, connectivity and provider limits');
    }
}
module.exports = { send };
