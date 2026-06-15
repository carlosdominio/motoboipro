const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. Corrigir o erro "Cannot access 'chats' before initialization"
// Vamos mover a declaração de chats para o início do handler de mensagens
const msgUpsertStart = "sock.ev.on('messages.upsert', async (m) => {";
const chatsInit = "\n            const chats = db ? db.get('chats').value() || {} : {};\n";

if (content.includes(msgUpsertStart) && !content.includes("const chats = db ? db.get('chats').value()")) {
    content = content.replace(msgUpsertStart, msgUpsertStart + chatsInit);
}

// 2. Remover declarações duplicadas ou problemáticas de 'chats' dentro do mesmo bloco
// Procuramos por referências que usem 'typeof chats' ou declarações locais que conflitem
content = content.replace(/let currentChats = \(typeof chats !== 'undefined'\) \? chats : \(db \? db\.get\('chats'\)\.value\(\) : \{\}\);/g, "let currentChats = chats;");
content = content.replace(/const chats = db\.get\('chats'\)\.value\(\) \|\| \{\};/g, "/* chats já inicializado */");

// 3. Corrigir a variável 'status' que não existe no escopo de mensagens
// No bloco isAutoOrder, trocamos 'status' por 'false' (para manter modo automático)
content = content.replace(/currentChats\[jid\]\.atendimentoManual = status;/g, "currentChats[jid].atendimentoManual = false;");

fs.writeFileSync(path, content);
console.log('✅ [Robô Fix Scoping] Erro de inicialização de "chats" e variável "status" corrigidos!');
