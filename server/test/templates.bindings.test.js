process.env.NODE_ENV = 'test';

const chai = require('chai');

chai.should();

const fs = require('fs');
const path = require('path');

// Guards against the AngularJS child-scope trap, which shipped a broken forgot
// password form in 2026.8.10 and 2026.8.11.
//
// ng-if, ng-repeat and ng-switch each create a child scope. `ng-model="email"`
// inside one writes `email` on that child, shadowing rather than updating the
// controller's property - so the controller reads undefined and the form looks
// like it submitted nothing. The fix is the standard "always have a dot" rule:
// bind to a property of an object (`data.email`), so the write goes through the
// prototype chain to the object the controller owns.
//
// A unit test rather than a browser test on purpose: it needs no Chromium and
// runs in milliseconds, while catching the specific mistake that actually got
// made. It cannot catch every UI defect - only a real browser can do that.

const THEMES_DIR = path.join(__dirname, '..', 'themes');

function templateFiles() {
    const found = [];
    fs.readdirSync(THEMES_DIR).forEach(theme => {
        const dir = path.join(THEMES_DIR, theme, 'public', 'templates');
        if (!fs.existsSync(dir)) return;
        walk(dir, found);
    });
    return found;
}

function walk(dir, found) {
    fs.readdirSync(dir).forEach(entry => {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) return walk(full, found);
        if (full.endsWith('.html')) found.push(full);
        return null;
    });
}

// Directives that give their element - and everything inside it - a new scope.
const SCOPE_DIRECTIVES = /\bng-(if|repeat|repeat-start|switch|switch-when|switch-default|include)\b/;

// Elements that never contain anything, so they must not be pushed onto the
// nesting stack. `input` is the important one: it is where ng-model usually is.
const VOID_ELEMENTS = ['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed'];

// Returns the dotless ng-model expressions that sit inside a scope-creating
// element. Walks the tags with a nesting stack rather than parsing properly -
// enough to answer this one question without adding an HTML parser dependency.
function scopeShadowedModels(html) {
    const offenders = [];
    const stack = [];
    let depthCreatingScope = 0;

    const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)\/?>/g;
    let match;

    while ((match = tagPattern.exec(html)) !== null) {
        const raw = match[0];
        const name = match[1].toLowerCase();
        const attrs = match[2] || '';
        const isClosing = raw.charAt(1) === '/';
        const isSelfClosing = /\/>$/.test(raw) || VOID_ELEMENTS.indexOf(name) !== -1;

        if (isClosing) {
            for (let i = stack.length - 1; i >= 0; i -= 1) {
                if (stack[i].name === name) {
                    if (stack[i].createsScope) depthCreatingScope -= 1;
                    stack.length = i;
                    break;
                }
            }
            continue;
        }

        const createsScope = SCOPE_DIRECTIVES.test(attrs);
        const model = /ng-model\s*=\s*"([^"]+)"/.exec(attrs);

        // An element carrying both ng-if and ng-model is itself in the new scope.
        if (model && (depthCreatingScope > 0 || createsScope)) {
            const expression = model[1].trim();
            if (expression.indexOf('.') === -1) offenders.push(expression);
        }

        if (!isSelfClosing) {
            stack.push({ name: name, createsScope: createsScope });
            if (createsScope) depthCreatingScope += 1;
        }
    }

    return offenders;
}

describe('Angular template bindings', () => {
    const files = templateFiles();

    it('should find templates to check', () => {
        files.length.should.be.above(0);
    });

    it('should never bind ng-model to a bare property inside a child scope', () => {
        // Only flags the combination that actually breaks. A dotless ng-model is
        // fine when nothing between it and its controller creates a scope, which
        // is the case for several long-standing admin templates - rewriting
        // those would be churn, not a fix. It is specifically a dotless model
        // *underneath* an ng-if/ng-repeat/ng-switch that silently binds to the
        // wrong object.
        const offenders = [];

        files.forEach(file => {
            scopeShadowedModels(fs.readFileSync(file, 'utf8')).forEach(expression => {
                offenders.push(path.relative(THEMES_DIR, file) + ' -> ng-model="' + expression + '"');
            });
        });

        offenders.should.eql(
            [],
            'ng-model inside a child scope must bind through an object, or the ' +
                'child shadows the controller property and it reads undefined:\n  ' +
                offenders.join('\n  ')
        );
    });

    it('should keep ui-validate comparisons pointing at the same object', () => {
        // The confirm-password field compares against the password field. When
        // the model moved onto an object the comparison had to move with it, or
        // it silently compares against an undefined bare property and every
        // value looks like a match.
        const offenders = [];

        files.forEach(file => {
            const html = fs.readFileSync(file, 'utf8');
            const validators = html.match(/ui-validate\s*=\s*"[^"]*"/g) || [];
            validators.forEach(v => {
                if (/\$value\s*==\s*[a-zA-Z_]+\s*'/.test(v)) {
                    offenders.push(path.relative(THEMES_DIR, file) + ' -> ' + v.trim());
                }
            });
        });

        offenders.should.eql(
            [],
            'ui-validate compares against a bare property:\n  ' + offenders.join('\n  ')
        );
    });
});
