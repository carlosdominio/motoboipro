const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Erro: Arquivo do robô não encontrado em ' + path);
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. Corrigindo a lógica de "Ignorar" para permitir rascunhos e pedidos
// Mudamos de "return" imediato para processar o vínculo e permitir interação se não for auto-envio
const enhancedIgnoreLogic = `
                // IDENTIFICAÇÃO DE PEDIDOS E RASCUNHOS
                const isAutoOrder = text.toUpperCase().includes('NOVO PEDIDO') || text.toUpperCase().includes('DELIVERY') || text.toUpperCase().includes('RASCUNHO');
                
                if (isAutoOrder) {
                    console.log('📦 [Bot] Mensagem de pedido detectada. Vinculando...');
                    
                    // EXTRAIR ID DO PEDIDO (Formato #1234)
                    const matchId = text.match(/#(\\d+)/);
                    const pedidoId = matchId ? matchId[1] : null;
                    
                    if (pedidoId) {
                        try {
                            let currentChats = (typeof chats !== 'undefined') ? chats : (db ? db.get('chats').value() : {});
                            if (db && currentChats) {
                                if (!currentChats[jid]) {
                                    currentChats[jid] = { name: pushName || jid.split('@')[0], messages: [], unreadCount: 0 };
                                }
                                currentChats[jid].ultimoPedidoId = pedidoId;
                                currentChats[jid].atendimentoManual = true; // Ativa atendimento manual para pedidos
                                await db.set('chats', { ...currentChats }).write();
                                console.log(\`✅ [Bot] Pedido #\${pedidoId} vinculado ao chat \${jid}\`);
                            }
                        } catch (e) {
                            console.error('⚠️ [Bot] Erro ao salvar vínculo:', e.message);
                        }
                    }

                    // Se for uma mensagem gerada pelo próprio sistema para o admin, ignoramos a resposta automática
                    const myNumber = sock?.user?.id?.split(':')[0]?.split('@')[0];
                    if (myNumber && jid.includes(myNumber)) {
                        console.log('🚫 [Bot] Ignorando auto-resposta para mensagem interna.');
                        return;
                    }
                }
`;

// Substitui o bloco de ignorar antigo
const oldIgnoreRegex = /\/\/ IGNORAR MENSAGENS DE "NOVO PEDIDO"[\s\S]*?return;\s*\}/;
content = content.replace(oldIgnoreRegex, enhancedIgnoreLogic);

// 2. Melhorando o Atendimento Automático de Status
const autoReplyLogic = `
        // --- RESPOSTA AUTOMÁTICA DE STATUS ---
        const lastChat = chats[jid];
        if (lastChat && !lastChat.atendimentoManual && !fromMe) {
            const msgLower = text.toLowerCase();
            if (msgLower === '1') {
                const pedidoId = lastChat.ultimoPedidoId;
                if (pedidoId) {
                    await sock.sendMessage(jid, { text: \`🔍 *CONSULTA DE STATUS*\\n\\nSeu pedido #\${pedidoId} está sendo processado. Assim que mudar de status, eu te aviso aqui! 🛵\` });
                    return;
                } else {
                    await sock.sendMessage(jid, { text: '❌ Não encontrei um pedido ativo para você neste momento.' });
                    return;
                }
            } else if (msgLower === '2') {
                lastChat.atendimentoManual = true;
                await db.set('chats', { ...chats }).write();
                await sock.sendMessage(jid, { text: '👨‍💻 *ATENDIMENTO HUMANO*\\n\\nEntendido! Chamei um de nossos atendentes. Por favor, aguarde um momento.' });
                return;
            }
        }
`;

// Insere a lógica de resposta automática antes do processamento normal de mensagens se não existir
if (!content.includes('RESPOSTA AUTOMÁTICA DE STATUS')) {
    content = content.replace(/if\s*\(text\.toLowerCase\(\)\s*===\s*'ping'\)/, `${autoReplyLogic}\n    if (text.toLowerCase() === 'ping')`);
}

fs.writeFileSync(path, content);
console.log('🚀 [Robô Avançado] Robô do Zap atualizado com sucesso! Lógica de status e interação ativada.');
