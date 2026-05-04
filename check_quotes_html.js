const fs = require('fs');
const html = fs.readFileSync('garconnexpress/frontend/admin/index.html', 'utf8');

let inQuote = null;
let lastQuoteIndex = -1;

for (let i = 0; i < html.length; i++) {
    const char = html[i];
    if (char === '"' || char === "'") {
        if (!inQuote) {
            inQuote = char;
            lastQuoteIndex = i;
        } else if (inQuote === char) {
            inQuote = null;
        }
    }
}

if (inQuote) {
    console.log(`Unclosed quote ${inQuote} starting at index ${lastQuoteIndex}`);
    console.log('Context:', html.substring(lastQuoteIndex, lastQuoteIndex + 50));
} else {
    console.log('All quotes seem balanced in the file.');
}
