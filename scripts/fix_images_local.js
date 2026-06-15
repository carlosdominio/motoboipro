const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'garconnexpress.db'));

const novasImagens = {
  'Cerveja Skol 600ml': 'https://images.unsplash.com/photo-1566633806327-68e152aaf26d?w=200&h=200&fit=crop',
  'Refrigerante Lata': 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=200&h=200&fit=crop',
  'Água Mineral': 'https://images.unsplash.com/photo-1560023907-5f339617ea30?w=200&h=200&fit=crop',
  'Petisco Batata Frita': 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=200&h=200&fit=crop'
};

console.log('🔄 Atualizando links de imagens quebrados...');

const update = db.prepare('UPDATE menu SET imagem = ? WHERE nome = ?');

for (const [nome, url] of Object.entries(novasImagens)) {
  const info = update.run(url, nome);
  if (info.changes > 0) {
    console.log(`✅ Imagem de "${nome}" atualizada.`);
  }
}

console.log('🚀 Imagens corrigidas!');
process.exit(0);
