
// Two systems are seeded with explicit ids so tests can assert cross-system
// behaviour - the same capcode address resolving to a different alias per
// system - without depending on whatever id the migration's default system got.
// Seeded capcodes and messages all belong to system 1; anything needing a row
// in system 2 creates it in the test itself, so the row counts these fixtures
// have always asserted stay as they were.
var systemsLib = require('../../lib/systems');

exports.seed = function(db, Promise) {
  // Deletes ALL existing entries
  return db('systems').del()
    .then(function () {
      return db('systems').insert([
        { id: 1, name: 'Default', label: 'Default', color: 'grey', enabled: 1, is_default: 1, sortorder: 0 },
        { id: 2, name: 'Second', label: 'Second System', color: 'purple', enabled: 1, is_default: 0, sortorder: 1 }
      ]);
    })
    .then(function () {
      // The suite rolls the schema back and re-seeds between tests, so the
      // cached system list in lib/systems would otherwise outlive the rows it
      // describes.
      systemsLib.invalidate();
    })
    .then(function () {
      return db('messages').del(); // Deletes ALL existing entries
    })
    .then(function() { // Inserts seed entries one by one in series
      return db('messages').insert({
        address: '1234567',
        message: 'This is a Test Message to Address 1234567',
        source: 'Client 1',
        timestamp: '1529487722',
        system_id: 1
      });
    }).then(function () {
      return db('messages').insert({
        address: '1234567',
        message: 'This is another Test Message to Address 1234567',
        source: 'Client 2',
        timestamp: '1529488007',
        system_id: 1
      });
    }).then(function () {
      return db('messages').insert({
        address: '1234568',
        message: 'This is a Test Message to Address 1234568',
        source: 'Client 1',
        timestamp: '1529489509',
        system_id: 1
      });
    }).then(function () {
      return db('messages').insert({
        address: '1234569',
        message: 'This is a Test Message to Address 1234569',
        source: 'Client 3',
        timestamp: '1529495672',
        system_id: 1
      });
    }).then(function () {
      return db('messages').insert({
        address: '1234570',
        message: 'This is a Test Message to Address 1234570',
        source: 'Client 4',
        timestamp: '1529494321',
        system_id: 1
      });
    }).then(function () {
      return db('capcodes').del()
    }).then(function () {
      return db('capcodes').insert({
        address: '1234567',
        alias: 'Fire Brigade',
        agency: 'FIRE',
        icon: 'fire',
        color: 'red',
        ignore: '0',
        system_id: 1,
      });
    }).then(function () {
      return db('capcodes').insert({
        address: '1234568',
        alias: 'Ambulance 1',
        agency: 'AMBULANCE',
        icon: 'ambulance',
        color: 'green',
        ignore: '0',
        system_id: 1,
      });
    }).then(function () {
      return db('capcodes').insert({
        address: '1234569',
        alias: 'Police Station',
        agency: 'POLICE',
        icon: 'gavel',
        color: 'blue',
        ignore: '0',
        system_id: 1,
      });
    }).then(function () {
      return db('capcodes').insert({
        address: '1234570',
        alias: 'Ignore Capcode',
        agency: 'IGNORE',
        icon: '',
        color: '',
        ignore: '1',
        system_id: 1,
      });
    }).then(function () {
      return db('users').del()
    }).then(function () {
      return db('users').insert({
        givenname: 'Active',
        surname: 'User',
        username: 'useractive',
        password: '$2a$08$De/aXnQkZIEbQ9p8J22tHuzLltqIbsAxE2CGgRMPLaaIwwHmVrpsu',
        email: 'none1@none.com',
        role: 'user',
        status: 'active',
      });
    }).then(function () {
      return db('users').insert({
        givenname: 'Active',
        surname: 'Admin',
        username: 'adminactive',
        password: '$2a$08$De/aXnQkZIEbQ9p8J22tHuzLltqIbsAxE2CGgRMPLaaIwwHmVrpsu',
        email: 'none2@none.com',
        role: 'admin',
        status: 'active',
      });
    }).then(function () {
      return db('users').insert({
        givenname: 'Disabled',
        surname: 'Admin',
        username: 'admindisabled',
        password: '$2a$08$De/aXnQkZIEbQ9p8J22tHuzLltqIbsAxE2CGgRMPLaaIwwHmVrpsu',
        email: 'none3@none.com',
        role: 'admin',
        status: 'disabled',
      });
    })
};

