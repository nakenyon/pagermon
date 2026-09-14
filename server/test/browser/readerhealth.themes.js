// Optional browser regression test; not part of the DB/HTTP Mocha suite.
// Install Playwright separately, then run with PAPER_CSS pointing at Bootswatch
// Paper 3.3.7's bootstrap.min.css (the stylesheet used by the actual themes).
// ANGULAR_JS optionally selects the deployed Angular 1.6.4 instead of npm's copy.
// No server, user account, production data, or notification transport is used.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const bootstrap = fs.readFileSync(process.env.PAPER_CSS, 'utf8');
const angular = fs.readFileSync(process.env.ANGULAR_JS || path.join(root, 'node_modules/angular/angular.js'), 'utf8');
const partial = fs.readFileSync(path.join(root, 'themes/_shared/public/templates/admin/readerHealth.html'), 'utf8');
const output = process.env.SCREENSHOTS;

function contrast(foreground, background) {
    function luminance(rgb) {
        const parts = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(c => {
            c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return parts[0] * 0.2126 + parts[1] * 0.7152 + parts[2] * 0.0722;
    }
    const a = luminance(foreground), b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

(async function () {
    const browser = await chromium.launch({ headless: true });
    try {
        if (output) fs.mkdirSync(output, { recursive: true });
        for (const theme of ['default', 'Compact Default', 'Dark', 'Compact Dark']) {
            for (const width of [1280, 390]) {
                const page = await browser.newPage({ viewport: { width, height: 1000 } });
                const errors = [];
                page.on('pageerror', err => errors.push(err.message));
                await page.route('**/*', route => route.abort()); // Fonts/CDNs cannot affect test results.
                const css = fs.readFileSync(path.join(root, 'themes', theme, 'public/stylesheets/style.css'), 'utf8');
                await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">' +
                    '<style>' + bootstrap + '</style><style>' + css + '</style></head>' +
                    '<body id="admin-body"><div id="wrap"><div id="fixture" class="container" ng-controller="Fixture"><form class="form-horizontal">' +
                    partial + '</form></div></div></body></html>');
                await page.addScriptTag({ content: angular });
                await page.evaluate(() => {
                    angular.module('themeFixture', []).controller('Fixture', function ($scope) {
                        $scope.settings = { readerHealth: {
                            destinations: [
                                { id: 'email', type: 'email', name: 'Operators', userIds: [1] },
                                { id: 'push', type: 'pushover', name: 'On-call push', token: '********', userKey: '********' },
                                { id: 'telegram', type: 'telegram', name: 'On-call chat', token: '********', chatId: '-12345' },
                                { id: 'discord', type: 'discord', name: 'Operations channel', webhook: '********' }
                            ],
                            monitors: [{ keyId: 'reader', enabled: true, timeoutMinutes: 360, destinationIds: ['email'], recoveryUserIds: [1] }]
                        } };
                        $scope.healthView = { users: [{ id: 1, username: 'operator', email: 'operator@example.com' }], test: 'Test accepted by provider', status: {
                            error: 'Example monitoring warning',
                            incidents: [{ id: 'incident-1', reader_name: 'Test reader', started_at: 1700000000, recovered_at: 1700022000, status: 'recovered' }],
                            deliveries: [{ incident_id: 'incident-1', target: 'Operators', kind: 'recovery', status: 'sent', attempts: 1, error: '' }]
                        } };
                        $scope.healthKeyName = () => 'Test reader';
                        $scope.healthState = () => 'Healthy';
                        $scope.healthLast = () => '2026-09-13T12:00:00.000Z';
                    });
                    angular.bootstrap(document, ['themeFixture']);
                });
                await page.locator('.panel-heading').waitFor();
                if (output) await page.screenshot({ path: path.join(output, theme.replace(/ /g, '-') + '-' + width + '.png'), fullPage: true });
                assert.deepEqual(errors, [], theme + ': Angular render errors');
                assert.equal(await page.locator('.panel').count(), 5);
                const colors = await page.evaluate(() => {
                    function effectiveBackground(el) {
                        for (; el; el = el.parentElement) {
                            const c = getComputedStyle(el).backgroundColor;
                            if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
                        }
                        return 'rgb(255, 255, 255)';
                    }
                    const selectors = ['.panel', '.panel-heading', '.control-label', '.help-block', '.form-control', 'select[multiple]', '.btn-default', '.alert-warning', 'th', 'td'];
                    return selectors.map(selector => {
                        const el = document.querySelector('#fixture ' + selector), s = getComputedStyle(el);
                        return { selector, color: s.color, background: effectiveBackground(el) };
                    });
                });
                if (theme.includes('Dark')) {
                    assert.equal(colors[0].background, 'rgb(41, 41, 41)', theme + ' ' + width + ': dark panel background');
                    assert.equal(colors[1].background, 'rgb(30, 30, 30)', theme + ' ' + width + ': dark panel heading');
                    for (const item of colors) assert(contrast(item.color, item.background) >= 4.5,
                        theme + ' ' + width + ': low contrast for ' + JSON.stringify(item));
                    // Check mobile inputs and focused/hovered controls too, not
                    // only panels. An unclosed media rule previously hid these.
                    await page.locator('input.form-control').first().focus();
                    assert.equal(await page.locator('input.form-control').first().evaluate(el => getComputedStyle(el).borderTopColor), 'rgb(248, 89, 89)');
                    await page.locator('.btn-default').first().hover();
                    await page.waitForTimeout(350); // Paper's transition
                    const button = await page.locator('.btn-default').first().evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
                    assert(contrast(button.color, button.background) >= 4.5);
                } else {
                    assert.equal(colors[0].background, 'rgb(255, 255, 255)', theme + ': retain light panels');
                    assert(contrast(colors[0].color, colors[0].background) >= 4.5);
                }
                console.log('PASS ' + theme + ' at ' + width + 'px');
                await page.close();
            }
        }
    } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
