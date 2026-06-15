const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// Melhora o notify-delivery para priorizar o JID mapeado do cliente
const improvedNotify = `app.post('/api/notify-delivery', async (req, res) => {
    const { number, status, pedidoId, tempo } = req.body;
    console.log(\`📦 [Bot] Notificação recebida: Status=\${status}, Pedido=#\${pedidoId}, Número=\${number}\`);

    // PRIORIDADE: Tenta encontrar o JID real do cliente pelo mapeamento de ID do pedido
    let jid = pedidoIdToJid[pedidoId] || number;
    
    if (!jid.includes('@')) jid = jid.replace(/\\D/g, '') + '@s.whatsapp.net';
    
    console.log(\`🎯 [Bot] Enviando para JID final: \${jid}\`);`;

const oldNotifyStart = /app\.post\('\/api\/notify-delivery', async \(req, res\) => \{[\s\S]*?let jid = number;[\s\S]*?if \(!jid\.includes\('@'\)\) jid = jid\.replace\(\/\\D\/g, ''\) \+ '@s\.whatsapp\.net';/;
content = content.replace(oldNotifyStart, improvedNotify);

fs.writeFileSync(path, content);
console.log('✅ [Robô Inteligente] Rota notify-delivery agora prioriza o mapeamento de JID!');
