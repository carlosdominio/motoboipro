const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');

const part1 = lines.slice(0, 492).join('\n');
const part3 = lines.slice(748).join('\n');

const fixedBlock = `
        sock.ev.on('messages.upsert', async (m) => {
            chats = db ? db.get('chats').value() || {} : {};

            try {
                const msg = m.messages[0];
                if (!msg.message) return;

                const rawJid = msg.key.remoteJid;
                let jid = rawJid.replace(/:[0-9]+/, '');
                if (jid.includes('@lid')) {
                    jid = (msg.key.participant ? msg.key.participant.replace(/:[0-9]+/, '') : jid).replace('@lid', '@s.whatsapp.net');
                }

                const fromMe = msg.key.fromMe;
                const pushName = fromMe ? "Voce" : (msg.pushName || jid.split('@')[0]);

                let text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
                let audioUrl = null, imageUrl = null, videoUrl = null, documentUrl = null;

                if (msg.message.audioMessage) {
                    try {
                        const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
                        audioUrl = \`data:audio/ogg;base64,\${buffer.toString('base64')}\`;
                        text = "🎤 Áudio recebido";
                    } catch (err) { console.log("Erro áudio:", err); }
                }

                if (msg.message.imageMessage) {
                    try {
                        const stream = await downloadContentFromMessage(msg.message.imageMessage, 'image');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
                        imageUrl = \`data:image/jpeg;base64,\${buffer.toString('base64')}\`;
                        text = "🖼️ Imagem recebida";
                    } catch (err) { console.log("Erro imagem:", err); }
                }

                if (msg.message.videoMessage) {
                    try {
                        const stream = await downloadContentFromMessage(msg.message.videoMessage, 'video');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
                        videoUrl = \`data:video/mp4;base64,\${buffer.toString('base64')}\`;
                        if (!text) text = "🎥 Vídeo recebido";
                    } catch (err) { console.log("Erro vídeo:", err); }
                }

                if (msg.message.documentMessage) {
                    try {
                        const stream = await downloadContentFromMessage(msg.message.documentMessage, 'document');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
                        documentUrl = \`data:application/octet-stream;base64,\${buffer.toString('base64')}\`;
                        if (!text) text = \`📎 Documento: \${msg.message.documentMessage.fileName || 'arquivo'}\`;
                    } catch (err) { console.log("Erro doc:", err); }
                }

                if (msg.message.stickerMessage && !text) text = "🔖 Sticker recebido";

                if (!text && !audioUrl && !imageUrl && !videoUrl && !documentUrl) return;

                const isAutoOrder = text.toUpperCase().includes('NOVO PEDIDO') || text.toUpperCase().includes('DELIVERY') || text.toUpperCase().includes('RASCUNHO');

                if (isAutoOrder) {
                    const matchId = text.match(/#(\\d+)/);
                    const pedidoId = matchId ? matchId[1] : null;

                    if (pedidoId) {
                        if (db) {
                            if (!chats[jid]) chats[jid] = { name: pushName, messages: [], unreadCount: 0 };
                            chats[jid].ultimoPedidoId = pedidoId;
                            chats[jid].atendimentoManual = false;
                            await db.set('chats', { ...chats }).write();
                        }
                    }

                    const myNum = sock?.user?.id?.split(':')[0]?.split('@')[0];
                    const adminNum = (typeof ADMIN_NUMBER !== 'undefined') ? ADMIN_NUMBER.replace(/\\D/g, '') : '558293157048';
                    const cleanJid = jid.split('@')[0].replace(/\\D/g, '');

                    if (cleanJid === myNum || cleanJid === adminNum) {
                        console.log('🚫 [Bot] Notificação interna. Silêncio.');
                        return;
                    }

                    if (pedidoId) {
                        const menuMsg = \`✅ *PEDIDO RECEBIDO!*\\n\\nOlá \${pushName}! Recebemos seu pedido *#\${pedidoId}* e já iniciamos o preparo.\\n\\n1️⃣ - Ver Status 🛵\\n2️⃣ - Falar com Humano 👨‍💻\`;
                        await sock.sendMessage(jid, { text: menuMsg });
                        return;
                    }
                }

                const msgObj = { id: msg.key.id, from: jid, text, audioUrl, imageUrl, videoUrl, documentUrl, fromMe, time: new Date().toLocaleTimeString('pt-BR'), sender: jid, pushName };
                await saveMessage(jid, msgObj, pushName);
                io.emit('new_msg', msgObj);

                if (fromMe) return;

                const atendimentoManual = (chats[jid] && chats[jid].atendimentoManual === true);

                if (chat && chat.lastOrderId && (text === '1' || text === '2')) {
                    await savePedidoJidMapping(chat.lastOrderId, jid);
                    if (text === '1') {
                        const statusData = await fetchDeliveryStatus(chat.lastOrderId);
                        let statusMsg = "❌ Não encontramos informações.";
                        if (statusData) {
                            const statusMap = { 'recebido': 'Recebido 📥', 'preparando': 'Preparando 🍳', 'pronto': 'Pronto 📦', 'saiu_entrega': 'A caminho! 🛵', 'entregue': 'Entregue! 😋', 'cancelado': 'Cancelado ❌' };
                            statusMsg = \`📊 *STATUS #\${chat.lastOrderId}*\\n📍 *Status:* \${statusMap[statusData.status] || statusData.status}\`;
                        }
                        await sock.sendMessage(jid, { text: statusMsg });
                        return;
                    } else if (text === '2') {
                        chats[jid].atendimentoManual = true;
                        await db.set('chats', { ...chats }).write();
                        await sock.sendMessage(jid, { text: '🙋‍♂️ *ATENDIMENTO HUMANO*\\nAguarde um instante...' });
                        return;
                    }
                }

                if (atendimentoManual) return;

                if (text && text !== "🎤 Áudio recebido") {
                    const caixaAberto = await verificarCaixaAberto();
                    if (!caixaAberto) {
                        await sock.sendMessage(jid, { text: '❌ Estamos FECHADOS no momento.' });
                        return;
                    }

                    const command = extractCommand(text);
                    if (!command) {
                        const welcome = \`Olá \${pushName}! 👋\\n1️⃣ - Ver Cardápio\\n2️⃣ - Fazer Pedido\\n5️⃣ - Falar com Atendente\`;
                        await sock.sendMessage(jid, { text: welcome });
                    } else if (command === '5' || command === 'atendente') {
                        chats[jid].atendimentoManual = true;
                        await db.set('chats', { ...chats }).write();
                        await sock.sendMessage(jid, { text: '👨‍💻 Atendente notificado!' });
                    }
                }
            } catch (e) { console.error('Erro upsert:', e); }
        });
`;

fs.writeFileSync(path, part1 + fixedBlock + part3);
console.log('✅ [UPSERT RECONSTRUCT] Evento messages.upsert reconstruído e limpo.');
