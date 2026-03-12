const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const adapter = new FileSync(path.join(__dirname, '../../database.json'));
const db = low(adapter);

// Initial state
db.defaults({ doctors: [], patients: [], appointments: [] }).write();

module.exports = db;
