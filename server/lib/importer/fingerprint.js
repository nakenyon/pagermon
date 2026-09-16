var fs = require('fs');
var crypto = require('crypto');

function fingerprintFile(path) {
  return new Promise(function (resolve, reject) {
    var hash = crypto.createHash('sha256');
    var stream = fs.createReadStream(path);
    stream.on('error', reject);
    stream.on('data', function (chunk) { hash.update(chunk); });
    stream.on('end', function () { resolve('sha256:' + hash.digest('hex')); });
  });
}

module.exports = {
  fingerprintFile: fingerprintFile
};
