const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';
let content = fs.readFileSync(path, 'utf8');

// Lógica corrigida com verificação de inicialização da variável chats
const extractionLogicFixed = `
                // IGNORAR MENSAGENS DE "NOVO PEDIDO" PARA EVITAR RESPOSTA AUTOMÁTICA DE MENU
                if (text.toUpperCase().includes('NOVO PEDIDO') || text.toUpperCase().includes('DELIVERY')) {
                    console.log('🚫 [Bot] Ignorando mensagem de pedido automático para não poluir o chat.');
                    
                    // EXTRAIR ID DO PEDIDO (Formato #1234)
                    const matchId = text.match(/#(\\d+)/);
                    const pedidoId = matchId ? matchId[1] : null;
                    
                    if (pedidoId) {
                        console.log(\`📦 [Bot] Identificado Pedido #\${pedidoId} para o JID \${jid}\`);
                        
                        try {
                            // Tenta obter chats do banco se a variável local falhar
                            let currentChats = (typeof chats !== 'undefined') ? chats : (db ? db.get('chats').value() : {});
                            
                            if (db && currentChats) {
                                if (!currentChats[jid]) {
                                    currentChats[jid] = { name: pushName || jid.split('@')[0], messages: [] };
                                }
                                currentChats[jid].ultimoPedidoId = pedidoId;
                                currentChats[jid].atendimentoManual = true;
                                await db.set('chats', { ...currentChats }).write();
                                console.log(\`✅ [Bot] Pedido #\${pedidoId} vinculado ao chat.\`);
                            }
                        } catch (e) {
                            console.error('⚠️ [Bot] Erro ao salvar vínculo de pedido:', e.message);
                        }
                    }

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

// Substitui o bloco problemático pelo fix
const oldIgnoreBlock = /\/\/ IGNORAR MENSAGENS DE "NOVO PEDIDO"[\s\S]*?return;\s*\}/;
if (oldIgnoreBlock.test(content)) {
    content = content.replace(oldIgnoreBlock, extractionLogicFixed);
    fs.writeFileSync(path, content);
    console.log('✅ Bot corrigido: Erro de inicialização de "chats" resolvido!');
} else {
    console.log('❌ Bloco de ignorar não encontrado para correção.');
}
