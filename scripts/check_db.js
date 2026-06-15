const Database = require('better-sqlite3');
const path = require('path');

try {
    const db = new Database(path.join(__dirname, 'garconnexpress.db'));
    const menu = db.prepare("SELECT id, nome, preco, preco_original, em_promocao, visivel FROM menu").all();
    console.log('MENU DATA:');
    console.log(JSON.stringify(menu, null, 2));
    
    const promos = db.prepare("SELECT * FROM menu WHERE em_promocao = 1 AND visivel = 1").all();
    console.log('\nPROMOS FOUND (SQLite 1):');
    console.log(JSON.stringify(promos, null, 2));

    const promosBool = db.prepare("SELECT * FROM menu WHERE em_promocao = 'true' AND visivel = 'true'").all();
    console.log('\nPROMOS FOUND (SQLite "true"):');
    console.log(JSON.stringify(promosBool, null, 2));

} catch (e) {
    console.error('ERROR:', e.message);
}
