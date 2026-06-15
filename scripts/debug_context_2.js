const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');

console.log('--- CONTEXTO LINHA 722 E 783 ---');
for (let i = 710; i < 740; i++) {
    if (lines[i]) console.log(`${i + 1}: ${lines[i]}`);
}
for (let i = 770; i < 800; i++) {
    if (lines[i]) console.log(`${i + 1}: ${lines[i]}`);
}
