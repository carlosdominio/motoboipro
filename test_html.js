const fs = require('fs');
const html = fs.readFileSync('garconnexpress/frontend/admin/index.html', 'utf8');

const stack = [];
const regex = /<\/?([a-z1-6]+)(?:\s+[^>]*)?>/gi;
let match;

const selfClosing = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

while ((match = regex.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const isClosing = match[0].startsWith('</');

    if (selfClosing.has(tag)) {
        if (isClosing) {
            console.log(`Error: Self-closing tag ${tag} closed with </${tag}> at index ${match.index}`);
        }
        continue;
    }

    if (isClosing) {
        if (stack.length === 0) {
            console.log(`Error: Unexpected closing tag </${tag}> at index ${match.index}`);
        } else {
            const last = stack.pop();
            if (last.tag !== tag) {
                console.log(`Error: Mismatched tag </${tag}> at index ${match.index}. Expected </${last.tag}> (from index ${last.index})`);
            }
        }
    } else {
        stack.push({ tag, index: match.index });
    }
}

if (stack.length > 0) {
    console.log('Unclosed tags:');
    stack.forEach(item => {
        console.log(`${item.tag} at index ${item.index}`);
    });
} else {
    console.log('All tags are balanced (excluding self-closing).');
}
