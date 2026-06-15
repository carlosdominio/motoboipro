const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\index.js';
let content = fs.readFileSync(path, 'utf8');

// Remove a rota antiga /api/delivery-webhook que enviava o Cardápio Digital indesejado
const oldRouteRegex = /\/\/ ROTA PARA RECEBIMENTO DE PEDIDOS DO DELIVERY[\s\S]*?app\.post\('\/api\/delivery-webhook'[\s\S]*?\}\);[\s\S]*?\}\);[\s\S]*?\n\n/g;

if (oldRouteRegex.test(content)) {
    content = content.replace(oldRouteRegex, '// Rota antiga removida para evitar conflito com novo menu\n\n');
    fs.writeFileSync(path, content);
    console.log('Rota antiga /api/delivery-webhook removida do robô com sucesso!');
} else {
    console.log('Rota antiga não encontrada ou já removida.');
}
