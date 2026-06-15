const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\public\\index.html';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. Removemos o número do Admin (558293157048) da lista de bloqueio para que o chat de Pedidos Zap volte a aparecer
const oldLine = "const blockedNumbers = ['5582993225452', '558293157048', '82993225452']; // Números ocultos no chat UI";
const newLine = "const blockedNumbers = ['5582993225452', '82993225452']; // Números ocultos (Pedidos Zap agora é VISÍVEL)";

if (content.includes(oldLine)) {
    content = content.replace(oldLine, newLine);
    fs.writeFileSync(path, content);
    console.log('✅ Chat de Pedidos Zap liberado com sucesso!');
} else {
    // Tenta uma versão simplificada caso a anterior falhe por conta de caracteres especiais
    content = content.replace(/const blockedNumbers = \[.*?\].*?;/, "const blockedNumbers = ['5582993225452', '82993225452'];");
    fs.writeFileSync(path, content);
    console.log('✅ Chat de Pedidos Zap liberado via busca genérica!');
}
