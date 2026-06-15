const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. Corrigir o status_atendimento emit que estava fixo em 'false' indevidamente
// Quando o cliente escolhe a opção 2
content = content.replace(
    /chat\.atendimentoManual = true;\s*await db\.set\('chats', chats\)\.write\(\);\s*io\.emit\('status_atendimento', \{ jid, atendimentoManual: false \}\);/g,
    "chat.atendimentoManual = true; await db.set('chats', chats).write(); io.emit('status_atendimento', { jid, atendimentoManual: true });"
);

// Quando o robô detecta comando 'atendente'
content = content.replace(
    /chats\[jid\]\.atendimentoManual = true;\s*await db\.set\('chats', chats\)\.write\(\);\s*io\.emit\('status_atendimento', \{ jid, atendimentoManual: false \}\);/g,
    "chats[jid].atendimentoManual = true; await db.set('chats', chats).write(); io.emit('status_atendimento', { jid, atendimentoManual: true });"
);

fs.writeFileSync(path, content);
console.log('✅ [Robô Fix Final] Emissão de status de atendimento corrigida para refletir o estado real.');
