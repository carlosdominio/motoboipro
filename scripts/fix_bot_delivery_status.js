const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. Corrigir o mapeamento de status para Delivery
// 'servido' no admin para delivery significa 'A Caminho'
const oldServido = "'servido': 'Entregue! Bom apetite! 😋'";
const newServido = "'servido': 'A caminho da sua casa! 🛵'";

if (content.includes(oldServido)) {
    content = content.replace(oldServido, newServido);
}

// 2. Corrigir 'aguardando_fechamento' para ser o 'Entregue' real
const oldAguardando = "'aguardando_fechamento': 'Pronto/Entregue (Aguardando finalização) ✅'";
const newAguardando = "'aguardando_fechamento': 'Entregue! Bom apetite! 😋'";

if (content.includes(oldAguardando)) {
    content = content.replace(oldAguardando, newAguardando);
}

fs.writeFileSync(path, content);
console.log('✅ [Status Fix] Mapeamento corrigido: servido = A CAMINHO!');
