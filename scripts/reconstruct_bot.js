const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');

// Vamos manter o cabeçalho (até a linha 137) e o rodapé (da 251 em diante)
const part1 = lines.slice(0, 137).join('\n');
const part3 = lines.slice(251).join('\n');

const fixedBlock = `
app.post('/api/notify-delivery', async (req, res) => {
    const { number, status, pedidoId, tempo, itens, message: customMessage } = req.body;
    const savedJid = pedidoIdToJid[pedidoId];

    if (!savedJid) {
        console.log(\`❌ [Bot] JID não encontrado para pedido #\${pedidoId}\`);
        return res.status(404).json({ error: 'JID não encontrado', pedidoId });
    }

    const botConectado = !!(sock && statusConexao === 'CONECTADO');
    if (!botConectado) {
        return res.status(503).json({ error: 'Bot offline', status: statusConexao });
    }

    try {
        let message = customMessage;
        if (!message) {
            const tempoEstimado = tempo || '30-50 min';
            switch (status) {
                case 'recebido':
                    message = \`✅ *PEDIDO RECEBIDO!*\\n\\nOlá! Já recebemos seu pedido *#\${pedidoId}* e já iniciamos o preparo.\\n\\n1️⃣ - Ver Status 🛵\\n2️⃣ - Falar com Atendente 👨‍💻\`;
                    break;
                case 'preparando':
                    message = \`👨‍🍳🍳 *SEU PEDIDO ESTÁ SENDO PREPARADO!*\\n\\nO chef já começou a preparar seu pedido #\${pedidoId}.\`;
                    break;
                case 'saiu_entrega':
                    message = \`🛵 *SAIU PARA ENTREGA!*\\n\\nSeu pedido #\${pedidoId} já está a caminho!\\n\\n🕒 *Prazo:* \${tempoEstimado}\`;
                    break;
                case 'entregue':
                    message = \`✅ *PEDIDO ENTREGUE!*\\n\\nSeu pedido #\${pedidoId} foi entregue. Bom apetite!\`;
                    break;
                default:
                    return res.status(400).json({ error: 'Status inválido' });
            }
        }

        const s = await sendHumanizedMessage(savedJid, { text: message });
        const timeStr = new Date().toLocaleTimeString('pt-BR');
        const rObj = { id: s.key.id, text: message, fromMe: true, time: timeStr, sender: 'bot', pushName: 'Robô 🤖' };

        if (db) {
            if (!chats[savedJid]) {
                chats[savedJid] = { name: savedJid.split('@')[0], messages: [], unreadCount: 0 };
            }
            chats[savedJid].atendimentoManual = false;
            if (pedidoId) chats[savedJid].lastOrderId = pedidoId;
            await db.set('chats', { ...chats }).write();
        }

        await saveMessage(savedJid, rObj, 'Robo');
        io.emit('new_msg', rObj);

        if (status === 'recebido' && pedidoId && itens && itens.length > 0) {
            try {
                const menuMsg = buildPersonalizedMenuMessage(itens, pedidoId);
                if (menuMsg) {
                    const s2 = await sendHumanizedMessage(savedJid, { text: menuMsg });
                    const rObj2 = { id: s2.key.id, text: menuMsg, fromMe: true, time: timeStr, sender: 'bot', pushName: 'Robô 🤖' };
                    await saveMessage(savedJid, rObj2, 'Robo');
                    io.emit('new_msg', rObj2);
                }
            } catch (e) { console.error('Erro cardapio:', e.message); }
        }

        res.json({ success: true, jidUsed: savedJid });
    } catch (e) {
        console.error('Erro notify-delivery:', e);
        res.status(500).json({ error: e.message });
    }
});
`;

fs.writeFileSync(path, part1 + fixedBlock + part3);
console.log('✅ [Reconstrução Total] Bloco de notificação reconstruído e validado.');
