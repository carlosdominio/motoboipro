const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'garconnexpress.db'));

try {
  const placeholder = 'https://placehold.co/300x200?text=Sem+Foto';
  db.prepare("UPDATE menu SET imagem = ? WHERE imagem LIKE '%claudia.abril.com.br%' OR imagem LIKE '%itdg.com.br%' OR imagem LIKE '%paodeacucar.com.br%' OR imagem LIKE '%static.paodeacucar.com%'").run(placeholder);
  console.log('✅ Fotos quebradas substituídas por imagem padrão.');
} catch (e) {
  console.error('Erro ao atualizar fotos:', e.message);
} finally {
  db.close();
}