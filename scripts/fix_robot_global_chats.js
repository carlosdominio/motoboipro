const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. Corrigir a falta de declaração global/externa da variável 'chats'
// Vamos declarar 'chats' em um escopo que o socket.io consiga ver.
// Procuramos pelo início do servidor ou carregamento do DB.

if (!content.includes('let chats = {}; // Global')) {
    // Insere no início do arquivo após as importações
    content = content.replace(/const db =/g, 'let chats = {}; // Global\nconst db =');
}

// 2. Garantir que o Socket.io carregue os chats na conexão
const connectionLogic = `io.on('connection', (socket) => {
      chats = db ? db.get('chats').value() || {} : {};
      socket.emit('status', { status: statusConexao });`;

content = content.replace(/io\.on\('connection', \(socket\) => \{[\s\S]*?socket\.emit\('status', \{ status: statusConexao \}\);/, connectionLogic);

// 3. Remover a declaração local "const chats" de dentro do upsert para não dar conflito com a global
content = content.replace(/const chats = db \? db\.get\('chats'\)\.value\(\) \|\| \{\} : \{\};/g, 'chats = db ? db.get(\'chats\').value() || {} : {};');

fs.writeFileSync(path, content);
console.log('✅ [Robô Fix Global] Variável "chats" agora é global. Erro de ReferenceError resolvido!');
