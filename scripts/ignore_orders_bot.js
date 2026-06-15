const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';
let content = fs.readFileSync(path, 'utf8');

// Adiciona uma verificação no início do processamento de mensagens para ignorar pedidos automáticos
const ignoreLogic = `
                if (!text && !audioUrl && !imageUrl && !videoUrl && !documentUrl) return;

                // IGNORAR MENSAGENS DE "NOVO PEDIDO" PARA EVITAR RESPOSTA AUTOMÁTICA DE MENU
                if (text.toUpperCase().includes('NOVO PEDIDO') || text.toUpperCase().includes('DELIVERY')) {
                    console.log('🚫 [Bot] Ignorando mensagem de pedido automático para não poluir o chat.');
                    const msgObjIgnore = {
                        id: msg.key.id,
                        from: jid,
                        text: text,
                        fromMe: fromMe,
                        time: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }),
                        sender: jid,
                        pushName: pushName
                    };
                    await saveMessage(jid, msgObjIgnore, pushName);
                    io.emit('new_msg', msgObjIgnore);
                    return;
                }
`;

// Substitui o bloco original de salvamento de mensagem inicial
const oldIgnorePoint = /if\s*\(!text\s*&&\s*!audioUrl\s*&&\s*!imageUrl\s*&&\s*!videoUrl\s*&&\s*!documentUrl\)\s*return;/;
content = content.replace(oldIgnorePoint, ignoreLogic);

fs.writeFileSync(path, content);
console.log('Bot index.js atualizado para ignorar pedidos automáticos!');
