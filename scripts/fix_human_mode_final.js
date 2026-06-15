const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Erro: Arquivo do robô não encontrado.');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. AJUSTE NO NOTIFY-DELIVERY: Garantir que status 'recebido' NÃO ative modo humano
const statusRecebidoFix = `    switch (status) {
        case 'recebido':
            if (db) {
                if (!chats[jid]) {
                    chats[jid] = { name: jid.split('@')[0], messages: [], atendimentoManual: false, unreadCount: 0, lastUpdate: Date.now() };
                } else {
                    // FORÇA FALSE para garantir que o menu automático funcione
                    chats[jid].atendimentoManual = false;
                }
                await db.set('chats', { ...chats }).write();
            }
            // ... (restante da mensagem)`;

// Substituição direta no bloco de switch do notify-delivery para o status recebido
content = content.replace(/case\s+'recebido':[\s\S]*?message\s*=\s*\`✅\s*\*PEDIDO\s*RECEBIDO!\*/, (match) => {
    return match.replace(/atendimentoManual:\s*true/, "atendimentoManual: false")
                .replace(/chats\[jid\]\.atendimentoManual\s*=\s*true/, "chats[jid].atendimentoManual = false");
});

fs.writeFileSync(path, content);
console.log('✅ [Robô Fix Final] Ativação automática de modo humano removida do status RECEBIDO!');
