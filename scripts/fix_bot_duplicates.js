const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Normalização de JID no upsert
content = content.replace(
    /const jid = msg\.key\.remoteJid;/,
    "const rawJid = msg.key.remoteJid; const jid = rawJid.replace(/:[0-9]+/, '');"
);

// 2. Normalização de JID no notify-delivery
content = content.replace(
    /let jid = number;/,
    "let jid = number.replace(/:[0-9]+/, '');"
);

// 3. Modificação no saveMessage para ignorar auto-envio e normalizar JID
const newSaveMessage = `async function saveMessage(rawJid, msg, name) {
    if (!rawJid || rawJid.includes('@newsletter') || rawJid.includes('@broadcast')) return;
    
    // Normaliza o JID removendo sufixos de dispositivo (:1, :2, etc)
    const jid = rawJid.replace(/:[0-9]+/, '');

    const myJid = sock?.user?.id?.split(':')[0]?.split('@')[0];
    const isSelf = myJid && jid.includes(myJid);

    // IGNORA AUTO-ENVIO (Mensagens para si mesmo ou do próprio bot)
    if (isSelf) {
        console.log('🔇 [Bot] Ignorando salvamento de mensagem de auto-envio para manter o painel limpo.');
        return;
    }

    const chats = db.get('chats').value() || {};
    if (!chats[jid]) {
        chats[jid] = { name: jid.split('@')[0], messages: [], atendimentoManual: false, unreadCount: 0, lastUpdate: Date.now() };
    }

    chats[jid].lastUpdate = Date.now();

    if (!msg.fromMe) {
        chats[jid].unreadCount = (chats[jid].unreadCount || 0) + 1;
    }

    if (name && name !== "Voce" && name !== "Robo") {
        chats[jid].name = name;
    }

    if (chats[jid].messages.some(m => m.id === msg.id)) return;

    chats[jid].messages.push(msg);
    if (chats[jid].messages.length > 100) chats[jid].messages.shift();

    await db.set('chats', { ...chats }).write();
}`;

const oldSaveMessageRegex = /async function saveMessage\([\s\S]*?await db\.set\('chats', \{ \.\.\.chats \} \)\.write\(\);\s*\}/;
content = content.replace(oldSaveMessageRegex, newSaveMessage);

fs.writeFileSync(path, content);
console.log('✅ Robô atualizado: JIDs normalizados e auto-envio (mensagens para si mesmo) agora são ignorados!');
