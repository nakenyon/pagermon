const { spawn } = require('child_process');
const fs = require('fs');
const logger = require('../log');

function run(trigger, scope, data, config, callback) {
    if (data.pluginconf.Shell && data.pluginconf.Shell.enable) {
        let fileName = data.alias_id;

        // Override ID if needed
        if (data.pluginconf.Shell.overrideAlias > 0) {
            logger.main.debug('Override filename');
            fileName = data.pluginconf.Shell.overrideAlias;
        }

        const filePath = process.platform === 'win32' ? '\\plugins\\Shell\\' : '/plugins/Shell/';
        const fullFileName = process.platform === 'win32' ? `${fileName}.ps1` : `${fileName}.sh`;

        // Check file exist
        if (fs.existsSync(filePath + fullFileName)) {
            logger.main.info('Exec shell command for selected alias');

            const child =
                process.platform === 'win32'
                    ? // Windows PowerShell
                      spawn('powershell.exe', [
                          filePath + fullFileName,
                          `"${data.address}"`,
                          `@'\r\n${data.message}\r\n'@`,
                          `@'\r\n${JSON.stringify(data)}\r\n'@`,
                      ])
                    : // Unix Shell
                      spawn('sh', [filePath + fullFileName, data.address, data.message, JSON.stringify(data)]); // Unix Shell

            child.stdout.on('data', (d) => {
                logger.main.debug(`ShellScript Data: ${d}`);
            });
            child.stderr.on('data', (d) => {
                logger.main.error(`ShellScript Errors: ${d}`);
            });
            child.on('exit', () => {
                logger.main.info('ShellScript finished');
            });
            child.stdin.end(); // end input
        } else {
            logger.main.info(`File ${fullFileName} not exist`);
        }
    }

    callback(data);
}

module.exports = {
    run,
};
