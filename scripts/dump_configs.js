const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'garconnexpress.db'));

try {
    const configs = db.prepare("SELECT * FROM sistema_config").all();
    console.log('--- SISTEMA CONFIG ---');
    console.log(JSON.stringify(configs, null, 2));
} catch (e) {
    console.error('Erro ao ler configs:', e.message);
}
db.close();
