const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. Garantir que DELIVERY_API_URL esteja definida no topo do arquivo
if (!content.includes('const DELIVERY_API_URL')) {
    const portDef = 'const port = 3002;';
    content = content.replace(portDef, `${portDef}\nconst DELIVERY_API_URL = process.env.DELIVERY_API_URL || 'http://localhost:3001/api/pedidos';`);
    console.log('✅ Variável DELIVERY_API_URL definida no topo.');
}

// 2. Corrigir o bloco de consulta de status (Opção 1)
const oldTryBlock = `try {
                                    const resp = await fetch(\`\${DELIVERY_API_URL}/\${pId}\`);
                                    const ped = await resp.json();
                                    const stMap = {
                                        'recebido': 'Recebido (Na fila da cozinha) 📝',
                                        'preparando': 'Sendo preparado pelo Chef 👨‍🍳',
                                        'pronto': 'Pronto e aguardando entrega! 🥡',
                                        'saiu_entrega': 'A caminho da sua casa! 🛵',
                                        'entregue': 'Entregue! Bom apetite! 😋',
                                        'servido': 'Entregue! Bom apetite! 😋',
                                        'cancelado': 'Cancelado ❌',
                                        'aguardando_fechamento': 'Pronto/Entregue (Aguardando finalização) ✅'
                                    };
                                    const statusLabel = stMap[ped.status] || ped.status || 'Processando...';
                                    reply = \`📦 *STATUS DO PEDIDO #\${pId}*\\n\\nAtualmente seu pedido está: *\${statusLabel}*\\n\\nFique atento, te avisaremos qualquer mudança!\`;
                                } catch (err) {
                                    reply = "Não consegui consultar o status agora. Tente novamente em instantes! ⏳";
                                }`;

const newTryBlock = `try {
                                    const resp = await fetch(\`\${DELIVERY_API_URL}/\${pId}\`);
                                    if (!resp.ok) throw new Error('HTTP ' + resp.status);
                                    const ped = await resp.json();
                                    console.log('📦 [Bot] Status do pedido #' + pId + ':', ped.status);
                                    const stMap = {
                                        'recebido': 'Recebido (Na fila da cozinha) 📝',
                                        'preparando': 'Sendo preparado pelo Chef 👨‍🍳',
                                        'pronto': 'Pronto e aguardando entrega! 🥡',
                                        'saiu_entrega': 'A caminho da sua casa! 🛵',
                                        'entregue': 'Entregue! Bom apetite! 😋',
                                        'servido': 'Entregue! Bom apetite! 😋',
                                        'cancelado': 'Cancelado ❌',
                                        'aguardando_fechamento': 'Pronto/Entregue (Aguardando finalização) ✅'
                                    };
                                    const statusLabel = stMap[ped.status] || ped.status || 'Processando...';
                                    reply = \`📦 *STATUS DO PEDIDO #\${pId}*\\n\\nAtualmente seu pedido está: *\${statusLabel}*\\n\\nFique atento, te avisaremos qualquer mudança!\`;
                                } catch (err) {
                                    console.error('❌ [Bot] Erro ao buscar status local:', err.message);
                                    // Tenta fallback para o Vercel se o local falhar (caso esteja testando cruzado)
                                    try {
                                        const respV = await fetch(\`https://garconnexpress.vercel.app/api/pedidos/\${pId}\`);
                                        const pedV = await respV.json();
                                        const stLabelV = { 'recebido': 'Recebido 📝', 'preparando': 'Preparando 👨‍🍳', 'pronto': 'Pronto 🥡', 'saiu_entrega': 'A caminho 🛵', 'entregue': 'Entregue 😋' }[pedV.status] || pedV.status;
                                        reply = \`📦 *STATUS DO PEDIDO #\${pId}* (Nuvem)\\n\\nAtualmente seu pedido está: *\${stLabelV}*\`;
                                    } catch (e2) {
                                        reply = "Não consegui consultar o status no momento. O servidor pode estar ocupado. Tente novamente em 1 minuto! ⏳";
                                    }
                                }`;

if (content.includes('const resp = await fetch(`${DELIVERY_API_URL}/${pId}`);')) {
    // Substituição bruta para garantir o funcionamento
    const startIdx = content.indexOf('try {');
    const targetIdx = content.indexOf('fetch(`${DELIVERY_API_URL}/${pId}`)', startIdx);
    if (targetIdx !== -1) {
        // Encontramos o try correto
        const endOfTry = content.indexOf('}', content.indexOf('reply = "Não consegui consultar o status agora', targetIdx)) + 1;
        const oldSection = content.substring(content.lastIndexOf('try {', targetIdx), endOfTry);
        content = content.replace(oldSection, newTryBlock);
        console.log('✅ Bloco de consulta de status reconstruído com fallback inteligente.');
    }
}

fs.writeFileSync(path, content);
console.log('🚀 [Robô Inteligente] Sistema de status recalibrado com sucesso!');
