const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. Atualizar o switch de status do robô para enviar as mensagens proativas
const newStatusSwitch = `    switch (status) {
        case 'recebido':
            const myNumber = sock?.user?.id?.split(':')[0]?.split('@')[0];
            const isAutoSend = jid.includes(myNumber);

            if (isAutoSend) {
                console.log('⚠️ [Bot] Detectado auto-envio. Ignorando para evitar loop.');
                return res.json({ success: true, warning: 'auto_send_ignored' });
            }

            if (db) {
                const chats = db.get('chats').value() || {};
                if (!chats[jid]) {
                    chats[jid] = { name: jid.split('@')[0], messages: [], atendimentoManual: false, unreadCount: 0, lastUpdate: Date.now(), estado: 'delivery', activePedidoId: pedidoId };
                } else {
                    chats[jid].estado = 'delivery';
                    chats[jid].activePedidoId = pedidoId;
                    chats[jid].atendimentoManual = false;
                }
                await db.set('chats', chats).write();
            }

            message = \`Olá! 👋\\n\\n🛍️ *PEDIDO RECEBIDO E EM ANDAMENTO!*\\n\\nJá vinculamos seu pedido *#\${pedidoId}* ao seu WhatsApp. Estamos preparando tudo com muito carinho! 🚀\\n\\n1️⃣ - Ver Status do Pedido 🛵\\n2️⃣ - Falar com Atendente 👨‍💻\\n\\n_Digite apenas o número._\`;
            break;

        case 'preparando':
            message = \`👨‍🍳🍳 *SEU PEDIDO ESTÁ SENDO PREPARADO!*\\n\\nÓtimas notícias! O chef já começou a preparar seu pedido *#\${pedidoId}*. 🍳\\n\\nLogo ele sairá para entrega! 🛵\`;
            break;

        case 'saiu_entrega':
            message = \`🛵 *SAIU PARA ENTREGA!*\\n\\nSeu pedido *#\${pedidoId}* já está a caminho! 🚀\\n\\n🕒 *Prazo de entrega:* \${tempoEstimado}\\n\\nPrepare a mesa que estamos chegando! 🍴\`;
            break;

        case 'entregue':
            message = \`✅ *PEDIDO ENTREGUE!*\\n\\nSeu pedido *#\${pedidoId}* foi entregue com sucesso. Bom apetite! 🍽️\\n\\nAgradecemos a preferência!\`;
            break;

        case 'cancelado':
            message = \`❌ *PEDIDO CANCELADO*\\n\\nOlá. Infelizmente seu pedido *#\${pedidoId}* foi cancelado pelo estabelecimento. Caso tenha dúvidas, por favor, entre em contato conosco.\`;
            break;

        default:
            return res.status(400).json({ error: 'Status inválido' });
    }`;

// Localiza o switch antigo e substitui
const oldSwitchRegex = /switch\s*\(status\)\s*\{[\s\S]*?default:[\s\S]*?return\s*res\.status\(400\)\.json\(\{ error: 'Status inválido' \}\);[\s\S]*?\}/;
content = content.replace(oldSwitchRegex, newStatusSwitch);

// 2. Garantir que a mensagem seja enviada ao final do processo
// Procuramos o local onde o bot envia a mensagem e garantimos que ele não pule o envio se não for 'recebido'
const sendLogic = `    if (message) {
        try {
            const s = await sendHumanizedMessage(jid, { text: message });
            
            const rObj = {
                id: s.key.id,
                text: message,
                fromMe: true,
                time: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }),
                sender: sock?.user?.id || 'bot',
                pushName: 'Robô 🤖'
            };

            await saveMessage(jid, rObj, 'Robo');
            io.emit('new_msg', rObj);
            console.log(\`✅ [Bot] Notificação de status '\${status}' enviada para \${jid}\`);
        } catch (e) {
            console.error('❌ [Bot] Erro ao enviar notificação proativa:', e.message);
        }
    }`;

// Verifica se a lógica de envio já existe e a ajusta se necessário
if (!content.includes('Notificação de status')) {
    // Insere após o switch
    content = content.replace(newStatusSwitch, `${newStatusSwitch}\n\n${sendLogic}`);
}

fs.writeFileSync(path, content);
console.log('🚀 [Robô Proativo] index.js atualizado com avisos automáticos de status!');
