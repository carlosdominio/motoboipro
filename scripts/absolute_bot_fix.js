const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. CORREÇÃO NA ROTA DE NOTIFICAÇÃO (Linhas 215 e 217)
// Removemos a ativação forçada do modo humano quando o Robô envia o aviso de "Pedido Recebido"
content = content.replace(
    /chats\[savedJid\] = \{ name: savedJid\.split\('@'\)\[0\], messages: \[\], atendimentoManual: true/g,
    "chats[savedJid] = { name: savedJid.split('@')[0], messages: [], atendimentoManual: false"
);
content = content.replace(
    /chats\[savedJid\]\.atendimentoManual = true;/g,
    "chats[savedJid].atendimentoManual = false;"
);

// 2. CORREÇÃO NO SWITCH DE STATUS (Caso exista duplicado em outros lugares)
content = content.replace(
    /atendimentoManual:\s*true/g,
    "atendimentoManual: false"
);

fs.writeFileSync(path, content);
console.log('✅ [Robô Fix Absoluto] Linhas 215 e 217 corrigidas para FALSE. Modo automático preservado!');
