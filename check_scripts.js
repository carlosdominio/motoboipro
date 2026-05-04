const fs = require('fs');
const html = fs.readFileSync('garconnexpress/frontend/admin/index.html', 'utf8');
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let match;
let count = 0;
while ((match = scriptRegex.exec(html)) !== null) {
    count++;
    console.log(`Script ${count} found at index ${match.index}`);
}
const openingTags = (html.match(/<script\b/gi) || []).length;
const closingTags = (html.match(/<\/script>/gi) || []).length;
console.log(`Opening <script>: ${openingTags}`);
console.log(`Closing </script>: ${closingTags}`);
