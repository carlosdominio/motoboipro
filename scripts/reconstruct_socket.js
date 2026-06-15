const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');

const part1 = lines.slice(0, 365).join('\n');
const part3 = lines.slice(401).join('\n');

const fixedBlock = `
    socket.on('delete_chat', async (jid) => {
        if (db) {
            if (chats[jid]) {
                delete chats[jid];
                await db.set('chats', { ...chats }).write();
                io.emit('chat_deleted', jid);
                console.log(\`[Zap] Chat excluído: \${jid}\`);
            }
        }
    });

    socket.on('toggle_atendimento', async (data) => {
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
    });

    socket.on('mark_seen', async (jid) => {
        if (db) {
            if (chats[jid]) {
                chats[jid].unreadCount = 0;
                await db.set('chats', { ...chats }).write();
            }
        }
    });
});
`;

fs.writeFileSync(path, part1 + fixedBlock + part3);
console.log('✅ [Brace Fixer Final] Blocos socket.on reconstruídos e sincronizados.');
