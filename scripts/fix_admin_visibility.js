const fs = require('fs');
const path = 'C:\\Users\\Admin\\meu-zap-bot\\public\\index.html';

if (!fs.existsSync(path)) {
    console.error('❌ Arquivo não encontrado');
    process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

// 1. Refinar a lista de bloqueio e a função de renderização
const smartFilter = `sortedJids.forEach(jid => {
            const chat = chatData[jid];
            const cleanJid = jid.split('@')[0].split(':')[0];
            
            // REGRA DE OURO: Se for o admin mas não for o chat de Pedidos Zap, esconde.
            if (cleanJid.includes('558293157048') && chat.name !== 'Pedidos Zap 📦') {
                return;
            }
            
            if (blockedNumbers.some(num => cleanJid.includes(num))) {
                console.log('🙈 [UI] Ocultando chat de sistema/admin:', jid);
                return;
            }`;

content = content.replace(/sortedJids\.forEach\(jid => \{[\s\S]*?return;\s*\}/, smartFilter);

fs.writeFileSync(path, content);
console.log('✅ [Filtro de Admin] Apenas o chat "Pedidos Zap" ficará visível agora!');
