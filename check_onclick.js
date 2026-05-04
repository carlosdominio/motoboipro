const fs = require('fs');
const html = fs.readFileSync('garconnexpress/frontend/admin/index.html', 'utf8');
const regex = /onclick="([^"]*)"/g;
let match;
while ((match = regex.exec(html)) !== null) {
    const code = match[1];
    try {
        new Function(code);
    } catch (e) {
        console.log(`Syntax error in onclick at index ${match.index}: ${code}`);
        console.log(e.message);
    }
}
const regexSingle = /onclick='([^']*)'/g;
while ((match = regexSingle.exec(html)) !== null) {
    const code = match[1];
    try {
        new Function(code);
    } catch (e) {
        console.log(`Syntax error in onclick at index ${match.index}: ${code}`);
        console.log(e.message);
    }
}
