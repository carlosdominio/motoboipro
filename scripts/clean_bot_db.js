const fs = require('fs');
const dbPath = 'C:\\Users\\Admin\\meu-zap-bot\\db.json';

if (fs.existsSync(dbPath)) {
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    if (db.pedidoIdToJid) {
        db.pedidoIdToJid = {};
    }
    if (db.chats) {
        Object.values(db.chats).forEach(c => {
            c.atendimentoManual = false;
            c.activePedidoId = null;
            c.ultimoPedidoId = null;
        });
    }
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    console.log('🧹 [Bot DB] Banco de dados limpo para novo teste.');
} else {
    console.log('⚠️ DB não encontrado.');
}
