const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';
let content = fs.readFileSync(path, 'utf8');

const correctSwitch = `    switch (status) {
        case 'recebido':
            const myNumber = sock?.user?.id?.split(':')[0]?.split('@')[0];
            const isAutoSend = jid.includes(myNumber);
            if (isAutoSend) {
                console.log('⚠️ [Bot] Detectado auto-envio. Ignorando.');
                return res.json({ success: true, warning: 'auto_send_ignored' });
            }
            message = \`✅ *PEDIDO RECEBIDO!*\\n\\nOlá \${clientName}! Seu pedido #\${pedidoId} foi recebido e já está em processamento.\\n\\nEscolha uma opção:\\n1️⃣ - Acompanhar Status 🛵\\n2️⃣ - Falar com Atendente 👨‍💻\\n\\n_Digite apenas o número da opção._\`;
            break;
        case 'preparando':
            message = '👨‍🍳🍳 *SEU PEDIDO ESTÁ SENDO PREPARADO!*\\n\\nÓtimas notícias! O chef já começou a preparar seu pedido #'+pedidoId+'. 🍳\\n\\nLogo ele sairá para entrega! 🛵';
            break;
        case 'saiu_entrega':
            message = '🛵 *SAIU PARA ENTREGA!*\\n\\nSeu pedido #'+pedidoId+' já está a caminho! 🚀\\n\\n🕒 *Prazo de entrega:* '+tempoEstimado+'\\n\\nPrepare a mesa que estamos chegando! 🍴';
            break;
        case 'entregue':
            message = '✅ *PEDIDO ENTREGUE!*\\n\\nSeu pedido #'+pedidoId+' foi entregue com sucesso. Bom apetite! 🍽️\\n\\nAgradecemos a preferência!';
            break;
        default:
            return res.status(400).json({ error: 'Status inválido' });
    }`;

// Limpa a bagunça deixada pelos replaces anteriores
const messyRegex = /REPLACE_ME[\s\S]*?default:[\s\S]*?return\s*res\.status\(400\)\.json\(\{[\s\S]*?\}\);[\s\S]*?\}/;
content = content.replace(messyRegex, correctSwitch);

fs.writeFileSync(path, content);
console.log('Bot index.js limpo e corrigido com o switch correto!');
