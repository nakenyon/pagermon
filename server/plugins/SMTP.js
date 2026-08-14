const nodemailer = require('nodemailer');
var logger = require('../log');

function run(trigger, scope, data, config, callback) {
    var sConf = data.pluginconf.SMTP;
    if (sConf && sConf.enable) {
        let smtpConfig = {
            host: config.server,
            port: config.port,
            secure: config.secure,
            // On a non-secure port the session opens in plaintext and upgrades
            // with STARTTLS, so without this a server that fails to offer the
            // upgrade would be handed the password in the clear. Ignored when
            // secure is set, since the socket is already TLS from the start.
            requireTLS: true,
            tls: {
              // Certificate validation is the only thing standing between
              // STARTTLS and a downgrade, so it stays on unless the operator
              // opts out for an internal relay with a self-signed cert.
              rejectUnauthorized: !config.allowSelfSigned
            },
            auth: {
              user: config.username,
              pass: config.password
            }
        };
        let transporter = nodemailer.createTransport(smtpConfig,[])

        let mailOptions = {
          from: `"${config.mailFromName}" <${config.mailFrom}>`, // sender address
          to: sConf.mailto, // list of receivers
          subject: data.agency+' - '+data.alias, // Subject line
          text: data.message, // plain text body
          html: '<b>'+data.message+'</b>' // html body
        };

        // send mail with defined transport object
        transporter.sendMail(mailOptions, (error, info) => {
          if (error) {
            logger.main.error('SMTP:' + error);
            callback();
          } else {
            logger.main.info('SMTP:' + 'Message sent: %s', info.messageId);
            callback();
          }
        });
    } else {
        callback();
    }
}

module.exports = {
    run: run
}