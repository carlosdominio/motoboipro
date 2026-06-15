const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Erro: Arquivo do robô não encontrado.');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. BLOCO DE IDENTIFICAÇÃO E VÍNCULO (PROTEÇÃO ANTI-FANTASMA E RESPOSTA AO CLIENTE)
const secureOrderLogic = `
                // IDENTIFICAÇÃO DE PEDIDOS/RASCUNHOS
                const isAutoOrder = text.toUpperCase().includes('NOVO PEDIDO') || text.toUpperCase().includes('DELIVERY') || text.toUpperCase().includes('RASCUNHO');
                
                if (isAutoOrder) {
                    console.log('📦 [Bot] Processando pedido automático...');
                    
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
                                // Inicia com atendimentoManual false para permitir o menu automático
                                currentChats[jid].atendimentoManual = false; 
                                await db.set('chats', { ...currentChats }).write();
                                console.log(\`✅ [Bot] Pedido #\${pedidoId} vinculado ao chat \${jid}\`);
                            }
                        } catch (e) { console.error('Erro vínculo:', e.message); }
                    }

                    // TRAVA ANTI-FANTASMA: Se a mensagem for do próprio robô ou para o Admin (notificação), ele NÃO responde e NÃO salva como chat
                    const myNum = sock?.user?.id?.split(':')[0]?.split('@')[0];
                    const isAdminNotify = jid.includes(myNum) || (typeof ADMIN_NUMBER !== 'undefined' && jid.includes(ADMIN_NUMBER));

                    if (isAdminNotify) {
                        console.log('🚫 [Bot] Notificação interna detectada. Mantendo silêncio e evitando chat fantasma.');
                        return; // Para aqui: você recebe o Zap, mas o bot não responde nem cria lixo no painel
                    }

                    // RESPOSTA APENAS PARA O CLIENTE REAL
                    if (pedidoId) {
                        const menuMsg = \`✅ *PEDIDO RECEBIDO!*\\n\\nOlá \${pushName || 'cliente'}! Recebemos seu pedido *#\${pedidoId}* e já iniciamos o preparo.\\n\\nEscolha uma opção:\\n1️⃣ - Ver Status 🛵\\n2️⃣ - Falar com Humano 👨‍💻\\n\\n_Digite apenas o número._\`;
                        await sock.sendMessage(jid, { text: menuMsg });
                        return;
                    }
                }
`;

// 2. LOGICA DE RESPOSTA AUTOMÁTICA (OPÇÕES 1 E 2)
const interactionLogic = `
        // --- RESPOSTA AUTOMÁTICA DE INTERAÇÃO ---
        const lastChat = (typeof chats !== 'undefined' && chats[jid]) ? chats[jid] : null;
        if (lastChat && !lastChat.atendimentoManual && !fromMe) {
            const msgTrim = text.trim();
            if (msgTrim === '1') {
                const pId = lastChat.ultimoPedidoId;
                const statusMsg = pId ? \`🔍 *STATUS DO PEDIDO #\${pId}*\\n\\nSeu pedido está em nossa fila de produção. Assim que houver uma atualização, eu te aviso aqui! 🛵\` : '❌ Não localizei um pedido ativo para você.';
                await sock.sendMessage(jid, { text: statusMsg });
                return;
            } else if (msgTrim === '2') {
                lastChat.atendimentoManual = true;
                if (db) await db.set('chats', { ...chats }).write();
                await sock.sendMessage(jid, { text: '👨‍💻 *ATENDIMENTO HUMANO*\\n\\nEntendido! Chamei um de nossos atendentes. Por favor, aguarde um momento.' });
                return;
            }
        }
`;

// Aplica as substituições de forma cirúrgica
const oldIgnoreBlock = /\/\/ IDENTIFICAÇÃO DE PEDIDOS E RASCUNHOS[\s\S]*?return;\s*\}[\s\S]*?\}/;
if (oldIgnoreBlock.test(content)) {
    content = content.replace(oldIgnoreBlock, secureOrderLogic);
} else {
    // Tenta o bloco antigo se o anterior falhou
    const veryOldIgnore = /\/\/ IGNORAR MENSAGENS DE "NOVO PEDIDO"[\s\S]*?return;\s*\}/;
    content = content.replace(veryOldIgnore, secureOrderLogic);
}

if (!content.includes('RESPOSTA AUTOMÁTICA DE INTERAÇÃO')) {
    content = content.replace(/if\s*\(text\.toLowerCase\(\)\s*===\s*'ping'\)/, `${interactionLogic}\n    if (text.toLowerCase() === 'ping')`);
}

fs.writeFileSync(path, content);
console.log('💎 [Robô Blindado] index.js atualizado com sucesso. Sem fantasmas e com resposta ao cliente!');
