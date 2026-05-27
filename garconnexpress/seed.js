const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');

const db = new Database(path.join(__dirname, 'garconnexpress.db'));

async function seed() {
  console.log('🌱 Populando banco de dados...');

  // 1. Criar Tabelas
  db.exec(`
    CREATE TABLE IF NOT EXISTS mesas (id INTEGER PRIMARY KEY AUTOINCREMENT, numero INTEGER NOT NULL, status TEXT DEFAULT 'livre');
    CREATE TABLE IF NOT EXISTS menu (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, categoria TEXT NOT NULL, preco REAL NOT NULL, imagem TEXT, estoque INTEGER DEFAULT -1, validade DATE);
    CREATE TABLE IF NOT EXISTS garcons (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, usuario TEXT UNIQUE NOT NULL, senha TEXT NOT NULL DEFAULT '123', telefone TEXT);
    CREATE TABLE IF NOT EXISTS usuarios_admin (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario TEXT UNIQUE NOT NULL, senha TEXT NOT NULL);
  `);

  // 2. Mesas (1 a 10)
  const insertMesa = db.prepare('INSERT OR IGNORE INTO mesas (numero) VALUES (?)');
  for (let i = 1; i <= 10; i++) insertMesa.run(i);
  console.log('✅ 10 Mesas criadas.');

  // 3. Garçom Padrão (usuario: garcom1, senha: 123)
  const senhaHash = await bcrypt.hash('123', 10);
  db.prepare('INSERT OR IGNORE INTO garcons (nome, usuario, senha) VALUES (?, ?, ?)').run('Garçom Teste', 'garcom1', senhaHash);
  console.log('✅ Garçom "garcom1" (senha: 123) criado.');

  // 4. Admin Padrão (usuario: admin, senha: 123)
  const adminHash = await bcrypt.hash('123', 10);
  db.prepare('INSERT OR IGNORE INTO usuarios_admin (usuario, senha) VALUES (?, ?)').run('admin', adminHash);
  console.log('✅ Admin "admin" (senha: 123) criado.');

  // 5. Menu Inicial
  const insertMenu = db.prepare('INSERT OR IGNORE INTO menu (nome, categoria, preco, imagem, estoque) VALUES (?, ?, ?, ?, ?)');
  const itens = [
    ['Cerveja Skol 600ml', 'Bebidas', 12.00, 'https://images.tcdn.com.br/img/img_prod/1041113/cerveja_skol_pilsen_600ml_3301_1_452b12638e9195b004245cc363b90708.jpg', 50],
    ['Refrigerante Lata', 'Bebidas', 6.00, 'https://img.itdg.com.br/tdg/assets/default/images/recipe/000/000/000/356/356.jpg', 100],
    ['Água Mineral', 'Bebidas', 4.00, 'https://static.paodeacucar.com/img/uploads/1/530/20300530.jpg', 200],
    ['Petisco Batata Frita', 'Comidas', 25.00, 'https://claudia.abril.com.br/wp-content/uploads/2020/02/receita-batata-frita-crocante.jpg', -1]
  ];
  for (let item of itens) insertMenu.run(...item);
  console.log('✅ Itens de menu iniciais criados.');

  console.log('🚀 Banco de dados pronto!');
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Erro no seed:', err);
  process.exit(1);
});
