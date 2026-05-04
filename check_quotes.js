const fs = require('fs');
const code = fs.readFileSync('garconnexpress/frontend/admin/app.js', 'utf8');
const count = (code.match(/`/g) || []).length;
console.log('Backtick count:', count);
if (count % 2 !== 0) {
    console.log('Uneven number of backticks!');
}
const quotes = (code.match(/"/g) || []).length;
console.log('Double quote count:', quotes);
if (quotes % 2 !== 0) {
    console.log('Uneven number of double quotes!');
}
const squotes = (code.match(/'/g) || []).length;
console.log('Single quote count:', squotes);
if (squotes % 2 !== 0) {
    console.log('Uneven number of single quotes!');
}
