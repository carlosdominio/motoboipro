const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Erro: Arquivo do robô não encontrado.');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. ADICIONA O LOG DE QUEM ESTÁ MANDANDO ATIVAR O MODO HUMANO
const debugToggleAtendimento = `    socket.on('toggle_atendimento', async (data) => {
          const { jid, status } = data;
          console.log(\`⚠️ [DEBUG] Comando toggle_atendimento recebido! JID: \${jid}, Status: \${status}, De: \${socket.id}\`);
          if (db) {`;

content = content.replace(/socket\.on\('toggle_atendimento', async \(data\) => \{[\s\S]*?const \{ jid, status \} = data;[\s\S]*?if \(db\) \{/, debugToggleAtendimento);

// 2. GARANTE QUE NO UPSERT NÃO ESTEJA ATIVANDO SOZINHO (RESPOSTA AUTOMÁTICA)
// Se o bot responde, ele NÃO deve ativar modo manual
content = content.replace(
    /chat\.atendimentoManual = true;\s*await db\.set\('chats', chats\)\.write\(\);\s*io\.emit\('status_atendimento', \{ jid, atendimentoManual: false \}\);/g,
    "chat.atendimentoManual = true; await db.set('chats', chats).write(); io.emit('status_atendimento', { jid, atendimentoManual: true });"
);

fs.writeFileSync(path, content);
console.log('✅ [Robô Debug] index.js atualizado com log de rastreamento.');
