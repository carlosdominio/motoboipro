const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. Normalização de JID (Converter @lid para o número real se disponível)
const jidNormalization = `
                  const rawJid = msg.key.remoteJid; 
                  // Normalização: Se for @lid, tenta pegar o número real do participante ou limpa o sufixo
                  let jid = rawJid.replace(/:[0-9]+/, '');
                  if (jid.includes('@lid')) {
                      jid = (msg.key.participant ? msg.key.participant.replace(/:[0-9]+/, '') : jid).replace('@lid', '@s.whatsapp.net');
                  }
`;

// Substitui a extração antiga de JID
content = content.replace(/const rawJid = msg\.key\.remoteJid; const jid = rawJid\.replace\(/:\[0-9\]\+/, ''\);/, jidNormalization);

// 2. Trava de Auto-Envio Reforçada (Ignorar se o JID final for o do Admin ou do Bot)
const autoSendPrevention = `
                    // TRAVA ANTI-FANTASMA: Se a mensagem for do próprio robô ou para o Admin (notificação), ele NÃO responde
                    const myNum = sock?.user?.id?.split(':')[0]?.split('@')[0];
                    const adminNum = (typeof ADMIN_NUMBER !== 'undefined') ? ADMIN_NUMBER.replace(/\\D/g, '') : '';
                    const cleanJid = jid.split('@')[0].replace(/\\D/g, '');

                    if (cleanJid === myNum || cleanJid === adminNum) {
                        console.log('🚫 [Bot] Notificação interna detectada (' + cleanJid + '). Mantendo silêncio.');
                        return; 
                    }
`;

content = content.replace(/\/\/ TRAVA ANTI-FANTASMA:[\s\S]*?return; \/\/ Para aqui: você recebe o Zap, mas o bot não responde nem cria lixo no painel[\s\S]*?\}/, autoSendPrevention + '                }');

fs.writeFileSync(path, content);
console.log('✅ [Robô Fix LID] JIDs normalizados e trava de auto-envio reforçada!');
