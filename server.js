const express = require('express');
const path = require('path');
// Carregamento condicional do SQLite para evitar erros no Vercel
let Database = null;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.log("⚠️ SQLite não carregado (provavelmente ambiente Vercel/Postgres)");
}
const { Pool } = require('pg');
const Pusher = require('pusher');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const ioClient = require('socket.io-client');

// Configuração de ambiente
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(express.json());
app.use(cookieParser());

// INTEGRAÇÃO WHATSAPP (BOT EXTERNO)
let whatsappSocket = null;
if (process.env.WHATSAPP_BOT_URL) {
  console.log('📡 Iniciando conexão com Bot WhatsApp:', process.env.WHATSAPP_BOT_URL);
  whatsappSocket = ioClient(process.env.WHATSAPP_BOT_URL, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
  });
  
  whatsappSocket.on('connect', () => console.log('✅ Conectado ao Bot do WhatsApp (Render)'));
  whatsappSocket.on('connect_error', (err) => console.log('❌ Erro de conexão com Bot WhatsApp:', err.message));
  whatsappSocket.on('disconnect', () => console.log('⚠️ Desconectado do Bot WhatsApp'));
}

async function sendWhatsAppMessage(text) {
  try {
    const config = await query("SELECT valor FROM sistema_config WHERE chave = 'whatsapp_enabled'");
    const isEnabled = config.rows[0]?.valor === 'true';

    if (!isEnabled) {
      console.log('🚫 [WhatsApp] Automação desativada pelo usuário');
      return;
    }

    if (whatsappSocket && whatsappSocket.connected && process.env.WHATSAPP_NOTIFY_NUMBER) {
      const number = process.env.WHATSAPP_NOTIFY_NUMBER.replace(/\D/g, '');
      whatsappSocket.emit('send_msg', { 
        number: number, 
        text: text 
      });
      console.log(`📱 [WhatsApp] Enviando para ${number}: ${text.substring(0, 30)}...`);
    } else {
      console.log('⚠️ [WhatsApp] Bot não conectado ou número não configurado');
    }
  } catch (e) {
    console.error('❌ Erro ao enviar WhatsApp:', e.message);
  }
}

// Log global de todas as requisições
app.use((req, res, next) => {
  console.log(`📡 [${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// Configuração de CORS dinâmica baseada em ALLOWED_ORIGINS
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['*'];
app.use(require('cors')({
  origin: (origin, callback) => {
    // Se allowedOrigins for ['*'], permite qualquer origem
    if (allowedOrigins.includes('*') || !origin) {
      callback(null, true);
    } else if (allowedOrigins.some(o => origin.startsWith(o.trim()))) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

const JWT_SECRET = process.env.JWT_SECRET || 'seusegredomuitolouco123';
const saltRounds = 10;

// INICIALIZAÇÃO DO PUSHER (Com as novas chaves do usuário)
const pusherConfig = {
  appId: process.env.PUSHER_APP_ID || "2122978",
  key: process.env.PUSHER_APP_KEY || "5b2b284e309dea9d90fb",
  secret: process.env.PUSHER_APP_SECRET || "11b8e639d6b1d940871a",
  cluster: process.env.PUSHER_CLUSTER || "sa1",
  useTLS: true
};

let pusher = new Pusher(pusherConfig);
console.log('📡 PUSHER CONFIGURADO COM SUCESSO (LOCAL/VERCEL)');

const isPostgres = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);
let db;

if (isPostgres) {
    // Configuração OTIMIZADA para Vercel/Neon
    let connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    
    // Remove sslmode da string para evitar conflito/aviso e deixar o objeto ssl controlar
    if (connectionString) {
      try {
        const url = new URL(connectionString);
        url.searchParams.delete('sslmode');
        connectionString = url.toString();
      } catch (e) {
        // Se falhar o parse, usa como está
      }
    }
    
    db = new Pool({ 
      connectionString,
      ssl: { 
        rejectUnauthorized: false, // Aceita certificados self-signed do Neon
        require: true 
      },
      max: 1, // Limite estrito para Serverless
      min: 0, // Não mantém conexões mínimas
      idleTimeoutMillis: 10000, // 10 segundos de idle
      connectionTimeoutMillis: 30000, // 30 segundos para conectar
      acquireTimeoutMillis: 30000, // 30 segundos para adquirir conexão
      createTimeoutMillis: 30000, // 30 segundos para criar conexão
      destroyTimeoutMillis: 5000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 200,
    });
    
    db.on('error', (err) => {
      console.error('⚠️ Erro no Pool do Postgres (recuperável):', err.message);
    });
  } else {
  if (!Database) {
    console.error("❌ ERRO CRÍTICO: SQLite não disponível e Postgres não configurado.");
    process.exit(1);
  }
  db = new Database(path.join(__dirname, 'garconnexpress.db'));
}



async function query(text, params) {
  const executeQuery = async () => {
    try {
      if (isPostgres) {
        let i = 1;
        const pgText = text.replace(/\?/g, () => `$${i++}`);
        const res = (params && params.length > 0) ? await db.query(pgText, params) : await db.query(pgText);
        return { 
          rows: res.rows || [], 
          changes: res.rowCount || 0, 
          lastInsertRowid: (res.rows && res.rows.length > 0) ? (res.rows[0].id || null) : null 
        };
      } else {
        const stmt = db.prepare(text);
        if (text.trim().toUpperCase().startsWith('SELECT') || text.trim().toUpperCase().includes('RETURNING')) {
          const rows = stmt.all(...(params || []));
          return { 
            rows: rows,
            lastInsertRowid: (rows && rows.length > 0) ? (rows[0].id || null) : null
          };
        } else {
          const info = stmt.run(...(params || []));
          return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
        }
      }
    } catch (err) {
      console.error('DATABASE ERROR:', err.message);
      throw err;
    }
  };

  // Para Postgres, usa retry automático em caso de timeout
  if (isPostgres) {
    return retryWithDelay(executeQuery, 3, 500);
  } else {
    return executeQuery();
  }
}

async function safePusherTrigger(channel, event, data) {
  if (!pusher) {
    console.log(`⚠️ Pusher não configurado. Ignorando evento: ${event}`);
    return;
  }
  try {
    console.log(`📡 Enviando Pusher: Canal=${channel}, Evento=${event}`);
    await pusher.trigger(channel, event, data);
  } catch (e) {
    console.error(`❌ Pusher Error (${event}):`, e.message);
  }
}

async function notifyStatus(pedidoId, mesaDbId, status) {
  try {
    let mesaNum = 'BALCÃO';
    if (mesaDbId) {
      const res = await query("SELECT numero FROM mesas WHERE id = ?", [mesaDbId]);
      mesaNum = res.rows[0] ? res.rows[0].numero : 'BALCÃO';
    } else if (pedidoId) {
      const res = await query("SELECT m.numero FROM pedidos p JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [pedidoId]);
      mesaNum = res.rows[0] ? res.rows[0].numero : 'BALCÃO';
    }
    const payload = { pedido_id: pedidoId, mesa_id: mesaNum, mesa_numero: mesaNum, status: status };
    console.log(`🔔 Notificando status: Mesa ${mesaNum}, Status ${status}`);
    await safePusherTrigger('garconnexpress', 'status-atualizado', payload);
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});

    // NOTIFICAÇÃO WHATSAPP
    if (status === 'aguardando_fechamento') {
      await sendWhatsAppMessage(`🛎️ *SOLICITAÇÃO DE FECHAMENTO*\n📍 Mesa: ${mesaNum}\n💰 O cliente solicitou a conta.`);
    } else if (status === 'cancelado') {
      await sendWhatsAppMessage(`❌ *PEDIDO CANCELADO*\n📍 Mesa: ${mesaNum}\n🗑️ O pedido foi removido do sistema.`);
    }

  } catch (e) { console.error('Erro notificar:', e.message); }
}

let dbInitError = null;

async function initDb() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS mesas (id SERIAL PRIMARY KEY, numero INTEGER NOT NULL, status TEXT DEFAULT 'livre')`,
    `CREATE TABLE IF NOT EXISTS menu (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, categoria TEXT NOT NULL, preco REAL NOT NULL, imagem TEXT, estoque INTEGER DEFAULT -1, validade DATE)`,
    `CREATE TABLE IF NOT EXISTS pedidos (id SERIAL PRIMARY KEY, mesa_id INTEGER, garcom_id TEXT, status TEXT DEFAULT 'recebido', total REAL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, forma_pagamento TEXT, desconto REAL DEFAULT 0, acrescimo REAL DEFAULT 0, valor_recebido REAL DEFAULT 0, troco REAL DEFAULT 0, cobrar_taxa BOOLEAN DEFAULT TRUE, num_pessoas INTEGER DEFAULT 1, valor_por_pessoa REAL, observacao TEXT, pago_parcial REAL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS pedido_itens (id SERIAL PRIMARY KEY, pedido_id INTEGER, menu_id INTEGER, quantidade INTEGER, observacao TEXT, status TEXT DEFAULT 'pendente')`,
    `CREATE TABLE IF NOT EXISTS garcons (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, usuario TEXT UNIQUE NOT NULL, senha TEXT NOT NULL DEFAULT '123', telefone TEXT)`,
    `CREATE TABLE IF NOT EXISTS usuarios_admin (id SERIAL PRIMARY KEY, usuario TEXT UNIQUE NOT NULL, senha TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sistema_config (chave TEXT PRIMARY KEY, valor TEXT)`,
    `CREATE TABLE IF NOT EXISTS fluxo_caixa (id SERIAL PRIMARY KEY, data_abertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP, data_fechamento TIMESTAMP, valor_inicial REAL NOT NULL, valor_final REAL, status TEXT DEFAULT 'aberto', total_dinheiro REAL DEFAULT 0, total_pix REAL DEFAULT 0, total_cartao REAL DEFAULT 0, total_vendas REAL DEFAULT 0)`
  ];
  
  // Executa queries sequencialmente para evitar sobrecarga de conexões
  try {
    const tableCheck = isPostgres 
      ? await db.query("SELECT to_regclass('public.usuarios_admin') as exists") 
      : { rows: [{ exists: true }] }; 

    if (!isPostgres || !tableCheck.rows[0].exists) {
      for (let tableSql of tables) {
        if (isPostgres) await db.query(tableSql);
        else db.exec(tableSql.replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT'));
      }
    }

    // GARANTE QUE SISTEMA_CONFIG EXISTA (Caso tenha sido adicionada depois)
    const sqlConfig = `CREATE TABLE IF NOT EXISTS sistema_config (chave TEXT PRIMARY KEY, valor TEXT)`;
    if (isPostgres) await db.query(sqlConfig);
    else db.exec(sqlConfig);

    await query("INSERT INTO sistema_config (chave, valor) SELECT 'whatsapp_enabled', 'true' WHERE NOT EXISTS (SELECT 1 FROM sistema_config WHERE chave = 'whatsapp_enabled')");

  } catch (e) {
    console.error('Erro ao verificar/criar tabelas:', e);
  }
  
  try {
    const addCol = async (t, c, type) => { 
      try { 
        if (isPostgres) await db.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS ${c} ${type}`); 
        else db.prepare(`ALTER TABLE ${t} ADD COLUMN ${c} ${type}`).run(); 
      } catch (e) {
        // Ignora erro se coluna já existe
      } 
    };
    
    // Otimização: Só roda migrações se não for Postgres (ou se for e estiver forçado)
    // No Vercel, assume que o esquema é estável para evitar 10+ queries no boot
    if (!isPostgres) {
      // Executa migrações sequencialmente
      await addCol('pedidos', 'forma_pagamento', 'TEXT');
      await addCol('pedidos', 'desconto', 'REAL DEFAULT 0');
      await addCol('pedidos', 'acrescimo', 'REAL DEFAULT 0');
      await addCol('pedidos', 'valor_recebido', 'REAL DEFAULT 0');
      await addCol('pedidos', 'troco', 'REAL DEFAULT 0');
      await addCol('pedidos', 'cobrar_taxa', 'BOOLEAN DEFAULT TRUE');
      await addCol('pedidos', 'num_pessoas', 'INTEGER DEFAULT 1');
      await addCol('pedidos', 'valor_por_pessoa', 'REAL');
      await addCol('menu', 'estoque', 'INTEGER DEFAULT -1');
      await addCol('menu', 'validade', 'DATE');
      await addCol('menu', 'enviar_cozinha', 'BOOLEAN DEFAULT TRUE');
      await addCol('garcons', 'telefone', 'TEXT');

      await addCol('pagamentos', 'recebido', 'REAL DEFAULT 0');
      await addCol('pagamentos', 'troco', 'REAL DEFAULT 0');
    }
    await addCol('pedidos', 'observacao', 'TEXT');
    await addCol('pedidos', 'pago_parcial', 'REAL DEFAULT 0');
    await addCol('pagamentos', 'recebido', 'REAL DEFAULT 0'); // Repete fora do !isPostgres para garantir no Vercel também se necessário
    await addCol('pagamentos', 'troco', 'REAL DEFAULT 0');
  } catch (e) { 
    console.error('Erro na migração:', e);
    dbInitError = e;
  }

  try {
    const hashedPass = await bcrypt.hash(process.env.ADMIN_INITIAL_PASSWORD || 'Admin#2026', saltRounds);
    // Otimização: Só tenta inserir admin se não detectou existência da tabela no passo anterior (ou seja, criação nova)
    // OU se a verificação inicial falhou.
    // Para segurança, tenta SELECT rápido
    const adminExists = await query('SELECT id FROM usuarios_admin WHERE usuario = ?', ['admin']);
    if (adminExists.rows.length === 0) await query('INSERT INTO usuarios_admin (usuario, senha) VALUES (?, ?)', ['admin', hashedPass]);
  } catch (e) {
    console.error('Erro ao criar admin:', e);
  }
}

// Função de retry com delay exponencial
async function retryWithDelay(fn, maxRetries = 3, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      console.error(`Tentativa ${i + 1} falhou:`, error.message);
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
    }
  }
}

let dbInitialized = false;

// Função para inicializar banco de forma lazy
async function lazyInitDb() {
  if (dbInitialized) return true;
  
  try {
    console.log('🔄 Inicializando banco de dados (lazy)...');
    await retryWithDelay(async () => {
      await db.query('SELECT 1');
    }, 5, 2000);
    
    await retryWithDelay(async () => {
      await initDb();
    }, 3, 1000);
    
    dbInitialized = true;
    console.log('✅ Banco de dados inicializado com sucesso (lazy)');
    return true;
  } catch (e) {
    console.error('❌ Erro ao inicializar banco (lazy):', e.message);
    dbInitError = e;
    return false;
  }
}

// Middleware para garantir que o banco está inicializado
async function ensureDbInitialized(req, res, next) {
  if (!isPostgres) {
    next();
    return;
  }
  
  const initialized = await lazyInitDb();
  if (initialized) {
    next();
  } else {
    res.status(503).json({ error: 'Banco de dados não disponível. Tente novamente em alguns segundos.' });
  }
}

// Inicialização segura do banco de dados (evita timeout no cold start)
if (!isPostgres) {
  initDb().catch(console.error);
} else {
  // Adia a inicialização para evitar timeout no startup
  console.log('⏳ Inicialização do banco adiada (lazy loading)');
}

app.use(express.static(path.join(__dirname, 'frontend')));
app.get('/', (req, res) => res.redirect('/garcom'));
app.get('/garcom', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'garcom', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'admin', 'index.html')));
app.get('/cozinha', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'cozinha', 'index.html')));

// Middlewares de Autenticação JWT
function isAuthenticated(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido ou expirado.' });
  }
}

function isAdmin(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role === 'admin') {
      req.user = decoded;
      next();
    } else {
      res.status(403).json({ error: 'Acesso negado. Apenas admin.' });
    }
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido ou expirado.' });
  }
}

app.post('/api/logout', (req, res) => {
  res.clearCookie('token', { 
    httpOnly: true, 
    secure: true, 
    sameSite: 'none' 
  });
  res.json({ success: true });
});

app.put('/api/pedidos/:id/cozinha-pronto', async (req, res) => {
  const { id } = req.params;
  try {
    // Marca todos os itens pendentes como 'pronto'
    await query("UPDATE pedido_itens SET status = 'pronto' WHERE pedido_id = ? AND status = 'pendente'", [id]);
    
    // Verifica se todos os itens estão pelo menos como 'pronto' ou 'entregue'
    const itens = (await query("SELECT status FROM pedido_itens WHERE pedido_id = ?", [id])).rows;
    const todosProntos = itens.every(i => i.status === 'pronto' || i.status === 'entregue');
    
    if (todosProntos) {
      await query("UPDATE pedidos SET status = 'pronto' WHERE id = ?", [id]);
    }

    // Notifica admin e garçom
    const pedido = (await query("SELECT m.numero as mesa_numero FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [id])).rows[0];
    const mesaNum = pedido ? pedido.mesa_numero || 'BALCÃO' : 'BALCÃO';
    
    await safePusherTrigger('garconnexpress', 'pedido-pronto', { 
      pedido_id: id, 
      mesa_numero: mesaNum,
      mensagem: `👨‍🍳 Pedido da Mesa ${mesaNum} está pronto!` 
    });

    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/pedidos/:id/marcar-entregue', async (req, res) => {
  const { id } = req.params;
  const { apenasProntos } = req.body;
  try {
    if (apenasProntos) {
      // Marca como entregue apenas os itens que já estão PRONTOS ou que NÃO vão para a cozinha (bebidas etc)
      await query(`
        UPDATE pedido_itens 
        SET status = 'entregue' 
        WHERE pedido_id = ? 
        AND (status = 'pronto' OR (status = 'pendente' AND menu_id IN (SELECT id FROM menu WHERE enviar_cozinha = ${isPostgres ? 'FALSE' : '0'})))
      `, [id]);
    } else {
      await query("UPDATE pedido_itens SET status = 'entregue' WHERE pedido_id = ?", [id]);
    }
    
    // Consolidação de itens duplicados (mesmo menu_id e observação)
    const itensEntregues = (await query("SELECT id, menu_id, quantidade, observacao FROM pedido_itens WHERE pedido_id = ? AND status = 'entregue'", [id])).rows;
    const vistos = {};
    for (const item of itensEntregues) {
      const chave = `${item.menu_id}_${item.observacao || ''}`;
      if (vistos[chave]) {
        // Soma quantidade ao primeiro visto e remove o atual
        await query("UPDATE pedido_itens SET quantidade = quantidade + ? WHERE id = ?", [item.quantidade, vistos[chave].id]);
        await query("DELETE FROM pedido_itens WHERE id = ?", [item.id]);
      } else {
        vistos[chave] = item;
      }
    }

    // Só muda status do pedido para 'servido' se TODOS os itens foram entregues
    const pendentesCount = (await query("SELECT COUNT(*) as total FROM pedido_itens WHERE pedido_id = ? AND status IN ('pendente', 'pronto')", [id])).rows[0].total;
    
    if (parseInt(pendentesCount) === 0) {
      await query("UPDATE pedidos SET status = 'servido' WHERE id = ?", [id]);
      await notifyStatus(id, null, 'servido');
    } else {
      await notifyStatus(id, null, 'itens_atualizados');
    }
    
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true, entregueTudo: parseInt(pendentesCount) === 0 });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/itens/:id/pronto', async (req, res) => {
  const { id } = req.params;
  try {
    const item = (await query("SELECT pedido_id, menu_id, quantidade, observacao FROM pedido_itens WHERE id = ?", [id])).rows[0];
    if (!item) return res.status(404).json({ error: 'Item não encontrado' });

    // Tenta encontrar um item idêntico que já foi entregue para mesclar
    const itemExistente = (await query(
      "SELECT id, quantidade FROM pedido_itens WHERE pedido_id = ? AND menu_id = ? AND status = 'entregue' AND (observacao = ? OR (observacao IS NULL AND ? IS NULL)) AND id != ?", 
      [item.pedido_id, item.menu_id, item.observacao, item.observacao, id]
    )).rows[0];

    if (itemExistente) {
      // Mescla com o item existente e remove o atual
      await query("UPDATE pedido_itens SET quantidade = quantidade + ? WHERE id = ?", [item.quantidade, itemExistente.id]);
      await query("DELETE FROM pedido_itens WHERE id = ?", [id]);
    } else {
      // Apenas marca como entregue
      await query("UPDATE pedido_itens SET status = 'entregue' WHERE id = ?", [id]);
    }

    // Verifica se ainda existem itens pendentes no pedido    const pendentes = (await query("SELECT id FROM pedido_itens WHERE pedido_id = ? AND status = 'pendente'", [item.pedido_id])).rows;
    if (pendentes.length === 0) {
      await query("UPDATE pedidos SET status = 'servido' WHERE id = ?", [item.pedido_id]);
      await notifyStatus(item.pedido_id, null, 'servido');
    }
    
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/pedidos/:id/taxa', async (req, res) => {
  const { id } = req.params;
  const { cobrar_taxa } = req.body;
  try {
    const todosItens = (await query("SELECT i.quantidade, m.preco FROM pedido_itens i JOIN menu m ON i.menu_id = m.id WHERE i.pedido_id = ?", [id])).rows;
    const subtotal = todosItens.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
    const total = cobrar_taxa ? Math.round(subtotal * 1.10 * 100) / 100 : subtotal;

    const taxaBanco = isPostgres ? cobrar_taxa : (cobrar_taxa ? 1 : 0);
    await query("UPDATE pedidos SET total = ?, cobrar_taxa = ? WHERE id = ?", [total, taxaBanco, id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/caixa/status', ensureDbInitialized, async (req, res) => {
  const result = await query("SELECT * FROM fluxo_caixa WHERE status = 'aberto' ORDER BY id DESC LIMIT 1");
  res.json(result.rows[0] || null);
});

app.post('/api/caixa/abrir', async (req, res) => {
  const { valor_inicial } = req.body;
  try {
    const aberto = await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'");
    if (aberto.rows.length > 0) return res.status(400).json({ error: 'Já existe um caixa aberto' });
    const agora = new Date();
    const dataLocal = agora.getFullYear() + '-' + String(agora.getMonth() + 1).padStart(2, '0') + '-' + String(agora.getDate()).padStart(2, '0') + ' ' + String(agora.getHours()).padStart(2, '0') + ':' + String(agora.getMinutes()).padStart(2, '0') + ':' + String(agora.getSeconds()).padStart(2, '0');
    await query("INSERT INTO fluxo_caixa (valor_inicial, status, data_abertura) VALUES (?, 'aberto', ?)", [valor_inicial || 0, dataLocal]);
    await safePusherTrigger('garconnexpress', 'status-caixa-atualizado', { status: 'aberto' });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Erro ao abrir caixa' }); }
});

app.post('/api/caixa/fechar', async (req, res) => {
  const { valor_final, id } = req.body;
  try {
    const pedidosAtivos = await query("SELECT id FROM pedidos WHERE status NOT IN ('entregue', 'cancelado')");
    if (pedidosAtivos.rows.length > 0) return res.status(400).json({ error: 'Existem pedidos pendentes.' });
    const agora = new Date();
    const dataLocal = agora.getFullYear() + '-' + String(agora.getMonth() + 1).padStart(2, '0') + '-' + String(agora.getDate()).padStart(2, '0') + ' ' + String(agora.getHours()).padStart(2, '0') + ':' + String(agora.getMinutes()).padStart(2, '0') + ':' + String(agora.getSeconds()).padStart(2, '0');
    await query("UPDATE fluxo_caixa SET valor_final = ?, status = 'fechado', data_fechamento = ? WHERE id = ?", [valor_final, dataLocal, id]);
    await safePusherTrigger('garconnexpress', 'status-caixa-atualizado', { status: 'fechado' });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Erro ao fechar caixa' }); }
});

app.get('/api/pedidos', ensureDbInitialized, async (req, res) => {
  res.json((await query(`SELECT p.*, m.numero as mesa_numero, g.nome as garcom_nome FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id LEFT JOIN garcons g ON p.garcom_id = g.usuario WHERE p.status NOT IN ('entregue', 'cancelado') ORDER BY p.created_at DESC`)).rows);
});

app.get('/api/pedidos/cozinha', ensureDbInitialized, async (req, res) => {
  res.setHeader('X-Debug-Version', '1.0.2');
  try {
    // Busca as categorias configuradas para a cozinha
    const config = await query("SELECT valor FROM sistema_config WHERE chave = 'categorias_cozinha'");
    const categoriasCozinha = config.rows[0]?.valor ? JSON.parse(config.rows[0].valor) : [];

    // Lógica super restrita: SÓ mostra o que for recebido ou aguardando fechamento
    // Isso exclui automaticamente cancelados, entregues, prontos, etc.
    let whereClause = `LOWER(pi.status) = 'pendente' AND LOWER(p.status) IN ('recebido', 'aguardando_fechamento')`;

    // Filtro por configuração de envio para cozinha ou por categoria
    let filterCozinha = `(m.enviar_cozinha = ${isPostgres ? 'TRUE' : '1'} OR m.enviar_cozinha IS NULL)`;
    
    if (categoriasCozinha.length > 0) {
      const catList = categoriasCozinha.map(c => `'${c.replace(/'/g, "''")}'`).join(',');
      filterCozinha = `(${filterCozinha} OR m.categoria IN (${catList}))`;
    }

    const result = await query(`
      SELECT 
        pi.id as item_id, 
        pi.quantidade, 
        pi.observacao, 
        pi.status as item_status,
        m.nome as item_nome, 
        m.categoria, 
        p.id as pedido_id, 
        p.status as pedido_status,
        p.created_at, 
        mes.numero as mesa_numero 
      FROM pedido_itens pi 
      JOIN menu m ON pi.menu_id = m.id 
      JOIN pedidos p ON pi.pedido_id = p.id 
      LEFT JOIN mesas mes ON p.mesa_id = mes.id 
      WHERE (${whereClause}) AND ${filterCozinha}
      ORDER BY p.created_at ASC
    `);
    
    if (result.rows.length > 0) {
      console.log(`🍳 [Cozinha] Enviando ${result.rows.length} itens. IDs de pedidos:`, [...new Set(result.rows.map(r => r.pedido_id))]);
    }
    
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pedidos/:id/pagamentos', async (req, res) => {
  try {
    const { id } = req.params;
    // Se a tabela não existir, retorna array vazio em vez de erro 500
    try {
      const pagamentos = (await query("SELECT * FROM pagamentos WHERE pedido_id = ? ORDER BY data ASC", [id])).rows;
      res.json(pagamentos || []);
    } catch (e) {
      console.warn("⚠️ Tabela 'pagamentos' pode não existir ainda:", e.message);
      res.json([]);
    }
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/pedidos/historico', async (req, res) => {

  res.json((await query(`SELECT p.*, m.numero as mesa_numero, g.nome as garcom_nome FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id LEFT JOIN garcons g ON p.garcom_id = g.usuario WHERE p.status IN ('entregue', 'cancelado') ORDER BY p.created_at DESC LIMIT 50`)).rows);
});
app.delete('/api/pedidos/limpar', async (req, res) => {
  try {
    await query("DELETE FROM pedido_itens WHERE pedido_id IN (SELECT id FROM pedidos WHERE status IN ('entregue', 'cancelado'))");
    await query("DELETE FROM pedidos WHERE status IN ('entregue', 'cancelado')");
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: "Erro ao limpar: " + error.message }); }
});

app.get('/api/pedidos/:id/itens', async (req, res) => { 
  res.json((await query(`SELECT pi.*, m.nome, m.preco, m.enviar_cozinha FROM pedido_itens pi JOIN menu m ON pi.menu_id = m.id WHERE pi.pedido_id = ? ORDER BY pi.status DESC, pi.id ASC`, [req.params.id])).rows); 
});

app.delete('/api/pedidos/itens/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const item = (await query("SELECT pedido_id, menu_id, quantidade FROM pedido_itens WHERE id = ?", [id])).rows[0];
    if (!item) return res.status(404).json({ error: 'Item não encontrado' });
    await query("UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque + ? END WHERE id = ?", [item.quantidade, item.menu_id]);
    await query("DELETE FROM pedido_itens WHERE id = ?", [id]);
    const itensRestantes = (await query("SELECT status FROM pedido_itens WHERE pedido_id = ?", [item.pedido_id])).rows;
    if (itensRestantes.length === 0) {
      const pedido = (await query("SELECT mesa_id, m.numero FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [item.pedido_id])).rows[0];
      await query("DELETE FROM pedidos WHERE id = ?", [item.pedido_id]);
      if (pedido && pedido.mesa_id) await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [pedido.mesa_id]);
      
      const mesaNum = pedido ? pedido.numero || 'BALCÃO' : 'BALCÃO';
      await safePusherTrigger('garconnexpress', 'pedido-cancelado', { 
        pedido_id: item.pedido_id, 
        mesa_numero: mesaNum,
        mensagem: `🚨 O Pedido #${item.pedido_id} (Mesa ${mesaNum}) foi CANCELADO.` 
      });

      await notifyStatus(item.pedido_id, pedido ? pedido.mesa_id : null, 'cancelado');
    } else {
      const temPendente = itensRestantes.some(i => i.status === 'pendente');
      if (!temPendente) { await query("UPDATE pedidos SET status = 'servido' WHERE id = ?", [item.pedido_id]); await notifyStatus(item.pedido_id, null, 'servido'); }
      else await notifyStatus(item.pedido_id, null, 'itens_atualizados');
    }
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/pedidos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const pedido = (await query("SELECT p.mesa_id, p.status, m.numero FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [id])).rows[0];
    const itens = (await query("SELECT menu_id, quantidade FROM pedido_itens WHERE pedido_id = ?", [id])).rows;
    for (const item of itens) await query("UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque + ? END WHERE id = ?", [item.quantidade, item.menu_id]);
    await query("DELETE FROM pedido_itens WHERE pedido_id = ?", [id]);
    await query("DELETE FROM pedidos WHERE id = ?", [id]);
    
    if (pedido) {
      if (pedido.status !== 'entregue' && pedido.status !== 'cancelado' && pedido.mesa_id) {
        await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [pedido.mesa_id]);
      }
      const mesaNum = pedido.numero || 'BALCÃO';
      await safePusherTrigger('garconnexpress', 'pedido-cancelado', { 
        pedido_id: id, 
        mesa_numero: mesaNum,
        mensagem: `🚨 O Pedido #${id} (Mesa ${mesaNum}) foi REMOVIDO pelo Admin.` 
      });
    }

    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/pedidos', async (req, res) => {
  const { mesa_id, garcom_id, itens, cobrar_taxa } = req.body;
  const deveCobrarTaxa = cobrar_taxa !== false;
  try {
    const caixaAberto = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
    if (!caixaAberto) return res.status(400).json({ error: 'O CAIXA ESTÁ FECHADO!' });
    for (const item of itens) {
      const p = (await query("SELECT nome, estoque FROM menu WHERE id = ?", [item.menu_id])).rows[0];
      if (p && p.estoque !== -1 && p.estoque < item.quantidade) return res.status(400).json({ error: `Estoque insuficiente: ${p.nome}` });
    }
    const subtotal = itens.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);
    const total = deveCobrarTaxa ? Math.round(subtotal * 1.10 * 100) / 100 : subtotal;
    let pedidoId;
    let resPedido;
    if (isPostgres) {
      resPedido = await query('INSERT INTO pedidos (mesa_id, garcom_id, total, status, created_at, cobrar_taxa) VALUES (?, ?, ?, ?, ?, ?) RETURNING id', [mesa_id || null, garcom_id, total, 'recebido', new Date().toISOString(), deveCobrarTaxa]);
      pedidoId = resPedido.rows[0].id;
    } else {
      resPedido = await query('INSERT INTO pedidos (mesa_id, garcom_id, total, status, created_at, cobrar_taxa) VALUES (?, ?, ?, ?, ?, ?)', [mesa_id || null, garcom_id, total, 'recebido', new Date().toISOString(), deveCobrarTaxa ? 1 : 0]);
      pedidoId = resPedido.lastInsertRowid;
    }
    if (mesa_id) await query("UPDATE mesas SET status = 'ocupada' WHERE id = ?", [mesa_id]);
    for (const item of itens) {
      await query('INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status) VALUES (?, ?, ?, ?, ?)', [pedidoId, item.menu_id, item.quantidade, item.observacao || '', 'pendente']);
      await query("UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque - ? END WHERE id = ?", [item.quantidade, item.menu_id]);
    }
    await notifyStatus(pedidoId, mesa_id, 'recebido');
    let mesaNum = 'BALCÃO';
    if (mesa_id) { const rm = await query("SELECT numero FROM mesas WHERE id = ?", [mesa_id]); mesaNum = rm.rows[0] ? rm.rows[0].numero : 'BALCÃO'; }

    // NOTIFICAÇÃO WHATSAPP DETALHADA
    const itensNomes = [];
    for (const item of itens) {
      const p = (await query("SELECT nome FROM menu WHERE id = ?", [item.menu_id])).rows[0];
      itensNomes.push(`${item.quantidade}x ${p ? p.nome : 'Item'}`);
    }
    const msgWpp = `🚀 *NOVO PEDIDO #${pedidoId}*\n📍 Mesa: ${mesaNum}\n📝 Itens:\n${itensNomes.join('\n')}\n💰 Total: R$ ${total.toFixed(2)}`;
    await sendWhatsAppMessage(msgWpp);

    await safePusherTrigger('garconnexpress', 'novo-pedido', { pedido: { id: pedidoId, mesa_id, mesa_numero: mesaNum, status: 'recebido' } });
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ id: pedidoId, success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/pedidos/:id/atualizar-itens', async (req, res) => {
  const { id } = req.params;
  const { itens } = req.body;
  try {
    const itensAtuais = (await query("SELECT id, menu_id, quantidade FROM pedido_itens WHERE pedido_id = ?", [id])).rows;
    for (const item of itensAtuais) await query("UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque + ? END WHERE id = ?", [item.quantidade, item.menu_id]);
    for (const item of itens) {
      const p = (await query("SELECT nome, estoque FROM menu WHERE id = ?", [item.menu_id])).rows[0];
      if (p && p.estoque !== -1 && p.estoque < item.quantidade) {
        for (const itemRoll of itensAtuais) await query("UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque - ? END WHERE id = ?", [itemRoll.quantidade, itemRoll.menu_id]);
        return res.status(400).json({ error: `Estoque insuficiente: ${p.nome}` });
      }
    }
    await query("DELETE FROM pedido_itens WHERE pedido_id = ?", [id]);
    let novoSub = 0;
    for (const item of itens) {
      await query("INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status) VALUES (?, ?, ?, ?, ?)", [id, item.menu_id, item.quantidade, item.observacao || '', item.status || 'pendente']);
      await query("UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque - ? END WHERE id = ?", [item.quantidade, item.menu_id]);
      const pMenu = (await query("SELECT preco FROM menu WHERE id = ?", [item.menu_id])).rows[0];
      if (pMenu) novoSub += (pMenu.preco * item.quantidade);
    }
    const pedido = (await query("SELECT cobrar_taxa FROM pedidos WHERE id = ?", [id])).rows[0];
    const total = (pedido && pedido.cobrar_taxa) ? Math.round(novoSub * 1.10 * 100) / 100 : novoSub;
    
    // Determina o status do pedido com base nos itens:
    // Se houver algum item 'pendente' ou 'pronto', o status do pedido deve ser 'recebido'.
    // Caso contrário (todos entregues), o status deve ser 'servido'.
    const temPendente = itens.some(i => i.status === 'pendente' || i.status === 'pronto');
    const novoStatusPedido = temPendente ? 'recebido' : 'servido';
    const agora = new Date().toISOString();
    
    // Se tem pendente, atualizamos o created_at para reiniciar o cronômetro de entrega
    if (temPendente) {
      await query("UPDATE pedidos SET total = ?, status = ?, created_at = ? WHERE id = ?", [total, novoStatusPedido, agora, id]);
      
      // Notifica a cozinha que há novos itens para preparar (com som)
      const resMesa = await query("SELECT m.numero FROM pedidos p JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [id]);
      const mesaNum = resMesa.rows[0] ? resMesa.rows[0].numero : 'BALCÃO';
      await safePusherTrigger('garconnexpress', 'novo-pedido', { pedido: { id: id, mesa_numero: mesaNum, status: 'recebido' } });
    } else {
      await query("UPDATE pedidos SET total = ?, status = ? WHERE id = ?", [total, novoStatusPedido, id]);
    }
    
    await notifyStatus(id, null, 'itens_atualizados');
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/pedidos/:id/adicionar', async (req, res) => {
  const { id } = req.params;
  const { itens, cobrar_taxa } = req.body;
  try {
    const pOrig = (await query("SELECT cobrar_taxa FROM pedidos WHERE id = ?", [id])).rows[0];
    const deveTaxa = cobrar_taxa !== undefined ? cobrar_taxa : (pOrig ? pOrig.cobrar_taxa : true);
    for (const item of itens) {
      const exist = await query('SELECT id, quantidade FROM pedido_itens WHERE pedido_id = ? AND menu_id = ? AND observacao = ? AND status = ?', [id, item.menu_id, item.observacao || '', 'pendente']);
      if (exist.rows.length > 0) await query('UPDATE pedido_itens SET quantidade = ? WHERE id = ?', [exist.rows[0].quantidade + item.quantidade, exist.rows[0].id]);
      else await query('INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status) VALUES (?, ?, ?, ?, ?)', [id, item.menu_id, item.quantidade, item.observacao || '', 'pendente']);
      await query("UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque - ? END WHERE id = ?", [item.quantidade, item.menu_id]);
    }
    const tItens = (await query("SELECT i.quantidade, m.preco FROM pedido_itens i JOIN menu m ON i.menu_id = m.id WHERE i.pedido_id = ?", [id])).rows;
    const sub = tItens.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
    const tot = deveTaxa ? Math.round(sub * 1.10 * 100) / 100 : sub;
    const agora = new Date().toISOString();
    
    // Atualiza o total e reinicia o cronômetro (created_at) para os novos itens adicionados
    await query("UPDATE pedidos SET total = ?, cobrar_taxa = ?, status = 'recebido', created_at = ? WHERE id = ?", [tot, isPostgres ? deveTaxa : (deveTaxa?1:0), agora, id]);
    const pMesa = (await query("SELECT mesa_id, m.numero FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [id])).rows[0];
    if (pMesa && pMesa.mesa_id) await query("UPDATE mesas SET status = 'ocupada' WHERE id = ?", [pMesa.mesa_id]);
    
    // Notifica a cozinha que há novos itens para preparar (com som)
    const mesaNum = pMesa ? pMesa.numero || 'BALCÃO' : 'BALCÃO';
    await safePusherTrigger('garconnexpress', 'novo-pedido', { pedido: { id: id, mesa_numero: mesaNum, status: 'recebido' } });

    await notifyStatus(id, null, 'itens_adicionados');
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/pedidos/:id/solicitar-fechamento', async (req, res) => {
  const { id } = req.params;
  const { mesa_id, forma_pagamento, desconto, acrescimo, valor_recebido, troco, total, num_pessoas, valor_por_pessoa } = req.body;
  try {
    let totalFinal = total;
    
    // Se o total não for enviado (solicitação do garçom), calcula com base nos itens
    if (totalFinal === undefined || totalFinal === null || totalFinal === 0) {
      const pOrig = (await query("SELECT cobrar_taxa FROM pedidos WHERE id = ?", [id])).rows[0];
      const deveTaxa = pOrig ? pOrig.cobrar_taxa : true;
      const tItens = (await query("SELECT i.quantidade, m.preco FROM pedido_itens i JOIN menu m ON i.menu_id = m.id WHERE i.pedido_id = ?", [id])).rows;
      const sub = tItens.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
      totalFinal = deveTaxa ? Math.round(sub * 1.10 * 100) / 100 : sub;
    }

    await query(`UPDATE pedidos SET status = 'aguardando_fechamento', forma_pagamento = ?, desconto = ?, acrescimo = ?, valor_recebido = ?, troco = ?, total = ?, num_pessoas = ?, valor_por_pessoa = ?, cobrar_taxa = ? WHERE id = ?`, 
      [forma_pagamento || 'Dinheiro', desconto || 0, acrescimo || 0, valor_recebido || 0, troco || 0, totalFinal, num_pessoas || 1, valor_por_pessoa || totalFinal, (req.body.cobrar_taxa !== undefined ? (req.body.cobrar_taxa ? 1 : 0) : 1), id]);
    
    if (mesa_id) await query("UPDATE mesas SET status = 'fechando' WHERE id = ?", [mesa_id]);
    await notifyStatus(id, mesa_id, 'aguardando_fechamento');
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/pedidos/:id/pessoas', async (req, res) => {
  const { id } = req.params;
  const { num_pessoas } = req.body;
  try {
    const p = (await query("SELECT total FROM pedidos WHERE id = ?", [id])).rows[0];
    const valor_por_pessoa = p ? p.total / (num_pessoas || 1) : 0;
    await query("UPDATE pedidos SET num_pessoas = ?, valor_por_pessoa = ? WHERE id = ?", [num_pessoas || 1, valor_por_pessoa, id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/pedidos/:id/pagamento-fracao', async (req, res) => {
  const { id } = req.params;
  const { mesa_id, valor_pago, forma_pagamento, num_pessoas_restantes, recebido, troco } = req.body;
  
  try {
    const cx = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
    if (!cx) return res.status(400).json({ error: 'CAIXA FECHADO' });

    // Salva o pagamento com os valores REAIS de recebido e troco
    const rec = (recebido !== undefined) ? recebido : valor_pago;
    const trc = (troco !== undefined) ? troco : 0;

    // 1. Busca o pedido original para saber o total atual e a mesa
    const pOrig = (await query("SELECT * FROM pedidos WHERE id = ?", [id])).rows[0];
    if (!pOrig) return res.status(404).json({ error: 'PEDIDO NÃO ENCONTRADO' });

    // 2. Registra o valor no fluxo de caixa
    const col = forma_pagamento === 'Cartão' ? 'total_cartao' : (forma_pagamento === 'Pix' ? 'total_pix' : 'total_dinheiro');
    await query(`UPDATE fluxo_caixa SET ${col} = ${col} + ?, total_vendas = total_vendas + ? WHERE id = ?`, [valor_pago, valor_pago, cx.id]);

    // 3. Garante que a tabela existe e registra o pagamento
    const sqlCreate = isPostgres 
      ? `CREATE TABLE IF NOT EXISTS pagamentos (id SERIAL PRIMARY KEY, pedido_id INTEGER, valor REAL, forma_pagamento TEXT, recebido REAL, troco REAL, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
          : `CREATE TABLE IF NOT EXISTS pagamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, pedido_id INTEGER, valor REAL, forma_pagamento TEXT, recebido REAL, troco REAL, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`;
    
    await query(sqlCreate);
    await query("INSERT INTO pagamentos (pedido_id, valor, forma_pagamento, recebido, troco) VALUES (?, ?, ?, ?, ?)", [id, valor_pago, forma_pagamento, rec, trc]);

    // 4. Atualiza o pedido original: incrementa o pago_parcial e ajusta o número de pessoas
    const novoPagoParcial = (pOrig.pago_parcial || 0) + valor_pago;
    // O total do pedido pOrig.total já deve estar atualizado com o valor total bruto (subtotal+taxa+acres-desc)
    const novoTotalMesa = Math.max(0, pOrig.total - valor_pago);
    const novoValorPessoa = num_pessoas_restantes > 0 ? novoTotalMesa / num_pessoas_restantes : 0;

    await query("UPDATE pedidos SET total = ?, pago_parcial = ?, num_pessoas = ?, valor_por_pessoa = ? WHERE id = ?", 
      [novoTotalMesa, novoPagoParcial, num_pessoas_restantes, novoValorPessoa, id]);

    await notifyStatus(id, mesa_id, 'itens_atualizados');
    
    res.json({ 
      success: true, 
      saldo_restante: novoTotalMesa 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/pedidos/:id/pagamento-parcial', async (req, res) => {
  const { id } = req.params;
  const { mesa_id, itens, forma_pagamento, total, num_pessoas, valor_por_pessoa } = req.body;
  try {
    const cx = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
    if (!cx) return res.status(400).json({ error: 'CAIXA FECHADO' });

    // 1. Registra o pagamento na tabela de pagamentos vinculada ao pedido principal
    const sqlCreate = isPostgres 
      ? `CREATE TABLE IF NOT EXISTS pagamentos (id SERIAL PRIMARY KEY, pedido_id INTEGER, valor REAL, forma_pagamento TEXT, recebido REAL, troco REAL, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
          : `CREATE TABLE IF NOT EXISTS pagamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, pedido_id INTEGER, valor REAL, forma_pagamento TEXT, recebido REAL, troco REAL, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`;
    await query(sqlCreate);
    await query("INSERT INTO pagamentos (pedido_id, valor, forma_pagamento, recebido, troco) VALUES (?, ?, ?, ?, ?)", [id, total, forma_pagamento, total, 0]);

    // 2. Remove os itens do pedido original (já que foram pagos separadamente)
    for (const i of itens) {
      await query('DELETE FROM pedido_itens WHERE id = ?', [i.id]);
    }

    // 3. Registra o valor no fluxo de caixa
    const col = forma_pagamento === 'Cartão' ? 'total_cartao' : (forma_pagamento === 'Pix' ? 'total_pix' : 'total_dinheiro');
    await query(`UPDATE fluxo_caixa SET ${col} = ${col} + ?, total_vendas = total_vendas + ? WHERE id = ?`, [total, total, cx.id]);

    // 4. Verifica se restam itens no pedido original
    const rest = (await query("SELECT id FROM pedido_itens WHERE pedido_id = ?", [id])).rows;
    if (rest.length === 0) { 
      await query("UPDATE pedidos SET status = 'entregue', pago_parcial = pago_parcial + ?, total = 0 WHERE id = ?", [total, id]); 
      if (mesa_id) await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [mesa_id]); 
      await notifyStatus(null, mesa_id, 'liberada'); 
    } else { 
      // Atualiza o total do pedido original subtraindo o que foi pago
      await query("UPDATE pedidos SET total = MAX(0, total - ?), pago_parcial = pago_parcial + ? WHERE id = ?", [total, total, id]);
      await notifyStatus(id, mesa_id, 'itens_atualizados'); 
    }
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/pedidos/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, pagamentos_detalhados } = req.body;
  try {
    if (status === 'entregue') {
      const cx = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
      if (!cx) return res.status(400).json({ error: 'CAIXA FECHADO' });

      const p = (await query("SELECT total, forma_pagamento, pago_parcial FROM pedidos WHERE id = ?", [id])).rows[0];
      if (p) {
        // Registra o pagamento final na tabela de pagamentos
        const sqlCreate = isPostgres
          ? `CREATE TABLE IF NOT EXISTS pagamentos (id SERIAL PRIMARY KEY, pedido_id INTEGER, valor REAL, forma_pagamento TEXT, recebido REAL, troco REAL, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
          : `CREATE TABLE IF NOT EXISTS pagamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, pedido_id INTEGER, valor REAL, forma_pagamento TEXT, recebido REAL, troco REAL, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`;

        if (Array.isArray(pagamentos_detalhados) && pagamentos_detalhados.length > 0) {
          // Cenário Multi-Pagamento (Suporta formato novo de objeto ou antigo de string)
          for (const pag of pagamentos_detalhados) {
            let forma = (pag && typeof pag === 'object') ? pag.forma_pagamento : pag;
            let valorParte = (pag && typeof pag === 'object') ? pag.valor : (p.total / pagamentos_detalhados.length);
            let recebido = (pag && typeof pag === 'object') ? (pag.recebido || valorParte) : valorParte;
            let troco = (pag && typeof pag === 'object') ? (pag.troco || 0) : 0;
            
            if (!forma) forma = 'Dinheiro';
            if (!valorParte || isNaN(valorParte)) valorParte = 0;

            const col = forma === 'Cartão' ? 'total_cartao' : (forma === 'Pix' ? 'total_pix' : 'total_dinheiro');
            await query(`UPDATE fluxo_caixa SET ${col} = ${col} + ?, total_vendas = total_vendas + ? WHERE id = ?`, [valorParte, valorParte, cx.id]);
            await query("INSERT INTO pagamentos (pedido_id, valor, forma_pagamento, recebido, troco) VALUES (?, ?, ?, ?, ?)", [id, valorParte, forma, recebido, troco]);
          }
        } else {
          // Cenário Normal (Um único pagamento para o saldo restante)
          const col = p.forma_pagamento === 'Cartão' ? 'total_cartao' : (p.forma_pagamento === 'Pix' ? 'total_pix' : 'total_dinheiro');
          const valorFinal = p.total;
          
          // Busca dados de recebido/troco do pedido original (salvos no solicitar-fechamento)
          const pDatalhes = (await query("SELECT valor_recebido, troco FROM pedidos WHERE id = ?", [id])).rows[0];
          const rec = pDatalhes ? pDatalhes.valor_recebido : valorFinal;
          const trc = pDatalhes ? pDatalhes.troco : 0;

          await query(`UPDATE fluxo_caixa SET ${col} = ${col} + ?, total_vendas = total_vendas + ? WHERE id = ?`, [valorFinal, valorFinal, cx.id]);
          await query("INSERT INTO pagamentos (pedido_id, valor, forma_pagamento, recebido, troco) VALUES (?, ?, ?, ?, ?)", [id, valorFinal, p.forma_pagamento, rec, trc]);
        }

        // Atualiza o pedido: limpa o saldo e soma ao pago_parcial para consolidar o histórico
        await query("UPDATE pedidos SET pago_parcial = pago_parcial + total, total = 0 WHERE id = ?", [id]);
      }
    }
    await query('UPDATE pedidos SET status = ? WHERE id = ?', [status, id]);
    
    if (status === 'cancelado') {
      await query("UPDATE pedido_itens SET status = 'cancelado' WHERE pedido_id = ?", [id]);
    }
    const pm = (await query("SELECT p.mesa_id, m.numero FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [id])).rows[0];
    const mesaNum = pm ? pm.numero || 'BALCÃO' : 'BALCÃO';

    if (status === 'cancelado') {
      console.log(`❌ Pedido ${id} cancelado pelo Admin. Notificando...`);
      await safePusherTrigger('garconnexpress', 'pedido-cancelado', { 
        id: id,
        pedido_id: id, 
        mesa_numero: mesaNum,
        mensagem: `🚨 O Pedido #${id} (Mesa ${mesaNum}) foi CANCELADO pelo Admin.` 
      });
    }

    if ((status === 'cancelado' || status === 'entregue') && pm && pm.mesa_id) {
        await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [pm.mesa_id]);
    }
    
    await notifyStatus(id, null, status);
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.get('/api/menu', ensureDbInitialized, async (req, res) => {
  try {
    res.json((await query('SELECT * FROM menu ORDER BY validade ASC')).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/menu/:id', async (req, res) => {
  const { nome, categoria, preco, imagem, estoque, validade, enviar_cozinha } = req.body;
  const dataValidade = validade && validade.trim() !== "" ? validade : null;
  const envCozinha = enviar_cozinha !== undefined ? (isPostgres ? enviar_cozinha : (enviar_cozinha ? 1 : 0)) : (isPostgres ? true : 1);
  try {
    await query('UPDATE menu SET nome = ?, categoria = ?, preco = ?, imagem = ?, estoque = ?, validade = ?, enviar_cozinha = ? WHERE id = ?', [nome, categoria, preco, imagem, estoque, dataValidade, envCozinha, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/menu', async (req, res) => {
  const { nome, categoria, preco, imagem, estoque, validade, enviar_cozinha } = req.body;
  const envCozinha = enviar_cozinha !== undefined ? (isPostgres ? enviar_cozinha : (enviar_cozinha ? 1 : 0)) : (isPostgres ? true : 1);
  try { await query('INSERT INTO menu (nome, categoria, preco, imagem, estoque, validade, enviar_cozinha) VALUES (?, ?, ?, ?, ?, ?, ?)', [nome, categoria, preco, imagem, estoque || -1, validade || null, envCozinha]); res.json({ success: true }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});
app.delete('/api/menu/:id', async (req, res) => { try { await query('DELETE FROM menu WHERE id = ?', [req.params.id]); res.json({ success: true }); } catch (error) { res.status(500).json({ error: error.message }); } });

app.delete('/api/menu/categoria/:categoria', async (req, res) => {
  const { categoria } = req.params;
  try {
    // Usamos UPPER para garantir que pegue variações de caixa se houver (ex: Bebidas vs bebidas)
    await query('DELETE FROM menu WHERE UPPER(categoria) = UPPER(?)', [categoria]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/garcons', ensureDbInitialized, async (req, res) => {
  try {
    const result = await query('SELECT id, nome, usuario, telefone FROM garcons ORDER BY nome');
    res.json(result.rows);
  } catch (error) { 
    console.error('❌ ERRO NA ROTA /api/garcons:', error);
    res.status(500).json({ error: error.message, stack: error.stack }); 
  }
});
app.post('/api/garcons', async (req, res) => { 
  try {
    const { nome, usuario, senha, telefone } = req.body; 
    const hashed = await bcrypt.hash(senha || '123', saltRounds); 
    await query('INSERT INTO garcons (nome, usuario, senha, telefone) VALUES (?, ?, ?, ?)', [nome, usuario, hashed, telefone]); 
    res.json({ success: true }); 
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.put('/api/garcons/:id', async (req, res) => {
  try {
    const { nome, usuario, senha, telefone } = req.body;
    if (senha) {
      const hashed = await bcrypt.hash(senha, saltRounds);
      await query('UPDATE garcons SET nome = ?, usuario = ?, senha = ?, telefone = ? WHERE id = ?', [nome, usuario, hashed, telefone, req.params.id]);
    } else {
      await query('UPDATE garcons SET nome = ?, usuario = ?, telefone = ? WHERE id = ?', [nome, usuario, telefone, req.params.id]);
    }
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.delete('/api/garcons/:id', async (req, res) => { 
  try {
    await query('DELETE FROM garcons WHERE id = ?', [req.params.id]); 
    res.json({ success: true }); 
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/mesas', async (req, res) => { 
  try {
    await query('INSERT INTO mesas (numero) VALUES (?)', [req.body.numero]); 
    res.json({ success: true }); 
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.put('/api/mesas/:id/liberar', async (req, res) => { try { await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [req.params.id]); await notifyStatus(null, req.params.id, 'liberada'); res.json({ success: true }); } catch (error) { res.status(500).json({ error: error.message }); } });
app.delete('/api/mesas/:id', async (req, res) => { 
  try {
    await query('DELETE FROM mesas WHERE id = ?', [req.params.id]); 
    res.json({ success: true }); 
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/pedidos/mesa/:mesaId', async (req, res) => { 
  try {
    res.json((await query(`SELECT * FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado') ORDER BY created_at DESC LIMIT 1`, [req.params.mesaId])).rows[0] || null); 
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/mesas', ensureDbInitialized, async (req, res) => { 
  try {
    res.json((await query(`SELECT m.*, (SELECT p.created_at FROM pedidos p WHERE p.mesa_id = m.id AND p.status = 'recebido' ORDER BY p.id DESC LIMIT 1) as pedido_created_at, (SELECT p.garcom_id FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado') ORDER BY p.id DESC LIMIT 1) as garcom_id FROM mesas m ORDER BY m.numero`)).rows); 
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { usuario, senha } = req.body;
    const result = await query('SELECT id, usuario, senha FROM usuarios_admin WHERE usuario = ?', [usuario]);
    if (result.rows.length > 0 && await bcrypt.compare(senha, result.rows[0].senha)) { 
      const admin = result.rows[0];
      delete admin.senha;
      
      const token = jwt.sign({ id: admin.id, usuario: admin.usuario, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
      
      const isProd = process.env.NODE_ENV === 'production';
      res.cookie('token', token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7 // 7 dias
      });
      
      res.json({ success: true, admin, token }); 
    }
    else res.status(401).json({ error: 'Incorreto' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { usuario, senha } = req.body;
    const result = await query('SELECT id, nome, senha FROM garcons WHERE usuario = ?', [usuario]);
    if (result.rows.length > 0 && await bcrypt.compare(senha, result.rows[0].senha)) { 
      const garcom = result.rows[0];
      delete garcom.senha;
      
      const token = jwt.sign({ id: garcom.id, nome: garcom.nome, role: 'garcom' }, JWT_SECRET, { expiresIn: '7d' });
      
      const isProd = process.env.NODE_ENV === 'production';
      res.cookie('token', token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7 // 7 dias
      });

      res.json({ success: true, garcom, token }); 
    }
    else res.status(401).json({ error: 'Incorreto' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/pusher-config', (req, res) => {
  res.json({
    key: process.env.PUSHER_APP_KEY || "5b2b284e309dea9d90fb",
    cluster: process.env.PUSHER_CLUSTER || "sa1"
  });
});

app.get('/api/whatsapp-status', async (req, res) => {
  try {
    const config = await query("SELECT valor FROM sistema_config WHERE chave = 'whatsapp_enabled'");
    const isEnabled = config.rows && config.rows.length > 0 ? config.rows[0].valor === 'true' : true;

    res.json({
      configured: !!process.env.WHATSAPP_BOT_URL,
      connected: whatsappSocket ? whatsappSocket.connected : false,
      enabled: isEnabled,
      number: process.env.WHATSAPP_NOTIFY_NUMBER || 'Não configurado'
    });
  } catch (error) {
    console.error('❌ Erro ao buscar status do WhatsApp:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/whatsapp-toggle', async (req, res) => {
  const { enabled } = req.body;
  try {
    await query("UPDATE sistema_config SET valor = ? WHERE chave = 'whatsapp_enabled'", [enabled ? 'true' : 'false']);
    res.json({ success: true, enabled });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/config/categorias-cozinha', async (req, res) => {
  try {
    const config = await query("SELECT valor FROM sistema_config WHERE chave = 'categorias_cozinha'");
    res.json(config.rows[0]?.valor ? JSON.parse(config.rows[0].valor) : []);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/config/categorias-cozinha', async (req, res) => {
  const { categorias } = req.body;
  try {
    const valor = JSON.stringify(categorias);
    await query("INSERT INTO sistema_config (chave, valor) VALUES ('categorias_cozinha', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [valor]);
    // Fallback para SQLite que não suporta ON CONFLICT da mesma forma se não for versão recente
    if (!isPostgres) {
       await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('categorias_cozinha', ?)", [valor]);
    }
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/diag', async (req, res) => {
  try {
    let dbStatus = 'disconnected';
    if (isPostgres) {
      await db.query('SELECT 1');
      dbStatus = 'connected';
    } else {
      db.prepare('SELECT 1').get();
      dbStatus = 'connected';
    }
    
    res.json({
      status: 'online',
      timestamp: new Date().toISOString(),
      db: dbStatus,
      dbType: isPostgres ? 'postgres' : 'sqlite',
      initError: dbInitError ? dbInitError.message : null,
      env: {
        NODE_ENV: process.env.NODE_ENV,
        HAS_POSTGRES_URL: !!process.env.POSTGRES_URL,
        HAS_DATABASE_URL: !!process.env.DATABASE_URL,
        PUSHER_CONFIGURED: !!(process.env.PUSHER_APP_ID && process.env.PUSHER_APP_KEY && process.env.PUSHER_APP_SECRET),
        PUSHER_CLUSTER: process.env.PUSHER_CLUSTER || 'não definido',
        JWT_SECRET_DEFINED: !!process.env.JWT_SECRET
      }
    });
  } catch (e) {
    res.status(500).json({
      status: 'error',
      db: 'disconnected',
      error: e.message,
      stack: e.stack,
      initError: dbInitError ? dbInitError.message : null
    });
  }
});

// Endpoint para forçar inicialização do DB (útil se as tabelas não existirem)
  app.post('/api/init-db-force', async (req, res) => {
    try {
      const tables = [
        `CREATE TABLE IF NOT EXISTS mesas (id SERIAL PRIMARY KEY, numero INTEGER NOT NULL, status TEXT DEFAULT 'livre')`,
        `CREATE TABLE IF NOT EXISTS menu (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, categoria TEXT NOT NULL, preco REAL NOT NULL, imagem TEXT, estoque INTEGER DEFAULT -1, validade DATE)`,
        `CREATE TABLE IF NOT EXISTS pedidos (id SERIAL PRIMARY KEY, mesa_id INTEGER, garcom_id TEXT, status TEXT DEFAULT 'recebido', total REAL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, forma_pagamento TEXT, desconto REAL DEFAULT 0, acrescimo REAL DEFAULT 0, valor_recebido REAL DEFAULT 0, troco REAL DEFAULT 0, cobrar_taxa BOOLEAN DEFAULT TRUE, num_pessoas INTEGER DEFAULT 1, valor_por_pessoa REAL, observacao TEXT, pago_parcial REAL DEFAULT 0)`,
        `CREATE TABLE IF NOT EXISTS pedido_itens (id SERIAL PRIMARY KEY, pedido_id INTEGER, menu_id INTEGER, quantidade INTEGER, observacao TEXT, status TEXT DEFAULT 'pendente')`,
        `CREATE TABLE IF NOT EXISTS pagamentos (id SERIAL PRIMARY KEY, pedido_id INTEGER, valor REAL, forma_pagamento TEXT, recebido REAL, troco REAL, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS garcons (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, usuario TEXT UNIQUE NOT NULL, senha TEXT NOT NULL DEFAULT '123', telefone TEXT)`,
        `CREATE TABLE IF NOT EXISTS usuarios_admin (id SERIAL PRIMARY KEY, usuario TEXT UNIQUE NOT NULL, senha TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS fluxo_caixa (id SERIAL PRIMARY KEY, data_abertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP, data_fechamento TIMESTAMP, valor_inicial REAL NOT NULL, valor_final REAL, status TEXT DEFAULT 'aberto', total_dinheiro REAL DEFAULT 0, total_pix REAL DEFAULT 0, total_cartao REAL DEFAULT 0, total_vendas REAL DEFAULT 0)`
      ];
      for (let tableSql of tables) {
        if (isPostgres) await db.query(tableSql);
        else db.exec(tableSql.replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT'));
      }
      res.json({ success: true, message: 'Tabelas criadas/verificadas com sucesso.' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
