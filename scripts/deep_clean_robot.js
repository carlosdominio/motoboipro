const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Erro: Arquivo do robô não encontrado.');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. ELIMINAÇÃO TOTAL DE ATIVAÇÕES AUTOMÁTICAS NO CÓDIGO
// Substituímos todas as ocorrências de ativação automática por false, exceto onde o cliente escolhe a opção 2 ou o Admin manda
content = content.replace(/atendimentoManual:\s*true/g, "atendimentoManual: false");
content = content.replace(/atendimentoManual\s*=\s*true/g, "atendimentoManual = false");

// 2. RESTAURA APENAS OS LUGARES ONDE DEVE SER TRUE (POR ESCOLHA DO CLIENTE OU ADMIN)
// Opção 2 do Menu
content = content.replace(
    /else\s+if\s*\(text\s*===\s*'2'\)\s*\{[\s\S]*?atendimentoManual\s*=\s*false/g,
    (match) => match.replace("atendimentoManual = false", "atendimentoManual = true")
);
// Opção 5 do Menu alternativo
content = content.replace(
    /else\s+if\s*\(command\s*===\s*'5'\s*\|\|\s*command\s*===\s*'atendente'\)\s*\{[\s\S]*?atendimentoManual\s*=\s*false/g,
    (match) => match.replace("atendimentoManual = false", "atendimentoManual = true")
);
// Comando vindo do Admin via Socket (ESSE É O ÚNICO QUE DEVE RESPEITAR O 'status' enviado)
content = content.replace(
    /socket\.on\('toggle_atendimento'[\s\S]*?atendimentoManual\s*=\s*false/g,
    (match) => match.replace("atendimentoManual = false", "atendimentoManual = status")
);

fs.writeFileSync(path, content);
console.log('🔥 [Robô Limpeza Pesada] index.js resetado! Agora o modo humano SÓ ativa se o cliente digitar 2 ou se você mandar.');
