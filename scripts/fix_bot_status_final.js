const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. Corrigir a URL da API para consulta de status
const oldFetch = 'fetch(`https://garconnexpress.vercel.app/api/pedidos/${pId}`)';
const newFetch = 'fetch(`${DELIVERY_API_URL}/${pId}`)';
if (content.includes(oldFetch)) {
    content = content.replace(oldFetch, newFetch);
    console.log('✅ URL da API sincronizada para localhost.');
}

// 2. Corrigir o erro de undefined na mensagem de status
const oldStatusLineStart = 'reply = `📦 *STATUS DO PEDIDO #${pId}*';
const oldStatusLineEnd = 'te avisaremos qualquer mudança!`;';

const sI = content.indexOf(oldStatusLineStart);
const eI = content.indexOf(oldStatusLineEnd, sI);

if (sI !== -1 && eI !== -1) {
    const fullEnd = eI + oldStatusLineEnd.length;
    const oldBlock = content.substring(sI, fullEnd);
    
    const newBlock = `const statusLabel = stMap[ped.status] || ped.status || 'Processando...';
                                    reply = \`📦 *STATUS DO PEDIDO #\${pId}*\\n\\nAtualmente seu pedido está: *\${statusLabel}*\\n\\nFique atento, te avisaremos qualquer mudança!\`;`;
    
    content = content.replace(oldBlock, newBlock);
    console.log('✅ Mensagem de status protegida contra undefined.');
}

// 3. Melhorar o mapeamento de status (adicionar 'servido')
if (!content.includes("'servido': 'Entregue! 😋'")) {
    content = content.replace("'entregue': 'Entregue! Bom apetite! 😋',", "'entregue': 'Entregue! Bom apetite! 😋',\n                                        'servido': 'Entregue! Bom apetite! 😋',");
}

fs.writeFileSync(path, content);
console.log('🚀 [Robô Calibrado] Erros de status resolvidos!');
