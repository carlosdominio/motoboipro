const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. Atualizar o bloco de mensagens proativas (Aviso Automático de Status)
const newProactiveLogic = `        case 'recebido':
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
            break;`;

// Localiza e substitui o bloco do switch
const oldSwitchPart = /case\s+'recebido':[\s\S]*?break;\s*case\s+'preparando':[\s\S]*?case\s+'cancelado':[\s\S]*?break;/;
content = content.replace(oldSwitchPart, newProactiveLogic);

fs.writeFileSync(path, content);
console.log('✅ [Robô Ativo] Notificações proativas de status habilitadas com sucesso!');
