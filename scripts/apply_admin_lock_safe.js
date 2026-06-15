const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

const sIdx = content.indexOf('if (isDeliveryOrder)');
const eIdx = content.indexOf('if (atendimentoManual)', sIdx);

if (sIdx !== -1 && eIdx !== -1) {
    const oldBlock = content.substring(sIdx, eIdx).trim();
    
    const adminNumbers = ['5582993225452', '558293157048', '82993225452'];
    
    const newBlock = `if (isDeliveryOrder) {
                    const match = text.match(/#(\\d+)/);
                    const pId = match ? match[1] : null;
                    if (pId) {
                        const cleanJid = jid.split('@')[0].split(':')[0];
                        const isAdmin = ${JSON.stringify(adminNumbers)}.some(num => cleanJid.includes(num));

                        if (isAdmin) {
                            console.log('🚫 [Bot] Notificação interna do Admin detectada (' + cleanJid + ').');
                            return;
                        }

                        pedidoIdToJid = typeof pedidoIdToJid !== 'undefined' ? pedidoIdToJid : {};
                        pedidoIdToJid[pId] = jid;
                        if (db) await db.set('pedidoIdToJid', pedidoIdToJid).write();

                        chats[jid] = chats[jid] || { name: pushName, messages: [], unreadCount: 0 };
                        chats[jid].ultimoPedidoId = pId;
                        chats[jid].activePedidoId = pId;
                        chats[jid].atendimentoManual = false;
                        chats[jid].estado = 'delivery';
                        if (db) await db.set('chats', { ...chats }).write();

                        const welcome = 'Olá ' + pushName + '! 👋\\n\\n🛍️ *PEDIDO RECEBIDO E EM ANDAMENTO!*\\n\\nSeu pedido *#' + pId + '* já está sendo preparado! 🚀\\n\\n1️⃣ - Ver Status 🛵\\n2️⃣ - Atendente 👨‍💻';
                        await sock.sendMessage(jid, { text: welcome });
                        return;
                    }
                }`;
                
    content = content.replace(oldBlock, newBlock);
    fs.writeFileSync(path, content);
    console.log('✅ [Fix Admin] Trava aplicada e mensagem de boas-vindas unificada!');
} else {
    console.log('❌ Bloco isDeliveryOrder não encontrado para substituição.');
}
