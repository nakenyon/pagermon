const uuid = require('node-uuid');
const MASK = '********';
const secrets = ['token', 'userKey', 'webhook'];
const idPattern = /^[a-f0-9-]{36}$/i;
class ValidationError extends Error {
    constructor(message) { super(message); this.readerHealthValidation = true; }
}

function keyIds(settings) {
    ((settings.auth || {}).keys || []).forEach(key => {
        if (!key.id) key.id = uuid.v4();
    });
    return settings;
}

function health(settings) {
    return settings.readerHealth || { destinations: [], monitors: [] };
}

function publicSettings(settings, admin) {
    const copy = JSON.parse(JSON.stringify(settings));
    if (!admin) {
        delete copy.readerHealth;
        return copy;
    }
    keyIds(copy);
    copy.readerHealth = health(copy);
    copy.readerHealth.destinations.forEach(d => secrets.forEach(k => {
        if (d[k]) d[k] = MASK;
    }));
    return copy;
}

function discordUrl(value) {
    try {
        const u = new URL(value);
        return u.protocol === 'https:' && ['discord.com', 'discordapp.com'].includes(u.hostname) &&
            !u.port && !u.username && !u.password && !u.search && !u.hash &&
            /^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(u.pathname);
    } catch (_) { return false; }
}

// Validate before the generic settings endpoint writes any configuration. Missing
// fields from an older client preserve health settings and existing key IDs.
async function prepare(settings, previous, db) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new ValidationError('Invalid settings');
    const oldKeys = ((previous.auth || {}).keys || []);
    const keys = ((settings.auth || {}).keys || []);
    const ids = new Set();
    keys.forEach(key => {
        const old = oldKeys.find(k => k.key === key.key);
        if (old && old.id && key.id && old.id !== key.id) throw new ValidationError('API key IDs cannot be changed');
        key.id = key.id || (old && old.id) || uuid.v4();
        if (!idPattern.test(key.id) || ids.has(key.id)) throw new ValidationError('Invalid or duplicate API key ID');
        ids.add(key.id);
    });
    settings.readerHealth = settings.readerHealth || health(previous);
    const h = settings.readerHealth;
    if (!Array.isArray(h.destinations) || !Array.isArray(h.monitors) || h.destinations.length > 100 || h.monitors.length > 100) {
        throw new ValidationError('Invalid reader health configuration (maximum 100 monitors/destinations)');
    }
    const users = await db('users').select('id', 'email');
    const checkUsers = list => {
        if (!Array.isArray(list) || list.length > 100 || list.some(id => !Number.isInteger(id) || !users.some(u => Number(u.id) === id && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)))) {
            throw new ValidationError('Select existing users with valid email addresses');
        }
    };
    const destIds = new Set();
    h.destinations.forEach(d => {
        d.id = d.id || uuid.v4();
        if (!idPattern.test(d.id) || destIds.has(d.id)) throw new ValidationError('Invalid or duplicate destination ID');
        destIds.add(d.id);
        if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 100) throw new ValidationError('Destination name is required (maximum 100 characters)');
        const old = health(previous).destinations.find(x => x.id === d.id && x.type === d.type);
        secrets.forEach(k => {
            if (d[k] === MASK) d[k] = (old && old[k]) || '';
            if (d[k] && (typeof d[k] !== 'string' || d[k].length > 2048)) throw new ValidationError('Invalid destination credential');
        });
        if (d.type === 'email') {
            checkUsers(d.userIds);
            if (!d.userIds.length) throw new ValidationError('Email destination needs at least one user');
        } else if (d.type === 'pushover') {
            if (!/^[A-Za-z0-9]{30}$/.test(d.token) || !/^[A-Za-z0-9]{30}$/.test(d.userKey)) throw new ValidationError('Pushover requires an application token and user/group key');
        } else if (d.type === 'telegram') {
            if (!/^\d+:[A-Za-z0-9_-]+$/.test(d.token) || typeof d.chatId !== 'string' || !/^(?:-?\d+|@[A-Za-z0-9_]+)$/.test(d.chatId)) throw new ValidationError('Telegram requires a bot token and chat ID');
        } else if (d.type === 'discord') {
            if (!discordUrl(d.webhook)) throw new ValidationError('Use an HTTPS Discord webhook URL');
        } else throw new ValidationError('Unsupported notification channel');
    });
    const monitorIds = new Set();
    h.monitors.forEach(m => {
        if (!ids.has(m.keyId) || monitorIds.has(m.keyId)) throw new ValidationError('Monitor must reference a unique existing API key');
        monitorIds.add(m.keyId);
        if (typeof m.enabled !== 'boolean' || !Number.isInteger(m.timeoutMinutes) || m.timeoutMinutes < 1 || m.timeoutMinutes > 43200) throw new ValidationError('Timeout must be 1–43200 minutes');
        if (!Array.isArray(m.destinationIds) || m.destinationIds.some(id => !destIds.has(id))) throw new ValidationError('Unknown notification destination');
        checkUsers(m.recoveryUserIds);
        if (m.enabled && !m.destinationIds.length) throw new ValidationError('Enabled monitors need an outage destination');
        const emailUsed = m.recoveryUserIds.length || m.destinationIds.some(id => h.destinations.some(d => d.id === id && d.type === 'email'));
        if (m.enabled && emailUsed && !(settings.mail && settings.mail.enabled && settings.mail.host && settings.mail.fromAddress)) throw new ValidationError('Configure and enable Email before enabling email notifications');
    });
    return settings;
}

module.exports = { keyIds, health, publicSettings, prepare, discordUrl };
