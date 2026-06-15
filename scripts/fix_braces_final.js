const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// O erro 'Missing catch or finally after try' sugere que fechamos o try indevidamente.
// Na linha 502 (após a trava de admin), existe um } extra.

// Vamos procurar o bloco e corrigir
const pattern = /if\s*\(isAdmin\)\s*\{[\s\S]*?return;\s*\}\s*chats\[jid\]\s*=/;
if (pattern.test(content)) {
    console.log('✅ Padrão de admin encontrado.');
}

// Removendo o } extra que foi inserido por engano
// O padrão inserido foi:
/*
if (isDeliveryOrder) {
    ...
    if (pId) {
        ...
        if (isAdmin) {
            ...
            return;
        }
        ...
        return;
    }
}
} <-- EXTRA?
*/

// Vamos reconstruir o bloco de forma limpa
const startKey = 'if (isDeliveryOrder)';
const startIdx = content.indexOf(startKey);
if (startIdx !== -1) {
    const endKey = 'if (atendimentoManual)';
    const endIdx = content.indexOf(endKey, startIdx);
    if (endIdx !== -1) {
        const part1 = content.substring(0, startIdx);
        const part3 = content.substring(endIdx);
        
        const fixedMid = `if (isDeliveryOrder) {
                    const match = text.match(/#(\\d+)/);
                    const pId = match ? match[1] : null;
                    if (pId) {
                        const cleanJid = jid.split('@')[0].split(':')[0];
                        const isAdmin = ["5582993225452","558293157048","82993225452"].some(num => cleanJid.includes(num));

                        if (isAdmin) {
                            console.log('🚫 [Bot] Notificação de pedido detectada vinda do Admin/Sistema (' + cleanJid + '). Ignorando resposta automática.');
                            return;
                        }

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
                }\n\n                `;
        
        fs.writeFileSync(path, part1 + fixedMid + part3);
        console.log('✅ [Brace Fix] Bloco isDeliveryOrder reconstruído corretamente.');
    }
}
