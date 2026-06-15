const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. Corrigir delete_chat (faltando fechar o if (db))
content = content.replace(
    /socket\.on\('delete_chat', async \(jid\) => \{[\s\S]*?console\.log\(`\[Zap\] Chat excluído: \$\{jid\}`\);\s*\}/,
    `socket.on('delete_chat', async (jid) => {
        if (db) {
            if (chats[jid]) {
                delete chats[jid];
                await db.set('chats', { ...chats }).write();
                io.emit('chat_deleted', jid);
                console.log(\`[Zap] Chat excluído: \${jid}\`);
            }
        }
    }`
);

// 2. Corrigir toggle_atendimento
content = content.replace(
    /socket\.on\('toggle_atendimento', async \(data\) => \{[\s\S]*?io\.emit\('status_atendimento', \{ jid, atendimentoManual: status \}\);\s*\}/,
    `socket.on('toggle_atendimento', async (data) => {
          const { jid, status } = data;
          if (db) {
              if (!chats[jid]) {
                  chats[jid] = { name: jid.split('@')[0], messages: [], atendimentoManual: status, unreadCount: 0, lastUpdate: Date.now() };
              } else {
                  chats[jid].atendimentoManual = status;
              }
              await db.set('chats', { ...chats }).write();
              io.emit('status_atendimento', { jid, atendimentoManual: status });
          }
      }`
);

// 3. Corrigir mark_seen
content = content.replace(
    /socket\.on\('mark_seen', async \(jid\) => \{[\s\S]*?await db\.set\('chats', \{ \.\.\.chats \}\)\.write\(\);\s*\}/,
    `socket.on('mark_seen', async (jid) => {
          if (db) {
              if (chats[jid]) {
                  chats[jid].unreadCount = 0;
                  await db.set('chats', { ...chats }).write();
              }
          }
      }`
);

fs.writeFileSync(path, content);
console.log('✅ [Brace Fixer] Blocos socket.on corrigidos!');
