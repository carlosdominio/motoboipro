const db = require('better-sqlite3')('garconnexpress.db');
const row = db.prepare("SELECT valor FROM sistema_config WHERE chave = 'categorias_cozinha'").get();
console.log(JSON.stringify(row));
