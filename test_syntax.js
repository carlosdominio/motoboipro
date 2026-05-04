const fs = require('fs');
const code = fs.readFileSync('garconnexpress/frontend/admin/app.js', 'utf8');

let stack = [];
let lines = code.split('\n');

for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    for (let j = 0; j < line.length; j++) {
        let char = line[j];
        if (char === '{' || char === '(' || char === '[') {
            stack.push({ char, line: i + 1, col: j + 1 });
        } else if (char === '}' || char === ')' || char === ']') {
            if (stack.length === 0) {
                console.log(`Unexpected ${char} at line ${i + 1}, col ${j + 1}`);
            } else {
                let last = stack.pop();
                if ((char === '}' && last.char !== '{') ||
                    (char === ')' && last.char !== '(') ||
                    (char === ']' && last.char !== '[')) {
                    console.log(`Mismatched ${char} at line ${i + 1}, col ${j + 1}. Expected match for ${last.char} from line ${last.line}, col ${last.col}`);
                }
            }
        }
    }
}

if (stack.length > 0) {
    console.log('Unclosed braces/parentheses:');
    stack.forEach(item => {
        console.log(`${item.char} at line ${item.line}, col ${item.col}`);
    });
} else {
    console.log('All braces/parentheses are balanced.');
}
