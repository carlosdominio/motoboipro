const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. Definição do novo bloco de lógica para Delivery
const newDeliveryLogic = `if (isDeliveryOrder) {
                    const match = text.match(/#(\\d+)/);
                    const pId = match ? match[1] : null;
                    if (pId) {
                        chats[jid] = chats[jid] || { name: pushName, messages: [], unreadCount: 0 };
                        chats[jid].ultimoPedidoId = pId;
                        chats[jid].activePedidoId = pId;
                        chats[jid].atendimentoManual = false;
                        chats[jid].estado = 'delivery';
                        if (db) await db.set('chats', { ...chats }).write();

                        const welcome = 'Olá ' + pushName + '! 👋\\n\\n🛍️ *PEDIDO RECEBIDO!*\\n\\nSeu pedido *#' + pId + '* já está sendo preparado! 🚀\\n\\n1️⃣ - Ver Status 🛵\\n2️⃣ - Atendente 👨‍💻';
                        await sock.sendMessage(jid, { text: welcome });
                        return;
                    }
                }`;

// 2. Localização e substituição segura
const startKey = 'if (isDeliveryOrder)';
const nextKey = 'if (atendimentoManual)';

const startIdx = content.indexOf(startKey);
const nextIdx = content.indexOf(nextKey, startIdx);

if (startIdx !== -1 && nextIdx !== -1) {
    const partBefore = content.substring(0, startIdx);
    const partAfter = content.substring(nextIdx);
    const finalContent = partBefore + newDeliveryLogic + '\n\n                ' + partAfter;
    
    fs.writeFileSync(path, finalContent);
    console.log('✅ [FIX SUCESSO] Mensagem unificada e erro de undefined corrigido!');
} else {
    console.error('❌ Âncoras não encontradas no arquivo.');
    process.exit(1);
}
