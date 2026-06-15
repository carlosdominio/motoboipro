const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. Normalização de JID (Converter @lid para o número real se disponível)
// Usamos uma string literal para evitar erros de regex complexo
const oldLine = 'const rawJid = msg.key.remoteJid; const jid = rawJid.replace(/:[0-9]+/, \'\');';
const newLine = `
                  const rawJid = msg.key.remoteJid; 
                  // Normalização: Se for @lid (ID interno), tenta pegar o número real
                  let jid = rawJid.replace(/:[0-9]+/, '');
                  if (jid.includes('@lid')) {
                      jid = (msg.key.participant ? msg.key.participant.replace(/:[0-9]+/, '') : jid).replace('@lid', '@s.whatsapp.net');
                  }
`;

if (content.includes(oldLine)) {
    content = content.replace(oldLine, newLine);
} else {
    console.log('⚠️ Linha de extração de JID não encontrada com string literal. Tentando busca aproximada...');
    content = content.replace(/const rawJid = msg\.key\.remoteJid; const jid = rawJid\.replace\(.*?\);/, newLine);
}

// 2. Trava de Auto-Envio Reforçada (Ignorar se o JID final for o do Admin ou do Bot)
const autoSendPrevention = `
                    // TRAVA ANTI-FANTASMA: Se a mensagem for do próprio robô ou para o Admin (notificação), ele NÃO responde
                    const myNum = sock?.user?.id?.split(':')[0]?.split('@')[0];
                    const adminNum = (typeof ADMIN_NUMBER !== 'undefined') ? ADMIN_NUMBER.replace(/\\D/g, '') : '558293157048';
                    const cleanJid = jid.split('@')[0].replace(/\\D/g, '');

                    if (cleanJid === myNum || cleanJid === adminNum) {
                        console.log('🚫 [Bot] Notificação interna detectada (' + cleanJid + '). Mantendo silêncio.');
                        return; 
                    }
`;

// Substitui o bloco de trava antigo
content = content.replace(/\/\/ TRAVA ANTI-FANTASMA:[\s\S]*?return; \/\/ Para aqui: você recebe o Zap, mas o bot não responde nem cria lixo no painel/, autoSendPrevention);

fs.writeFileSync(path, content);
console.log('✅ [Robô Fix LID Final] index.js atualizado com sucesso. Conversão de @lid ativa!');
