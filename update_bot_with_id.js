const fs = require('fs');
const botPath = 'C:\\\\Users\\\\Admin\\\\meu-zap-bot\\\\index.js';

if (!fs.existsSync(botPath)) {
    console.error('Bot path not found');
    process.exit(1);
}

let content = fs.readFileSync(botPath, 'utf8');

const regex = /app\.post\('\/api\/notify-delivery', async \(req, res\) => \{[\s\S]*?\}\);/m;

const newNotify = `app.post('/api/notify-delivery', async (req, res) => {
    const { number, status, pedidoId, tempo, mensagem } = req.body;
    console.log(\`📦 [Bot] Notificação recebida: Status=\${status}, Pedido=#\${pedidoId}, Número=\${number}\`);

    let jid = null;
    let fallbackJid = number;
    if (fallbackJid && !fallbackJid.includes('@')) {
        let cleaned = fallbackJid.replace(/\\D/g, '');
        if (cleaned.length === 10 || cleaned.length === 11) cleaned = '55' + cleaned;
        fallbackJid = cleaned + '@s.whatsapp.net';
    }

    // 1. TENTA BUSCAR O JID PELO ID DO PEDIDO NO BANCO DE DADOS DO ROBÔ
    const chats = typeof db !== 'undefined' && db ? db.get('chats').value() || {} : {};
    
    if (pedidoId) {
        for (const [chatJid, chatData] of Object.entries(chats)) {
            if (chatData.activePedidoId == pedidoId || chatData.ultimoPedidoId == pedidoId) {
                jid = chatJid;
                console.log(\`✅ [Bot] JID localizado pelo Pedido #\${pedidoId}: \${jid}\`);
                break;
            }
        }
    }

    // 2. SE NÃO ENCONTROU PELO ID, USA O NÚMERO COMO FALLBACK
    if (!jid && fallbackJid) {
        jid = fallbackJid;
        console.log(\`⚠️ [Bot] Pedido não encontrado no cache. Usando número de fallback: \${jid}\`);
    }

    if (!jid) {
        return res.status(400).json({ error: 'Não foi possível determinar o destino da mensagem' });
    }

    let message = mensagem || '';
    const tempoEstimado = tempo || '30-50 min';

    if (!message) {
        switch (status) {
            case 'recebido':
                message = \`Olá! 👋\\n\\n🛍️ *PEDIDO RECEBIDO E EM ANDAMENTO!*\\n\\nJá vinculamos seu pedido *#\${pedidoId}* ao seu WhatsApp. Estamos preparando tudo com muito carinho! 🚀\\n\\n1️⃣ - Ver Status do Pedido 🛵\\n2️⃣ - Falar com Atendente 👨‍💻\\n\\n_Digite apenas o número._\`;
                break;
            case 'preparando':
                message = \`👨‍🍳🍳 *SEU PEDIDO ESTÁ SENDO PREPARADO!*\\n\\nÓtimas notícias! O chef já começou a preparar seu pedido *#\${pedidoId}*. 🍳\\n\\nLogo ele sairá para entrega! 🛵\`;
                break;
            case 'saiu_entrega':
                message = \`🛵 *SAIU PARA ENTREGA!*\\n\\nSeu pedido *#\${pedidoId}* já está a caminho! 🚀\\n\\n🕒 *Prazo de entrega:* \${tempoEstimado}\\n\\nPrepare a mesa que estamos chegando! 🍴\`;
                break;
            case 'pronto':
                message = \`✅ *PEDIDO PRONTO!*\\n\\nSeu pedido *#\${pedidoId}* está pronto e aguardando retirada ou entrega! 📦\`;
                break;
            case 'entregue':
                message = \`✅ *PEDIDO ENTREGUE!*\\n\\nSeu pedido *#\${pedidoId}* foi entregue com sucesso. Bom apetite! 🍽️\\n\\nAgradecemos a preferência!\`;
                break;
            case 'cancelado':
                message = \`❌ *PEDIDO CANCELADO*\\n\\nOlá. Infelizmente seu pedido *#\${pedidoId}* foi cancelado pelo estabelecimento. Caso tenha dúvidas, por favor, entre em contato conosco.\`;
                break;
            default:
                return res.status(400).json({ error: 'Status inválido' });
        }
    }

    const myNumber = sock?.user?.id?.split(':')[0]?.split('@')[0];
    const isAutoSend = myNumber && jid.includes(myNumber);

    if (isAutoSend && status === 'recebido') {
        console.log('⚠️ [Bot] Detectado auto-envio. Ignorando para evitar loop.');
        return res.json({ success: true, warning: 'auto_send_ignored' });
    }

    // 3. ATUALIZA O STATUS DO CHAT NO BANCO
    if (typeof db !== 'undefined' && db) {
        if (!chats[jid]) {
            chats[jid] = { name: jid.split('@')[0], messages: [], atendimentoManual: false, unreadCount: 0, lastUpdate: Date.now(), estado: 'delivery', activePedidoId: pedidoId };
        } else {
            chats[jid].estado = 'delivery';
            chats[jid].activePedidoId = pedidoId;
            chats[jid].atendimentoManual = false;
        }
        await db.set('chats', chats).write();
    }

    if (!sock || statusConexao !== 'CONECTADO') {
        console.log('⚠️ [Bot] Bot desconectado, tentará enviar assim que possível.');  
        if (!sock) return res.status(503).json({ error: 'Bot não inicializado' });
    }

    try {
        console.log(\`📤 [Bot] Enviando mensagem de delivery para \${jid}...\`);
        const s = await sendHumanizedMessage(jid, { text: message });

        const rObj = {
            id: s.key.id,
            text: message,
            fromMe: true,
            time: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }),
            sender: sock?.user?.id || 'bot',
            pushName: 'Robô 🤖'
        };

        if (typeof saveMessage === 'function') await saveMessage(jid, rObj, 'Robo');
        if (typeof io !== 'undefined') io.emit('new_msg', rObj);
        
        res.json({ success: true });
    } catch (e) {
        console.error('❌ [Bot] Erro ao enviar notificação de delivery:', e);
        res.status(500).json({ error: e.message });
    }
});`;

content = content.replace(regex, newNotify);
fs.writeFileSync(botPath, content);
console.log('Bot notify-delivery ID-based update applied');