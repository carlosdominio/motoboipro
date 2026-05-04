const fs = require('fs');
const buffer = fs.readFileSync('garconnexpress/frontend/admin/index.html');
const lastPart = buffer.slice(-100);
console.log(lastPart.toString('utf8'));
console.log(lastPart.toString('hex'));
