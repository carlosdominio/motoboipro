const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

const adminNumbers = ['5582993225452', '558293157048', '82993225452'];

const newLogic = `if (isDeliveryOrder) {
                    const match = text.match(/#(\\d+)/);
                    const pId = match ? match[1] : null;
                    if (pId) {
                        const cleanJid = jid.split('@')[0].split(':')[0];
                        const isAdmin = ${JSON.stringify(adminNumbers)}.some(num => cleanJid.includes(num));

                        if (isAdmin) {
                            console.log('🚫 [Bot] Notificação de pedido detectada vinda do Admin/Sistema (' + cleanJid + '). Ignorando resposta automática.');
                            return;
                        }

                        // VINCULA O PEDIDO AO JID DO CLIENTE REAL
                        pedidoIdToJid[pId] = jid;
                        if (db) await db.set('pedidoIdToJid', { ...pedidoIdToJid }).write();

                        chats[jid] = chats[jid] || { name: pushName, messages: [], unreadCount: 0 };
                        chats[jid].ultimoPedidoId = pId;
                        chats[jid].activePedidoId = pId;
                        chats[jid].atendimentoManual = false;
                        chats[jid].estado = 'delivery';
                        if (db) await db.set('chats', { ...chats }).write();

                        console.log('✅ [Bot] Pedido #' + pId + ' vinculado ao JID: ' + jid);

                        const welcome = 'Olá ' + pushName + '! 👋\\n\\n🛍️ *PEDIDO RECEBIDO!*\\n\\nSeu pedido *#' + pId + '* já está sendo preparado! 🚀\\n\\n1️⃣ - Ver Status 🛵\\n2️⃣ - Atendente 👨‍💻';
                        await sock.sendMessage(jid, { text: welcome });
                        return;
                    }
                }`;

const startKey = 'if (isDeliveryOrder)';
const startIdx = content.indexOf(startKey);

if (startIdx !== -1) {
    const endKey = 'if (atendimentoManual)';
    const endIdx = content.indexOf(endKey, startIdx);
    if (endIdx !== -1) {
        const part1 = content.substring(0, startIdx);
        const part3 = content.substring(endIdx);
        
        fs.writeFileSync(path, part1 + newLogic + '\n\n                ' + part3);
        console.log('✅ [Robô Blindado] Trava de Admin e Mapeamento de JID aplicados!');
    }
}
