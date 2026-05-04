const fs = require('fs');
const code = fs.readFileSync('garconnexpress/frontend/admin/app.js', 'utf8');

let inString = null;
let escape = false;

for (let i = 0; i < code.length; i++) {
    const char = code[i];
    if (escape) {
        escape = false;
        continue;
    }
    if (char === '\\') {
        escape = true;
        continue;
    }
    if (inString) {
        if (char === inString) {
            inString = null;
        }
    } else {
        if (char === "'" || char === '"' || char === '`') {
            inString = char;
        }
    }
}

if (inString) {
    console.log(`Unclosed string ${inString}`);
} else {
    console.log('All strings balanced.');
}
