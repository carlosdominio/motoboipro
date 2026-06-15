const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');

console.log('--- CONTEXTO LINHA 215 ---');
for (let i = 200; i < 230; i++) {
    if (lines[i]) {
        console.log(`${i + 1}: ${lines[i]}`);
    }
}
