// Bodies for the transactional emails. Kept out of routes/auth.js so the route
// handlers stay about flow control.
//
// Every interpolated value is escaped: givenname and email are user-controlled,
// and an unescaped name would let a user inject markup into a mail their
// colleagues receive.

function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function greeting(user) {
    return user && user.givenname ? 'Hi ' + user.givenname + ',' : 'Hi,';
}

function layout(bodyHtml, monitorName) {
    return (
        '<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#222">' +
        bodyHtml +
        '<p style="color:#777;font-size:13px;margin-top:28px">' +
        escapeHtml(monitorName) +
        '</p></div>'
    );
}

function passwordReset(user, link, ttlMinutes, monitorName) {
    var subject = monitorName + ' - password reset';
    var text =
        greeting(user) +
        '\n\nSomeone asked to reset the password for your ' +
        monitorName +
        ' account (' +
        user.username +
        ').\n\nOpen this link to choose a new password:\n' +
        link +
        '\n\nThe link expires in ' +
        ttlMinutes +
        ' minutes and can only be used once.\n\n' +
        'If you did not request this you can ignore this email - your password has not changed.\n';

    var html = layout(
        '<p>' +
            escapeHtml(greeting(user)) +
            '</p><p>Someone asked to reset the password for your ' +
            escapeHtml(monitorName) +
            ' account (<strong>' +
            escapeHtml(user.username) +
            '</strong>).</p>' +
            '<p><a href="' +
            escapeHtml(link) +
            '" style="display:inline-block;padding:10px 18px;background:#337ab7;color:#fff;' +
            'text-decoration:none;border-radius:3px">Choose a new password</a></p>' +
            '<p style="font-size:13px;color:#555">Or paste this into your browser:<br>' +
            escapeHtml(link) +
            '</p><p>The link expires in ' +
            escapeHtml(ttlMinutes) +
            ' minutes and can only be used once.</p>' +
            '<p>If you did not request this you can ignore this email - your password has not changed.</p>',
        monitorName
    );

    return { subject: subject, text: text, html: html };
}

// Sent after every successful password change, by either route. This is what
// turns a silent account takeover into one the owner notices.
function passwordChanged(user, monitorName) {
    var subject = monitorName + ' - your password was changed';
    var text =
        greeting(user) +
        '\n\nThe password for your ' +
        monitorName +
        ' account (' +
        user.username +
        ') was just changed.\n\n' +
        'If this was you, no action is needed. If it was not, contact your ' +
        monitorName +
        ' administrator immediately - someone else may have access to your account.\n';

    var html = layout(
        '<p>' +
            escapeHtml(greeting(user)) +
            '</p><p>The password for your ' +
            escapeHtml(monitorName) +
            ' account (<strong>' +
            escapeHtml(user.username) +
            '</strong>) was just changed.</p>' +
            '<p>If this was you, no action is needed. If it was not, <strong>contact your ' +
            escapeHtml(monitorName) +
            ' administrator immediately</strong> - someone else may have access to your account.</p>',
        monitorName
    );

    return { subject: subject, text: text, html: html };
}

function verifyEmail(user, newEmail, link, ttlMinutes, monitorName) {
    var subject = monitorName + ' - confirm your email address';
    var text =
        greeting(user) +
        '\n\nYou asked to change the email address on your ' +
        monitorName +
        ' account (' +
        user.username +
        ') to this one.\n\nConfirm it by opening this link:\n' +
        link +
        '\n\nThe link expires in ' +
        ttlMinutes +
        ' minutes. Until you open it, your account keeps its previous address.\n\n' +
        'If you did not request this, ignore this email.\n';

    var html = layout(
        '<p>' +
            escapeHtml(greeting(user)) +
            '</p><p>You asked to change the email address on your ' +
            escapeHtml(monitorName) +
            ' account (<strong>' +
            escapeHtml(user.username) +
            '</strong>) to <strong>' +
            escapeHtml(newEmail) +
            '</strong>.</p>' +
            '<p><a href="' +
            escapeHtml(link) +
            '" style="display:inline-block;padding:10px 18px;background:#337ab7;color:#fff;' +
            'text-decoration:none;border-radius:3px">Confirm this address</a></p>' +
            '<p style="font-size:13px;color:#555">Or paste this into your browser:<br>' +
            escapeHtml(link) +
            '</p><p>The link expires in ' +
            escapeHtml(ttlMinutes) +
            ' minutes. Until you open it, your account keeps its previous address.</p>' +
            '<p>If you did not request this, ignore this email.</p>',
        monitorName
    );

    return { subject: subject, text: text, html: html };
}

// Goes to the OLD address when a change is requested, so losing control of an
// account cannot silently move the recovery address somewhere else.
function emailChangeNotice(user, newEmail, monitorName) {
    var subject = monitorName + ' - email address change requested';
    var text =
        greeting(user) +
        '\n\nSomeone asked to change the email address on your ' +
        monitorName +
        ' account (' +
        user.username +
        ') to ' +
        newEmail +
        '.\n\nThe change only takes effect once that address is confirmed. ' +
        'If this was not you, contact your ' +
        monitorName +
        ' administrator immediately.\n';

    var html = layout(
        '<p>' +
            escapeHtml(greeting(user)) +
            '</p><p>Someone asked to change the email address on your ' +
            escapeHtml(monitorName) +
            ' account (<strong>' +
            escapeHtml(user.username) +
            '</strong>) to <strong>' +
            escapeHtml(newEmail) +
            '</strong>.</p>' +
            '<p>The change only takes effect once that address is confirmed. If this was not you, ' +
            '<strong>contact your ' +
            escapeHtml(monitorName) +
            ' administrator immediately</strong>.</p>',
        monitorName
    );

    return { subject: subject, text: text, html: html };
}

module.exports = {
    passwordReset: passwordReset,
    passwordChanged: passwordChanged,
    verifyEmail: verifyEmail,
    emailChangeNotice: emailChangeNotice,
    escapeHtml: escapeHtml,
};
