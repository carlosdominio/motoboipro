const Database = require('better-sqlite3');
const db = new Database('garconnexpress.db');

try {
  const rows = db.pragma('table_info(pedidos)');
  console.log(JSON.stringify(rows, null, 2));
} catch (e) {
  console.error(e);
} finally {
  db.close();
}
