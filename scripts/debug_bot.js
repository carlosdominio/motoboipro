const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');

console.log('--- BUSCANDO GATILHOS DE MODO HUMANO ---');
lines.forEach((line, index) => {
    if (line.includes('atendimentoManual = true') || line.includes('atendimentoManual: true')) {
        console.log(`Linha ${index + 1}: ${line.trim()}`);
    }
    if (line.includes('DELIVERY')) {
        console.log(`Linha ${index + 1} (DELIVERY): ${line.trim()}`);
    }
});
