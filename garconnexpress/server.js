const express = require('express');
// v1.0.1 - Deploy forÃ§ado para ativaÃ§Ã£o do menu bot
const path = require('path');
// Carregamento condicional do SQLite para evitar erros no Vercel
let Database = null;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.log("âš ï¸ SQLite nÃ£o carregado (provavelmente ambiente Vercel/Postgres)");
}
const { Pool } = require('pg');
const Pusher = require('pusher');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const ioClient = require('socket.io-client');

// ConfiguraÃ§Ã£o de ambiente
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(express.json());
app.use(cookieParser());

// INTEGRAÃ‡ÃƒO WHATSAPP (BOT EXTERNO)
let whatsappSocket = null;
if (process.env.WHATSAPP_BOT_URL) {
  console.log('ðŸ“¡ Iniciando conexÃ£o com Bot WhatsApp:', process.env.WHATSAPP_BOT_URL);
  whatsappSocket = ioClient(process.env.WHATSAPP_BOT_URL, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
  });
  
  whatsappSocket.on('connect', () => console.log('âœ… Conectado ao Bot do WhatsApp (Render)'));
  whatsappSocket.on('connect_error', (err) => console.log('âŒ Erro de conexÃ£o com Bot WhatsApp:', err.message));
  whatsappSocket.on('disconnect', () => console.log('âš ï¸ Desconectado do Bot WhatsApp'));

  // --- LÃ“GICA DO MENU INTERATIVO ---
  whatsappSocket.on('new_msg', async (data) => {
    try {
      if (!data || !data.from || !data.body) return;
      
      const from = data.from.split('@')[0].replace(/\D/g, ''); // Pega apenas os nÃºmeros
      const msg = data.body.trim();
      const nome = data.notifyName || 'Cliente';

      // Ignora mensagens enviadas pelo prÃ³prio robÃ´ para evitar loop
      if (data.fromMe) return;

      console.log(`ðŸ“© [WhatsApp] Mensagem de ${nome} (${from}): ${msg}`);

      // Processa as opÃ§Ãµes do menu
      if (msg === '1') {
        await sendWhatsAppMessage(`ðŸ“– *CARDÃPIO DIGITAL*\n\nAcesse nosso cardÃ¡pio por aqui: https://garconnexpress.vercel.app/cardapio/`, from);
      } else if (msg === '2') {
        await sendWhatsAppMessage(`ðŸ›’ *FAZER PEDIDO*\n\nPara fazer um pedido, basta escolher os itens no nosso cardÃ¡pio digital: https://garconnexpress.vercel.app/cardapio/\n\nSe preferir, pode me dizer o que deseja por aqui mesmo!`, from);
      } else if (msg === '3') {
        const promoVal = isPostgres ? true : 1;
        const promos = await query("SELECT nome, preco, preco_original FROM menu WHERE em_promocao = ? AND visivel = ?", [promoVal, promoVal]);
        let promoMsg = "ðŸ”¥ *PROMOÃ‡Ã•ES DO DIA*\n\nConfira nossas ofertas de hoje:\n\n";
        if (promos.rows && promos.rows.length > 0) {
          promos.rows.forEach(p => {
            const precoOriginal = p.preco_original ? `~R$ ${p.preco_original.toFixed(2)}~ ` : "";
            promoMsg += `âœ… *${p.nome}*\nðŸ’° ${precoOriginal}*R$ ${p.preco.toFixed(2)}*\n\n`;
          });
          promoMsg += "_Aproveite que Ã© por tempo limitado!_";
        } else {
          promoMsg = "ðŸ”¥ *PROMOÃ‡Ã•ES DO DIA*\n\nNo momento nÃ£o temos promoÃ§Ãµes ativas, mas fique de olho no nosso cardÃ¡pio! ðŸ˜‰";
        }
        await sendWhatsAppMessage(promoMsg, from);
      } else if (msg === '4') {
        await sendWhatsAppMessage(`ðŸ“ *ENDEREÃ‡O E HORÃRIO*\n\nðŸ  EndereÃ§o: rua democrito gracindo 132 ponta grossa\nâ° HorÃ¡rio: Diariamente das 18h Ã s 02:00`, from);
      } else if (msg === '5') {
        await sendWhatsAppMessage(`ðŸ‘¨â€ðŸ’» *ATENDIMENTO*\n\nUm momento, ${nome}. JÃ¡ avisei a nossa equipe e alguÃ©m falarÃ¡ com vocÃª em instantes!`, from);
        // Notifica o painel admin via Pusher
        await safePusherTrigger('garconnexpress', 'atendimento-whatsapp', { number: from, name: nome, mensagem: 'O cliente solicitou atendimento humano.' });
      } else {
        // Envia o Menu Principal para qualquer outra mensagem
        const menu = `OlÃ¡ ${nome}! ðŸ‘‹ Seja bem-vindo ao *GuGA Bebidas*.\nComo posso te ajudar hoje?\n\n1ï¸âƒ£ - Ver CardÃ¡pio Digital ðŸ“–\n2ï¸âƒ£ - Fazer um Pedido ðŸ›’\n3ï¸âƒ£ - PromoÃ§Ãµes do Dia ðŸ”¥\n4ï¸âƒ£ - EndereÃ§o e HorÃ¡rio ðŸ“\n5ï¸âƒ£ - Falar com o Atendente ðŸ‘¨â€ðŸ’»\n\n_Digite apenas o nÃºmero da opÃ§Ã£o desejada._`;
        await sendWhatsAppMessage(menu, from);
      }
    } catch (err) {
      console.error('âŒ Erro ao processar mensagem do WhatsApp:', err.message);
    }
  });
}

// Cache simples para configuraÃ§Ãµes
let configCache = {
  whatsapp_enabled: null,
  lastUpdate: 0
};

async function isWhatsAppEnabled() {
  const now = Date.now();
  if (configCache.whatsapp_enabled !== null && (now - configCache.lastUpdate < 60000)) {
    return configCache.whatsapp_enabled;
  }
  try {
    const config = await query("SELECT valor FROM sistema_config WHERE chave = 'whatsapp_enabled'");
    configCache.whatsapp_enabled = config.rows[0]?.valor === 'true';
    configCache.lastUpdate = now;
    return configCache.whatsapp_enabled;
  } catch (e) {
    return true; // Default
  }
}

async function sendWhatsAppMessage(text, targetNumber = null) {
  console.log(`ðŸ” [WhatsApp] Tentando disparar notificaÃ§Ã£o: "${text.substring(0, 50)}..."`);
  try {
    if (!await isWhatsAppEnabled()) {
      console.log('ðŸš« [WhatsApp] AutomaÃ§Ã£o desativada nas configuraÃ§Ãµes do sistema');
      return;
    }

    let numbersList = [];
    
    if (targetNumber) {
      // Se um nÃºmero especÃ­fico foi passado (ex: resposta ao cliente), usa ele
      numbersList = [targetNumber];
    } else {
      // Caso contrÃ¡rio, busca a lista de nÃºmeros de notificaÃ§Ã£o no banco/env
      const configNums = await query("SELECT valor FROM sistema_config WHERE chave = 'whatsapp_notify_numbers'");
      if (configNums.rows && configNums.rows.length > 0 && configNums.rows[0].valor) {
        numbersList = configNums.rows[0].valor.split(',').map(n => n.trim());
      } else if (process.env.WHATSAPP_NOTIFY_NUMBER) {
        numbersList = [process.env.WHATSAPP_NOTIFY_NUMBER];
      }
    }

    if (whatsappSocket && whatsappSocket.connected && numbersList.length > 0) {
      // Remove duplicados e limpa os nÃºmeros
      const uniqueNumbers = [...new Set(numbersList.map(n => n.replace(/\D/g, '')))];
      console.log(`ðŸ“¤ [WhatsApp] Bot CONECTADO. Enviando para: ${uniqueNumbers.join(', ')}`);

      uniqueNumbers.forEach(num => {
        // Envia para o bot usando apenas os dÃ­gitos (formato que funcionou nos testes)
        // O bot cuidarÃ¡ do roteamento interno.
        whatsappSocket.emit('send_msg', { number: num, text: text });
      });
    } else {
      console.log('âš ï¸ [WhatsApp] FALHA NO ENVIO: Bot desconectado ou lista de nÃºmeros vazia.');
      console.log(`   - Socket conectado: ${whatsappSocket ? whatsappSocket.connected : 'null'}`);
      console.log(`   - NÃºmeros encontrados: ${numbersList.length}`);
    }
  } catch (e) {
    console.error('âŒ Erro interno ao enviar WhatsApp:', e.message);
  }
}

// Log global de todas as requisiÃ§Ãµes
app.use((req, res, next) => {
  console.log(`ðŸ“¡ [${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// ConfiguraÃ§Ã£o de CORS dinÃ¢mica baseada em ALLOWED_ORIGINS
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

// INICIALIZAÃ‡ÃƒO DO PUSHER (Com as novas chaves do usuÃ¡rio)
const pusherConfig = {
  appId: (process.env.PUSHER_APP_ID || "2122978").trim(),
  key: (process.env.PUSHER_APP_KEY || "5b2b284e309dea9d90fb").trim(),
  secret: (process.env.PUSHER_APP_SECRET || "11b8e639d6b1d940871a").trim(),
  cluster: (process.env.PUSHER_CLUSTER || "sa1").trim(),
  useTLS: true
};

let pusher = new Pusher(pusherConfig);
console.log('📡 PUSHER CONFIGURADO COM SUCESSO (LOCAL/VERCEL)');

const isPostgres = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);
let db;

if (isPostgres) {
    // ConfiguraÃ§Ã£o OTIMIZADA para Vercel/Neon
    let connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    
    // Remove sslmode da string para evitar conflito/aviso e deixar o objeto ssl controlar
    if (connectionString) {
      try {
        const url = new URL(connectionString);
        url.searchParams.delete('sslmode');
        connectionString = url.toString();
      } catch (e) {
        // Se falhar o parse, usa como estÃ¡
      }
    }
    
    db = new Pool({ 
      connectionString,
      ssl: { 
        rejectUnauthorized: false, // Aceita certificados self-signed do Neon
        require: true 
      },
      max: 10, // Aumentado para lidar com mÃºltiplas requisiÃ§Ãµes simultÃ¢neas em Serverless
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000, // Timeout rÃ¡pido para falhar e dar retry se necessÃ¡rio
    });
    
    db.on('error', (err) => {
      console.error('âš ï¸ Erro no Pool do Postgres (recuperÃ¡vel):', err.message);
    });
  } else {
  if (!Database) {
    console.error("âŒ ERRO CRÃTICO: SQLite nÃ£o disponÃ­vel e Postgres nÃ£o configurado.");
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

  // Para Postgres, usa retry automÃ¡tico em caso de timeout
  if (isPostgres) {
    return retryWithDelay(executeQuery, 3, 500);
  } else {
    return executeQuery();
  }
}

async function safePusherTrigger(channel, event, data) {
  if (!pusher) {
    console.log(`âš ï¸ Pusher nÃ£o configurado. Ignorando evento: ${event}`);
    return;
  }
  try {
    console.log(`ðŸ“¡ [Pusher] Enviando: Canal=${channel}, Evento=${event}`);
    // No Vercel, precisamos de uma confirmaÃ§Ã£o real do envio
    await pusher.trigger(channel, event, data);
    console.log(`âœ… [Pusher] Sucesso: ${event}`);
    return true;
  } catch (e) {
    console.error(`âŒ [Pusher] Falha (${event}):`, e.message);
    return false;
  }
}

async function verificarEstoqueBaixo(menuId) {
  try {
    const item = (await query("SELECT id, nome, estoque FROM menu WHERE id = ?", [menuId])).rows[0];
    if (item && item.estoque !== -1 && item.estoque <= 5) {
      console.log(`âš ï¸ [Estoque] Baixo: ${item.nome} (${item.estoque})`);
      await safePusherTrigger('garconnexpress', 'estoque-baixo', {
        id: item.id,
        nome: item.nome,
        estoque: item.estoque,
        mensagem: `âš ï¸ ESTOQUE BAIXO: ${item.nome} restam apenas ${item.estoque} un.`
      });
    }
  } catch (e) {
    console.error("Erro ao verificar estoque baixo:", e);
  }
}

async function notifyStatus(pedidoId, mesaDbId, status, mesaNumPredefined = null) {
  try {
    let mesaNum = mesaNumPredefined || 'BALCÃƒO';
    let finalMesaId = mesaDbId;

    if (!finalMesaId || !mesaNumPredefined) {
      if (mesaDbId) {
        const res = await query("SELECT numero FROM mesas WHERE id = ?", [mesaDbId]);
        mesaNum = res.rows[0] ? res.rows[0].numero : 'BALCÃƒO';
      } else if (pedidoId) {
        const res = await query("SELECT m.id, m.numero FROM pedidos p JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [pedidoId]);
        if (res.rows[0]) {
          mesaNum = res.rows[0].numero;
          finalMesaId = res.rows[0].id;
        }
      }
    }
    const payload = { pedido_id: pedidoId, mesa_id: finalMesaId, mesa_numero: mesaNum, status: status };
    console.log(`ðŸ”” Notificando status: Mesa ${mesaNum} (ID: ${finalMesaId}), Status ${status}`);

    // Dispara Pusher IMEDIATAMENTE (Prioridade)
    await safePusherTrigger('garconnexpress', 'status-atualizado', payload);
    // NotificaÃ§Ã£o WhatsApp em paralelo/background
    if (status === 'aguardando_fechamento') {
      sendWhatsAppMessage(`ðŸ›Žï¸ *SOLICITAÃ‡ÃƒO DE FECHAMENTO*\nðŸ“ Mesa: ${mesaNum}\nðŸ’° O cliente solicitou a conta.`).catch(e => console.error('Erro Wpp:', e.message));
    } else if (status === 'cancelado') {
      sendWhatsAppMessage(`âŒ *PEDIDO CANCELADO*\nðŸ“ Mesa: ${mesaNum}\nðŸ—‘ï¸ O pedido foi removido do sistema.`).catch(e => console.error('Erro Wpp:', e.message));
    }

  } catch (e) { console.error('Erro notificar:', e.message); }
}

let dbInitError = null;

async function initDb() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS mesas (id SERIAL PRIMARY KEY, numero INTEGER NOT NULL, status TEXT DEFAULT 'livre', garcom_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS menu (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, categoria TEXT NOT NULL, preco REAL NOT NULL, preco_original REAL, descricao TEXT, imagem TEXT, estoque INTEGER DEFAULT -1, validade DATE, enviar_cozinha BOOLEAN DEFAULT TRUE, visivel BOOLEAN DEFAULT TRUE, em_promocao BOOLEAN DEFAULT FALSE)`,
    `CREATE TABLE IF NOT EXISTS pedidos (id SERIAL PRIMARY KEY, mesa_id INTEGER, garcom_id TEXT, status TEXT DEFAULT 'recebido', total REAL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, forma_pagamento TEXT, desconto REAL DEFAULT 0, acrescimo REAL DEFAULT 0, valor_recebido REAL DEFAULT 0, troco REAL DEFAULT 0, cobrar_taxa BOOLEAN DEFAULT TRUE, num_pessoas INTEGER DEFAULT 1, valor_por_pessoa REAL, observacao TEXT, pago_parcial REAL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS pedido_itens (id SERIAL PRIMARY KEY, pedido_id INTEGER, menu_id INTEGER, quantidade INTEGER, observacao TEXT, status TEXT DEFAULT 'pendente')`,
    `CREATE TABLE IF NOT EXISTS pagamentos (id SERIAL PRIMARY KEY, pedido_id INTEGER, valor REAL, forma_pagamento TEXT, recebido REAL, troco REAL, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS garcons (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, usuario TEXT UNIQUE NOT NULL, senha TEXT NOT NULL DEFAULT '123', telefone TEXT, comissao REAL DEFAULT 0, is_online BOOLEAN DEFAULT FALSE, last_assigned_at TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS usuarios_admin (id SERIAL PRIMARY KEY, usuario TEXT UNIQUE NOT NULL, senha TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sistema_config (chave TEXT PRIMARY KEY, valor TEXT)`,
    `CREATE TABLE IF NOT EXISTS fluxo_caixa (id SERIAL PRIMARY KEY, data_abertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP, data_fechamento TIMESTAMP, valor_inicial REAL NOT NULL, valor_final REAL, status TEXT DEFAULT 'aberto', total_dinheiro REAL DEFAULT 0, total_pix REAL DEFAULT 0, total_cartao REAL DEFAULT 0, total_vendas REAL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS codigos_acesso (id SERIAL PRIMARY KEY, mesa_id INTEGER, codigo TEXT NOT NULL, status TEXT DEFAULT 'ativo', criado_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido_id ON pedido_itens(pedido_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pedidos_mesa_id ON pedidos(mesa_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status)`
  ];
  
  // Executa queries sequencialmente para evitar sobrecarga de conexÃµes
  try {
    for (let tableSql of tables) {
      if (isPostgres) await db.query(tableSql);
      else db.exec(tableSql.replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT'));
    }

    // GARANTE QUE SISTEMA_CONFIG EXISTA (Caso tenha sido adicionada depois)
    const sqlConfig = `CREATE TABLE IF NOT EXISTS sistema_config (chave TEXT PRIMARY KEY, valor TEXT)`;
    if (isPostgres) await db.query(sqlConfig);
    else db.exec(sqlConfig);

    await query("INSERT INTO sistema_config (chave, valor) SELECT 'whatsapp_enabled', 'true' WHERE NOT EXISTS (SELECT 1 FROM sistema_config WHERE chave = 'whatsapp_enabled')");

    // LIMPEZA E REGISTRO DO NÃšMERO DE WHATSAPP (CONSOLIDADO)
    const notificationNumbers = '558293157048'; 
    try {
      // Remove a chave antiga (singular) se existir para evitar confusÃ£o
      await query("DELETE FROM sistema_config WHERE chave = 'whatsapp_notify_number'");
      
      if (isPostgres) {
        await query("INSERT INTO sistema_config (chave, valor) VALUES ('whatsapp_notify_numbers', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [notificationNumbers]);
      } else {
        await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('whatsapp_notify_numbers', ?)", [notificationNumbers]);
      }
    } catch (errConfig) {
      console.error('Erro ao configurar WhatsApp no DB:', errConfig.message);
    }

  } catch (e) {
    console.error('Erro ao verificar/criar tabelas:', e);
  }
  
  try {
    const addCol = async (t, c, type) => { 
      try { 
        if (isPostgres) await db.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS ${c} ${type}`); 
        else {
          // Verifica se a coluna jÃ¡ existe no SQLite antes de adicionar
          const info = db.prepare(`PRAGMA table_info(${t})`).all();
          if (!info.some(col => col.name === c)) {
            db.prepare(`ALTER TABLE ${t} ADD COLUMN ${c} ${type}`).run();
          }
        }
      } catch (e) {
        console.warn(`Aviso ao adicionar coluna ${c} em ${t}:`, e.message);
      } 
    };
    
    // MigraÃ§Ãµes garantidas para todos os bancos
    await addCol('mesas', 'garcom_id', 'TEXT');
    await addCol('pedidos', 'forma_pagamento', 'TEXT');
    await addCol('pedidos', 'desconto', 'REAL DEFAULT 0');
    await addCol('pedidos', 'acrescimo', 'REAL DEFAULT 0');
    await addCol('pedidos', 'valor_recebido', 'REAL DEFAULT 0');
    await addCol('pedidos', 'troco', 'REAL DEFAULT 0');
    await addCol('pedidos', 'cobrar_taxa', 'BOOLEAN DEFAULT TRUE');
    await addCol('pedidos', 'num_pessoas', 'INTEGER DEFAULT 1');
    await addCol('pedidos', 'valor_por_pessoa', 'REAL');
    await addCol('pedidos', 'solicitou_fechamento', 'BOOLEAN DEFAULT FALSE');
    await addCol('pedidos', 'fechamento_liberado', 'BOOLEAN DEFAULT FALSE');
    await addCol('menu', 'estoque', 'INTEGER DEFAULT -1');
    await addCol('menu', 'validade', 'DATE');
    await addCol('menu', 'enviar_cozinha', 'BOOLEAN DEFAULT NULL');
    await addCol('menu', 'visivel', 'BOOLEAN DEFAULT TRUE');
    await addCol('menu', 'em_promocao', 'BOOLEAN DEFAULT FALSE');
    await addCol('menu', 'preco_original', 'REAL');
    await addCol('menu', 'descricao', 'TEXT');
    await addCol('garcons', 'telefone', 'TEXT');
    await addCol('pedidos', 'observacao', 'TEXT');
    await addCol('pedidos', 'pago_parcial', 'REAL DEFAULT 0');
    await addCol('garcons', 'comissao', 'REAL DEFAULT 0');
    await addCol('garcons', 'is_online', 'BOOLEAN DEFAULT FALSE');
    await addCol('garcons', 'last_assigned_at', 'TIMESTAMP');
    
    // Garante que a tabela pagamentos tenha as colunas necessÃ¡rias
    await addCol('pagamentos', 'recebido', 'REAL DEFAULT 0');
    await addCol('pagamentos', 'troco', 'REAL DEFAULT 0');
  } catch (e) { 
    console.error('Erro na migraÃ§Ã£o:', e);
    dbInitError = e;
  }

  try {
    const hashedPass = await bcrypt.hash(process.env.ADMIN_INITIAL_PASSWORD || 'Admin#2026', saltRounds);
    // OtimizaÃ§Ã£o: SÃ³ tenta inserir admin se nÃ£o detectou existÃªncia da tabela no passo anterior (ou seja, criaÃ§Ã£o nova)
    // OU se a verificaÃ§Ã£o inicial falhou.
    // Para seguranÃ§a, tenta SELECT rÃ¡pido
    const adminExists = await query('SELECT id FROM usuarios_admin WHERE usuario = ?', ['admin']);
    if (adminExists.rows.length === 0) await query('INSERT INTO usuarios_admin (usuario, senha) VALUES (?, ?)', ['admin', hashedPass]);
  } catch (e) {
    console.error('Erro ao criar admin:', e);
  }
}

// FunÃ§Ã£o de retry com delay exponencial
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
let dbInitializationPromise = null;

// FunÃ§Ã£o para inicializar banco de forma lazy
async function lazyInitDb() {
  if (dbInitialized) return true;
  if (dbInitializationPromise) return dbInitializationPromise;

  dbInitializationPromise = (async () => {
    try {
      console.log('ðŸ”„ Inicializando banco de dados (lazy)...');
      await retryWithDelay(async () => {
        if (isPostgres) await db.query('SELECT 1');
      }, 5, 2000);

      await retryWithDelay(async () => {
        await initDb();
      }, 3, 1000);

      dbInitialized = true;
      console.log('âœ… Banco de dados inicializado com sucesso (lazy)');
      return true;
    } catch (e) {
      console.error('âŒ Erro ao inicializar banco (lazy):', e.message);
      dbInitError = e;
      dbInitializationPromise = null; // Permite tentar novamente em prÃ³xima requisiÃ§Ã£o
      return false;
    }
  })();

  return dbInitializationPromise;
}
// Middleware para garantir que o banco estÃ¡ inicializado
async function ensureDbInitialized(req, res, next) {
  if (!isPostgres) {
    next();
    return;
  }
  
  const initialized = await lazyInitDb();
  if (initialized) {
    next();
  } else {
    res.status(503).json({ error: 'Banco de dados nÃ£o disponÃ­vel. Tente novamente em alguns segundos.' });
  }
}

// InicializaÃ§Ã£o segura do banco de dados (evita timeout no cold start)
if (!isPostgres) {
  initDb().catch(console.error);
} else {
  // Adia a inicializaÃ§Ã£o para evitar timeout no startup
  console.log('â³ InicializaÃ§Ã£o do banco adiada (lazy loading)');
}

app.use(express.static(path.join(__dirname, 'frontend'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.html') || path.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
app.get('/', (req, res) => res.redirect('/garcom'));
app.get('/garcom', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'garcom', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'admin', 'index.html')));
app.get('/cozinha', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'cozinha', 'index.html')));

// Middlewares de Autenticação JWT
function isAuthenticated(req, res, next) {
  // Prioriza o Header Authorization, depois tenta o Cookie específico
  const token = req.headers.authorization?.split(' ')[1] || req.cookies.garcom_token || req.cookies.admin_token || req.cookies.token;

  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'Não autorizado. Faça login.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error(`❌ Erro no token [${req.url}]:`, err.message);
    return res.status(403).json({ error: 'Token inválido ou expirado.' });
  }
}

function isAdmin(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.cookies.admin_token || req.cookies.token;

  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'Não autorizado. Faça login.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role === 'admin') {
      req.user = decoded;
      next();
    } else {
      console.warn(`⚠️ Acesso admin negado para usuário: ${decoded.usuario} (Role: ${decoded.role})`);
      res.status(403).json({ error: 'Acesso negado. Apenas admin.' });
    }
  } catch (err) {
    console.error(`❌ Erro no token admin [${req.url}]:`, err.message);
    return res.status(403).json({ error: 'Token inválido ou expirado.' });
  }
}
app.post('/api/logout', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1] || req.cookies.garcom_token || req.cookies.admin_token || req.cookies.token;
  if (token && token !== 'null') {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded && decoded.role === 'garcom') {
        await query("UPDATE garcons SET is_online = ? WHERE id = ?", [isPostgres ? false : 0, decoded.id]);
        console.log(`👋 Garçom ${decoded.usuario} offline.`);
      }
    } catch (e) {
      console.error('Erro ao desativar online no logout:', e.message);
    }
  }
  
  const cookieOptions = { httpOnly: true, secure: true, sameSite: 'none' };
  res.clearCookie('token', cookieOptions);
  res.clearCookie('admin_token', cookieOptions);
  res.clearCookie('garcom_token', cookieOptions);
  res.json({ success: true });
});

// Pausar/Retomar atendimento (RodÃ­zio)
app.post('/api/garcom/pausar', isAuthenticated, async (req, res) => {
  const { pausado } = req.body;
  if (req.user.role !== 'garcom') return res.status(403).json({ error: 'Apenas garÃ§ons podem pausar atendimento.' });

  try {
    const isOnline = pausado ? (isPostgres ? false : 0) : (isPostgres ? true : 1);
    await query("UPDATE garcons SET is_online = ? WHERE id = ?", [isOnline, req.user.id]);
    
    console.log(`ðŸ‘¤ GarÃ§om ${req.user.usuario} agora estÃ¡ ${pausado ? 'PAUSADO' : 'DISPONÃVEL'}.`);
    
    // Notifica o Admin em tempo real
    await safePusherTrigger('garconnexpress', 'garcom-status-alterado', {
      garcom_id: req.user.id,
      pausado: pausado
    });

    res.json({ success: true, is_online: !pausado });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin forÃ§a pausa/disponibilidade do garÃ§om
app.post('/api/admin/garcons/:id/toggle-status', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const garcom = (await query("SELECT id, is_online FROM garcons WHERE id = ?", [id])).rows[0];
    if (!garcom) return res.status(404).json({ error: 'GarÃ§om nÃ£o encontrado' });

    const novoStatus = garcom.is_online ? (isPostgres ? false : 0) : (isPostgres ? true : 1);
    await query("UPDATE garcons SET is_online = ? WHERE id = ?", [novoStatus, id]);

    const pausado = novoStatus ? false : true;
    
    // Notifica via Pusher
    await safePusherTrigger('garconnexpress', 'garcom-status-alterado', {
      garcom_id: id,
      pausado: pausado
    });

    res.json({ success: true, is_online: !!novoStatus });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper para verificar se uma lista de IDs de menu contÃ©m itens para a cozinha (JS)
async function checkTemItemCozinha(itensIds) {
  const configK = await query("SELECT valor FROM sistema_config WHERE chave = 'categorias_cozinha'");
  const catsCozinha = configK.rows[0]?.valor ? JSON.parse(configK.rows[0].valor).map(c => c.trim().toUpperCase()) : [];
  
  for (const menuId of itensIds) {
    const m = (await query("SELECT enviar_cozinha, categoria FROM menu WHERE id = ?", [menuId])).rows[0];
    if (m) {
      const envCozinha = m.enviar_cozinha;
      const categoria = (m.categoria || '').trim().toUpperCase();
      
      // LÃ³gica consistente com getFilterCozinha (Prioridade):
      // 1. Override manual (0 ou 1) ganha sempre.
      // 2. Se nulo ou nÃ£o definido, segue a categoria.
      let vaiCozinha = false;
      if (envCozinha === 0 || envCozinha === false || envCozinha === '0' || envCozinha === 'false') {
        vaiCozinha = false;
      } else if (envCozinha === 1 || envCozinha === true || envCozinha === '1' || envCozinha === 'true') {
        vaiCozinha = true;
      } else if (catsCozinha.length > 0) {
        vaiCozinha = catsCozinha.includes(categoria);
      } else {
        vaiCozinha = true; // Default
      }
      if (vaiCozinha) return true;
    }
  }
  return false;
}

app.put('/api/pedidos/:id/cozinha-pronto', async (req, res) => {
  const { id } = req.params;
  try {
    // Marca todos os itens pendentes como 'pronto'
    await query("UPDATE pedido_itens SET status = 'pronto' WHERE pedido_id = ? AND status = 'pendente'", [id]);
    
    // Verifica se todos os itens estÃ£o pelo menos como 'pronto' ou 'entregue'
    const itens = (await query("SELECT status FROM pedido_itens WHERE pedido_id = ?", [id])).rows;
    const todosProntos = itens.every(i => i.status === 'pronto' || i.status === 'entregue');
    
    if (todosProntos) {
      await query("UPDATE pedidos SET status = 'pronto' WHERE id = ?", [id]);
    }

    // Notifica admin e garÃ§om
    const pedido = (await query("SELECT m.numero as mesa_numero FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [id])).rows[0];
    const mesaNum = pedido ? pedido.mesa_numero || 'BALCÃƒO' : 'BALCÃƒO';
    
    await safePusherTrigger('garconnexpress', 'pedido-pronto', { 
      pedido_id: id, 
      mesa_numero: mesaNum,
      mensagem: `ðŸ‘¨â€ðŸ³ Pedido da Mesa ${mesaNum} estÃ¡ pronto!` 
    });

    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Helper para gerar a clÃ¡usula WHERE de itens da cozinha de forma consistente
async function getFilterCozinha() {
  const config = await query("SELECT valor FROM sistema_config WHERE chave = 'categorias_cozinha'");
  const categoriasCozinha = config.rows[0]?.valor ? JSON.parse(config.rows[0].valor) : [];
  
  const sqlTrue = isPostgres ? 'TRUE' : '1';
  const sqlFalse = isPostgres ? 'FALSE' : '0';

  // LÃ³gica de Prioridade (TrÃªs Estados):
  // 1. Override manual (0 ou 1) ganha sempre.
  // 2. Se nulo (NULL), segue a categoria.
  
  if (categoriasCozinha.length > 0) {
    const catList = categoriasCozinha.map(c => `'${c.trim().toUpperCase().replace(/'/g, "''")}'`).join(',');
    return `(
      CASE 
        WHEN m.enviar_cozinha = ${sqlFalse} THEN 0
        WHEN m.enviar_cozinha = ${sqlTrue} THEN 1
        WHEN UPPER(TRIM(m.categoria)) IN (${catList}) THEN 1
        ELSE 0 
      END = 1
    )`;
  } else {
    // Se NENHUMA categoria estiver selecionada, apenas o que for explicitamente 1 vai para a cozinha.
    // O que for NULL nÃ£o vai (pois nÃ£o tem categoria habilitada).
    return `m.enviar_cozinha = ${sqlTrue}`;
  }
}

app.put('/api/pedidos/:id/marcar-entregue', async (req, res) => {
  const { id } = req.params;
  const { apenasProntos } = req.body;
  try {
    const filterCozinha = await getFilterCozinha();

    if (apenasProntos) {
      // Marca como entregue apenas os itens que jÃ¡ estÃ£o PRONTOS ou que NÃƒO vÃ£o para a cozinha (bebidas etc)
      // Note que invertemos a lÃ³gica do filtro para pegar o que NÃƒO Ã© cozinha
      await query(`
        UPDATE pedido_itens 
        SET status = 'entregue' 
        WHERE pedido_id = ? 
        AND (status = 'pronto' OR (status = 'pendente' AND menu_id IN (SELECT id FROM menu m WHERE NOT (${filterCozinha}))))
      `, [id]);
    } else {
      // BLOQUEIO SERVER-SIDE: Verifica se hÃ¡ itens SENDO FEITOS na cozinha
      const prep = await query(`
        SELECT pi.id 
        FROM pedido_itens pi 
        JOIN menu m ON pi.menu_id = m.id 
        WHERE pi.pedido_id = ? 
        AND pi.status = 'pendente' 
        AND (${filterCozinha})
      `, [id]);

      if (prep.rows.length > 0) {
        return res.status(400).json({ 
          error: 'COZINHA_ATIVA', 
          mensagem: `NÃ£o Ã© possÃ­vel entregar tudo! Existem ${prep.rows.length} itens ainda em preparo na cozinha.` 
        });
      }

      await query("UPDATE pedido_itens SET status = 'entregue' WHERE pedido_id = ?", [id]);
    }
    
    // ConsolidaÃ§Ã£o de itens duplicados (mesmo menu_id e observaÃ§Ã£o)
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

    // SÃ³ muda status do pedido para 'servido' se TODOS os itens foram entregues
    const pendentesCount = (await query("SELECT COUNT(*) as total FROM pedido_itens WHERE pedido_id = ? AND status IN ('pendente', 'pronto')", [id])).rows[0].total;
    
    if (parseInt(pendentesCount) === 0) {
      await query("UPDATE pedidos SET status = 'servido' WHERE id = ?", [id]);
      await notifyStatus(id, null, 'servido');
    } else {
      await notifyStatus(id, null, 'itens_atualizados');
    }
    
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true, entregueTudo: parseInt(pendentesCount) === 0 });
  } catch (error) { 
    console.error('Erro ao marcar entregue:', error);
    res.status(500).json({ error: error.message }); 
  }
});

app.put('/api/itens/:id/pronto', async (req, res) => {
  const { id } = req.params;
  try {
    const item = (await query("SELECT pedido_id, menu_id, quantidade, observacao FROM pedido_itens WHERE id = ?", [id])).rows[0];
    if (!item) return res.status(404).json({ error: 'Item nÃ£o encontrado' });

    // Tenta encontrar um item idÃªntico que jÃ¡ foi entregue para mesclar
    const itemExistente = (await query(
      "SELECT id, quantidade FROM pedido_itens WHERE pedido_id = ? AND menu_id = ? AND status = 'entregue' AND (observacao = ? OR (observacao IS NULL AND ? IS NULL)) AND id != ?", 
      [item.pedido_id, item.menu_id, item.observacao, item.observacao, id]
    )).rows[0];

    if (itemExistente) {
      // Mescla com o item existente e remove o atual
      await query("UPDATE pedido_itens SET quantidade = quantidade + ? WHERE id = ?", [item.quantidade, itemExistente.id]);
      await query("DELETE FROM pedido_itens WHERE id = ?", [id]);
    } else {
      // Apenas marca como entregue (OU PRONTO? A funÃ§Ã£o chama /pronto mas o cÃ³digo original marca como entregue?)
      // Na verdade, cozinha marca como pronto, garÃ§om marca como entregue.
      // Vou manter a lÃ³gica de marcar como entregue se for essa a intenÃ§Ã£o da rota original
      await query("UPDATE pedido_itens SET status = 'entregue' WHERE id = ?", [id]);
    }

    // Verifica se ainda existem itens pendentes no pedido
    const pendentes = (await query("SELECT id FROM pedido_itens WHERE pedido_id = ? AND status IN ('pendente', 'pronto')", [item.pedido_id])).rows;
    if (pendentes.length === 0) {
      await query("UPDATE pedidos SET status = 'servido' WHERE id = ?", [item.pedido_id]);
      await notifyStatus(item.pedido_id, null, 'servido');
    } else {
      await notifyStatus(item.pedido_id, null, 'itens_atualizados');
    }
    
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { 
    console.error('Erro ao marcar item pronto/entregue:', error);
    res.status(500).json({ error: error.message }); 
  }
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
    if (aberto.rows.length > 0) return res.status(400).json({ error: 'JÃ¡ existe um caixa aberto' });
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
    
    // Expira todos os cÃ³digos de acesso ativos ao fechar o caixa
    await query("UPDATE codigos_acesso SET status = 'expirado' WHERE status = 'ativo'");
    
    await safePusherTrigger('garconnexpress', 'status-caixa-atualizado', { status: 'fechado' });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Erro ao fechar caixa' }); }
});

app.get('/api/pedidos/ativos-detalhado', ensureDbInitialized, async (req, res) => {
  try {
    const pedidosRes = await query(`
      SELECT p.*, m.numero as mesa_numero, g.nome as garcom_nome 
      FROM pedidos p 
      LEFT JOIN mesas m ON p.mesa_id = m.id 
      LEFT JOIN garcons g ON p.garcom_id = g.usuario 
      WHERE p.status NOT IN ('entregue', 'cancelado') 
      ORDER BY p.created_at DESC
    `);
    
    const pedidos = pedidosRes.rows;
    if (pedidos.length === 0) return res.json([]);

    const pedidoIds = pedidos.map(p => p.id).join(',');
    const itensRes = await query(`
      SELECT pi.*, m.nome, m.preco, m.categoria, m.enviar_cozinha
      FROM pedido_itens pi
      JOIN menu m ON pi.menu_id = m.id
      WHERE pi.pedido_id IN (${pedidoIds})
    `);

    const itensMap = {};
    itensRes.rows.forEach(item => {
      if (!itensMap[item.pedido_id]) itensMap[item.pedido_id] = [];
      itensMap[item.pedido_id].push(item);
    });

    const resultado = pedidos.map(p => ({
      ...p,
      itens: itensMap[p.id] || []
    }));

    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pedidos', ensureDbInitialized, async (req, res) => {
  try {
    const result = await query(`SELECT p.*, m.numero as mesa_numero, g.nome as garcom_nome FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id LEFT JOIN garcons g ON p.garcom_id = g.usuario WHERE p.status NOT IN ('entregue', 'cancelado') ORDER BY p.created_at DESC`);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pedidos/cozinha', ensureDbInitialized, async (req, res) => {
  res.setHeader('X-Debug-Version', '1.0.3');
  try {
    const filterCozinha = await getFilterCozinha();
    
    // LÃ³gica super restrita: SÃ“ mostra o que for recebido ou aguardando fechamento
    // Isso exclui automaticamente cancelados, entregues, prontos, etc.
    let whereClause = `LOWER(pi.status) = 'pendente' AND LOWER(p.status) IN ('recebido', 'aguardando_fechamento', 'pronto')`;

    console.log(`ðŸ” [Cozinha] Filtro SQL: ${filterCozinha}`);

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
        p.observacao as pedido_observacao,
        mes.numero as mesa_numero 
      FROM pedido_itens pi 
      JOIN menu m ON pi.menu_id = m.id 
      JOIN pedidos p ON pi.pedido_id = p.id 
      LEFT JOIN mesas mes ON p.mesa_id = mes.id 
      WHERE (${whereClause}) AND ${filterCozinha}
      ORDER BY p.created_at ASC
    `);
    
    if (result.rows.length > 0) {
      console.log(`ðŸ³ [Cozinha] Enviando ${result.rows.length} itens. IDs de pedidos:`, [...new Set(result.rows.map(r => r.pedido_id))]);
    }
    
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pedidos/:id/pagamentos', async (req, res) => {
  try {
    const { id } = req.params;
    // Se a tabela nÃ£o existir, retorna array vazio em vez de erro 500
    try {
      const pagamentos = (await query("SELECT * FROM pagamentos WHERE pedido_id = ? ORDER BY data ASC", [id])).rows;
      res.json(pagamentos || []);
    } catch (e) {
      console.warn("âš ï¸ Tabela 'pagamentos' pode nÃ£o existir ainda:", e.message);
      res.json([]);
    }
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/pedidos/historico-detalhado', ensureDbInitialized, async (req, res) => {
  try {
    const pedidosRes = await query(`
      SELECT p.*, m.numero as mesa_numero, g.nome as garcom_nome 
      FROM pedidos p 
      LEFT JOIN mesas m ON p.mesa_id = m.id 
      LEFT JOIN garcons g ON p.garcom_id = g.usuario 
      WHERE p.status IN ('entregue', 'cancelado') 
      ORDER BY p.created_at DESC 
      LIMIT 50
    `);
    
    const pedidos = pedidosRes.rows;
    if (pedidos.length === 0) return res.json([]);

    const ids = pedidos.map(p => p.id);
    const idList = ids.join(',');

    // Busca itens e pagamentos de todos os pedidos de uma vez
    const [itensRes, pagamentosRes] = await Promise.all([
      query(`SELECT pi.*, m.nome, m.preco FROM pedido_itens pi JOIN menu m ON pi.menu_id = m.id WHERE pi.pedido_id IN (${idList})`),
      query(`SELECT * FROM pagamentos WHERE pedido_id IN (${idList}) ORDER BY data ASC`)
    ]);

    const itensMap = {};
    itensRes.rows.forEach(it => {
      if (!itensMap[it.pedido_id]) itensMap[it.pedido_id] = [];
      itensMap[it.pedido_id].push(it);
    });

    const pagamentosMap = {};
    pagamentosRes.rows.forEach(pg => {
      if (!pagamentosMap[pg.pedido_id]) pagamentosMap[pg.pedido_id] = [];
      pagamentosMap[pg.pedido_id].push(pg);
    });

    const resultado = pedidos.map(p => ({
      ...p,
      itens: itensMap[p.id] || [],
      pagamentos: pagamentosMap[p.id] || []
    }));

    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pedidos/historico', async (req, res) => {
  try {
    const result = await query(`SELECT p.*, m.numero as mesa_numero, g.nome as garcom_nome FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id LEFT JOIN garcons g ON p.garcom_id = g.usuario WHERE p.status IN ('entregue', 'cancelado') ORDER BY p.created_at DESC LIMIT 50`);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.delete('/api/pedidos/limpar', async (req, res) => {
  try {
    await query("DELETE FROM pedido_itens WHERE pedido_id IN (SELECT id FROM pedidos WHERE status IN ('entregue', 'cancelado'))");
    await query("DELETE FROM pedidos WHERE status IN ('entregue', 'cancelado')");
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: "Erro ao limpar: " + error.message }); }
});

app.get('/api/pedidos/:id', ensureDbInitialized, async (req, res) => {
  try {
    const result = await query(`SELECT p.*, m.numero as mesa_numero, g.nome as garcom_nome FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id LEFT JOIN garcons g ON p.garcom_id = g.usuario WHERE p.id = ?`, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido nÃ£o encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pedidos/:id/itens', ensureDbInitialized, async (req, res) => { 
  try {
    const result = await query(`SELECT pi.*, m.nome, m.preco, m.categoria, m.enviar_cozinha FROM pedido_itens pi JOIN menu m ON pi.menu_id = m.id WHERE pi.pedido_id = ? ORDER BY pi.status DESC, pi.id ASC`, [req.params.id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar itens do pedido:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/pedidos/itens/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const item = (await query("SELECT pedido_id, menu_id, quantidade FROM pedido_itens WHERE id = ?", [id])).rows[0];
    if (!item) return res.status(404).json({ error: 'Item nÃ£o encontrado' });
    await query("UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque + ? END WHERE id = ?", [item.quantidade, item.menu_id]);
    await query("DELETE FROM pedido_itens WHERE id = ?", [id]);
    const itensRestantes = (await query("SELECT status FROM pedido_itens WHERE pedido_id = ?", [item.pedido_id])).rows;
    if (itensRestantes.length === 0) {
      const pedido = (await query("SELECT mesa_id, m.numero FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [item.pedido_id])).rows[0];
      await query("DELETE FROM pedidos WHERE id = ?", [item.pedido_id]);
      if (pedido && pedido.mesa_id) {
        await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [pedido.mesa_id]);
        await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [pedido.mesa_id]);
        
        // Notifica o cliente para encerrar o acesso
        await safePusherTrigger('garconnexpress', `deslogar-mesa-${pedido.mesa_id}`, { 
          status: 'cancelado',
          mensagem: "Seu pedido foi cancelado e a mesa liberada. O acesso foi encerrado." 
        });
      }
      
      const mesaNum = pedido ? pedido.numero || 'BALCÃƒO' : 'BALCÃƒO';
      await safePusherTrigger('garconnexpress', 'pedido-cancelado', { 
        pedido_id: item.pedido_id, 
        mesa_numero: mesaNum,
        mensagem: `ðŸš¨ O Pedido #${item.pedido_id} (Mesa ${mesaNum}) foi CANCELADO.` 
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
        await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [pedido.mesa_id]);

        // Notifica o cliente para encerrar o acesso
        await safePusherTrigger('garconnexpress', `deslogar-mesa-${pedido.mesa_id}`, { 
          status: 'cancelado',
          mensagem: "Este pedido foi removido pelo estabelecimento. Seu acesso foi encerrado." 
        });
      }
      const mesaNum = pedido.numero || 'BALCÃƒO';
      await safePusherTrigger('garconnexpress', 'pedido-cancelado', { 
        pedido_id: id, 
        mesa_numero: mesaNum,
        mensagem: `ðŸš¨ O Pedido #${id} (Mesa ${mesaNum}) foi REMOVIDO pelo Admin.` 
      });
    }

    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/pedidos', async (req, res) => {
  const { mesa_id, garcom_id, itens, cobrar_taxa, observacao } = req.body;
  const deveCobrarTaxa = cobrar_taxa !== false;
  try {
    const caixaAberto = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
    if (!caixaAberto) return res.status(400).json({ error: 'O CAIXA ESTÃ FECHADO!' });
    for (const item of itens) {
      const p = (await query("SELECT nome, estoque FROM menu WHERE id = ?", [item.menu_id])).rows[0];
      if (p && p.estoque !== -1 && p.estoque < item.quantidade) return res.status(400).json({ error: `Estoque insuficiente: ${p.nome}` });
    }
    const subtotal = itens.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);
    const total = deveCobrarTaxa ? Math.round(subtotal * 1.10 * 100) / 100 : subtotal;
    let pedidoId;
    let resPedido;
    if (isPostgres) {
      resPedido = await query('INSERT INTO pedidos (mesa_id, garcom_id, total, status, created_at, cobrar_taxa, observacao) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id', [mesa_id || null, garcom_id, total, 'recebido', new Date().toISOString(), deveCobrarTaxa, observacao || '']);
      pedidoId = resPedido.rows[0].id;
    } else {
      resPedido = await query('INSERT INTO pedidos (mesa_id, garcom_id, total, status, created_at, cobrar_taxa, observacao) VALUES (?, ?, ?, ?, ?, ?, ?)', [mesa_id || null, garcom_id, total, 'recebido', new Date().toISOString(), deveCobrarTaxa ? 1 : 0, observacao || '']);
      pedidoId = resPedido.lastInsertRowid;
    }
    if (mesa_id) {
      const mesaIdNum = Number(mesa_id);
      console.log(`[Pedido] Processando mesa ${mesaIdNum}. GarÃ§om: ${garcom_id}`);
      
      await query("UPDATE mesas SET status = 'ocupada', garcom_id = ? WHERE id = ?", [garcom_id, mesaIdNum]);

      // GERAÃ‡ÃƒO AUTOMÃTICA DE CÃ“DIGO DE ACESSO (SÃ³ se nÃ£o houver um ativo)
      const acessoExistente = (await query("SELECT id, codigo FROM codigos_acesso WHERE mesa_id = ? AND status = 'ativo' LIMIT 1", [mesaIdNum])).rows[0];

      if (!acessoExistente) {
        const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let novoCodigo = '';
        for (let i = 0; i < 4; i++) novoCodigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));

        await query("INSERT INTO codigos_acesso (mesa_id, codigo, status) VALUES (?, ?, 'ativo')", [mesaIdNum, novoCodigo]);
        console.log(`ðŸ”‘ CÃ³digo automÃ¡tico gerado para Mesa ${mesaIdNum}: ${novoCodigo}`);
      } else {
        console.log(`â„¹ï¸ Mesa ${mesaIdNum} jÃ¡ possui cÃ³digo de acesso ativo (ID: ${acessoExistente.id}, CÃ³digo: ${acessoExistente.codigo}). Mantendo sessÃ£o.`);
      }
    }    for (const item of itens) {
      await query('INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status) VALUES (?, ?, ?, ?, ?)', [pedidoId, item.menu_id, item.quantidade, item.observacao || '', 'pendente']);
      await query("UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque - ? END WHERE id = ?", [item.quantidade, item.menu_id]);
      await verificarEstoqueBaixo(item.menu_id);
    }
    let mesaNum = 'BALCÃƒO';
    if (mesa_id) { 
      const rm = await query("SELECT numero FROM mesas WHERE id = ?", [mesa_id]); 
      mesaNum = rm.rows[0] ? rm.rows[0].numero : 'BALCÃƒO'; 
    }

    // NOTIFICAÃ‡ÃƒO WHATSAPP DETALHADA
    const itensNomes = [];
    for (const item of itens) {
      const p = (await query("SELECT nome FROM menu WHERE id = ?", [item.menu_id])).rows[0];
      itensNomes.push(`${item.quantidade}x ${p ? p.nome : 'Item'}`);
    }
    const msgWpp = `ðŸš€ *NOVO PEDIDO #${pedidoId}*\nðŸ“ Mesa: ${mesaNum}\nðŸ“ Itens:\n${itensNomes.join('\n')}\nðŸ’° Total: R$ ${total.toFixed(2)}`;

    // Verifica se o pedido tem itens para a cozinha (respeitando as categorias configuradas)
    const configK = await query("SELECT valor FROM sistema_config WHERE chave = 'categorias_cozinha'");
    const catsCozinha = configK.rows[0]?.valor ? JSON.parse(configK.rows[0].valor).map(c => c.trim().toUpperCase()) : [];
    
    let temItemCozinha = false;
    for (const item of itens) {
      const m = (await query("SELECT enviar_cozinha, categoria FROM menu WHERE id = ?", [item.menu_id])).rows[0];
      if (m) {
        const envCozinha = m.enviar_cozinha;
        const categoria = (m.categoria || '').trim().toUpperCase();
        
        // LÃ³gica consistente com getFilterCozinha:
        let vaiCozinha = false;
        if (envCozinha === 0 || envCozinha === false || envCozinha === '0' || envCozinha === 'false') {
          vaiCozinha = false; // Manualmente fora
        } else if (catsCozinha.length > 0) {
          vaiCozinha = catsCozinha.includes(categoria); // Segue filtro de categorias
        } else {
          vaiCozinha = (envCozinha === 1 || envCozinha === true || envCozinha === '1' || envCozinha === 'true');
        }

        if (vaiCozinha) {
          temItemCozinha = true;
          break;
        }
      }
    }

    // Dispara notificaÃ§Ãµes CRÃTICAS para a UI (Aguardar para garantir envio no Vercel)
    await Promise.all([
      notifyStatus(pedidoId, mesa_id, 'recebido', mesaNum),
      safePusherTrigger('garconnexpress', 'menu-atualizado', {}),
      safePusherTrigger('garconnexpress', 'novo-pedido', { 
        para_cozinha: temItemCozinha,
        pedido: { id: pedidoId, mesa_id, mesa_numero: mesaNum, status: 'recebido' } 
      })
    ]);

    // WhatsApp pode rodar em paralelo/background sem travar a resposta principal
    sendWhatsAppMessage(msgWpp).catch(e => console.error('Erro WhatsApp:', e.message));

    res.json({ id: pedidoId, success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/pedidos/:id/atualizar-itens', async (req, res) => {
  const { id } = req.params;
  const { itens, observacao } = req.body;
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
      await verificarEstoqueBaixo(item.menu_id);
      const pMenu = (await query("SELECT preco FROM menu WHERE id = ?", [item.menu_id])).rows[0];
      if (pMenu) novoSub += (pMenu.preco * item.quantidade);
    }
    const pedido = (await query("SELECT cobrar_taxa FROM pedidos WHERE id = ?", [id])).rows[0];
    const total = (pedido && pedido.cobrar_taxa) ? Math.round(novoSub * 1.10 * 100) / 100 : novoSub;
    
    // Determina o status do pedido com base nos itens:
    const temPendente = itens.some(i => i.status === 'pendente' || i.status === 'pronto');
    const novoStatusPedido = temPendente ? 'recebido' : 'servido';
    const agora = new Date().toISOString();
    
    // Busca o status atual para saber se deve resetar o cronÃ´metro
    const statusAtualRes = await query("SELECT status FROM pedidos WHERE id = ?", [id]);
    const statusAnterior = statusAtualRes.rows[0] ? statusAtualRes.rows[0].status : '';

    // Se estÃ¡ voltando para 'recebido' vindo de um status diferente de 'recebido', reinicia o cronÃ´metro
    // Se jÃ¡ estava em 'recebido', mantÃ©m o original.
    if (temPendente) {
      if (statusAnterior !== 'recebido') {
        await query("UPDATE pedidos SET total = ?, status = ?, created_at = ?, observacao = ? WHERE id = ?", [total, novoStatusPedido, agora, observacao || '', id]);
      } else {
        await query("UPDATE pedidos SET total = ?, status = ?, observacao = ? WHERE id = ?", [total, novoStatusPedido, observacao || '', id]);
      }
      
      const resMesa = await query("SELECT m.numero FROM pedidos p JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [id]);
      const mesaNum = resMesa.rows[0] ? resMesa.rows[0].numero : 'BALCÃƒO';
      
      // Verifica se hÃ¡ itens para a cozinha
      const temItemCozinha = await checkTemItemCozinha(itens.map(i => i.menu_id));
      
      // Notifica em paralelo
      await Promise.all([
        notifyStatus(id, null, 'itens_atualizados'),
        safePusherTrigger('garconnexpress', 'menu-atualizado', {}),
        safePusherTrigger('garconnexpress', 'novo-pedido', { 
          para_cozinha: temItemCozinha,
          pedido: { id: id, mesa_numero: mesaNum, status: 'recebido' } 
        })
      ]);
    } else {
      await query("UPDATE pedidos SET total = ?, status = ?, observacao = ? WHERE id = ?", [total, novoStatusPedido, observacao || '', id]);
      await Promise.all([
        notifyStatus(id, null, 'itens_atualizados'),
        safePusherTrigger('garconnexpress', 'menu-atualizado', {})
      ]);
    }
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/pedidos/:id/adicionar', async (req, res) => {
  const { id } = req.params;
  const { itens, cobrar_taxa, observacao } = req.body;
  try {
    const pOrig = (await query("SELECT cobrar_taxa FROM pedidos WHERE id = ?", [id])).rows[0];
    const deveTaxa = cobrar_taxa !== undefined ? cobrar_taxa : (pOrig ? pOrig.cobrar_taxa : true);
    for (const item of itens) {
      const exist = await query('SELECT id, quantidade FROM pedido_itens WHERE pedido_id = ? AND menu_id = ? AND observacao = ? AND status = ?', [id, item.menu_id, item.observacao || '', 'pendente']);
      if (exist.rows.length > 0) await query('UPDATE pedido_itens SET quantidade = ? WHERE id = ?', [exist.rows[0].quantidade + item.quantidade, exist.rows[0].id]);
      else await query('INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status) VALUES (?, ?, ?, ?, ?)', [id, item.menu_id, item.quantidade, item.observacao || '', 'pendente']);
      await query("UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque - ? END WHERE id = ?", [item.quantidade, item.menu_id]);
      await verificarEstoqueBaixo(item.menu_id);
    }
    const tItens = (await query("SELECT i.quantidade, m.preco FROM pedido_itens i JOIN menu m ON i.menu_id = m.id WHERE i.pedido_id = ?", [id])).rows;
    const sub = tItens.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
    const tot = deveTaxa ? Math.round(sub * 1.10 * 100) / 100 : sub;
    const agora = new Date().toISOString();

    // Busca o status atual para saber se deve resetar o cronÃ´metro
    const statusAtualRes = await query("SELECT status FROM pedidos WHERE id = ?", [id]);
    const statusAnterior = statusAtualRes.rows[0] ? statusAtualRes.rows[0].status : '';

    // Se estÃ¡ voltando para 'recebido' vindo de um status diferente, reinicia o cronÃ´metro (novo ciclo de preparo)
    // Se jÃ¡ estava em 'recebido', mantÃ©m o original.
    if (statusAnterior !== 'recebido') {
      await query("UPDATE pedidos SET total = ?, cobrar_taxa = ?, status = 'recebido', created_at = ?, observacao = ? WHERE id = ?", [tot, isPostgres ? deveTaxa : (deveTaxa?1:0), agora, observacao || '', id]);
    } else {
      await query("UPDATE pedidos SET total = ?, cobrar_taxa = ?, status = 'recebido', observacao = ? WHERE id = ?", [tot, isPostgres ? deveTaxa : (deveTaxa?1:0), observacao || '', id]);
    }
    const pMesa = (await query("SELECT mesa_id, m.numero FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [id])).rows[0];
    if (pMesa && pMesa.mesa_id) await query("UPDATE mesas SET status = 'ocupada' WHERE id = ?", [pMesa.mesa_id]);
    
    // Notifica a cozinha que hÃ¡ novos itens para preparar (com som)
    const mesaNum = pMesa ? pMesa.numero || 'BALCÃƒO' : 'BALCÃƒO';
    
    // Verifica se os NOVOS itens vÃ£o para a cozinha
    const temItemCozinha = await checkTemItemCozinha(itens.map(i => i.menu_id));

    // Notifica em paralelo
    await Promise.all([
      notifyStatus(id, null, 'itens_adicionados'),
      safePusherTrigger('garconnexpress', 'menu-atualizado', {}),
      safePusherTrigger('garconnexpress', 'novo-pedido', { 
        para_cozinha: temItemCozinha,
        pedido: { id: id, mesa_numero: mesaNum, status: 'recebido' } 
      })
    ]);

    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Cliente solicita o fechamento da conta (avisar garÃ§om)
app.post('/api/cliente/solicitar-conta', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token Ã© obrigatÃ³rio.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'cliente') return res.status(403).json({ error: 'Acesso negado.' });

    const mesaId = decoded.mesa_id;
    
    // Busca o pedido ativo da mesa
    const pedido = (await query("SELECT id, mesa_id FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado') ORDER BY id DESC LIMIT 1", [mesaId])).rows[0];
    
    if (!pedido) return res.status(404).json({ error: 'Nenhum pedido ativo encontrado para esta mesa.' });

    // 1. Atualiza o banco de dados
    await query("UPDATE pedidos SET solicitou_fechamento = TRUE WHERE id = ?", [pedido.id]);
    
    // 2. Busca nÃºmero da mesa para a notificaÃ§Ã£o
    const mesaRes = await query("SELECT numero FROM mesas WHERE id = ?", [mesaId]);
    const mesaNum = mesaRes.rows[0]?.numero || '??';

    // 3. Notifica GarÃ§om e Admin via Pusher (Som + Modal + Visual Pulsante)
    await safePusherTrigger('garconnexpress', 'solicitacao-fechamento-cliente', {
      pedido_id: pedido.id,
      mesa_id: mesaId,
      mesa_numero: mesaNum,
      mensagem: `ðŸ™‹â€â™‚ï¸ MESA ${mesaNum} solicitou o fechamento da conta!`
    });

    res.json({ success: true });
  } catch (error) {
    console.error('âŒ ERRO EM /api/cliente/solicitar-conta:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/pedidos/:id/solicitar-fechamento', async (req, res) => {
  const { id } = req.params;
  const { mesa_id, forma_pagamento, desconto, acrescimo, valor_recebido, troco, total, num_pessoas, valor_por_pessoa } = req.body;
  try {
    let totalFinal = total;
    
    // Se o total nÃ£o for enviado (solicitaÃ§Ã£o do garÃ§om), calcula com base nos itens
    if (totalFinal === undefined || totalFinal === null || totalFinal === 0) {
      const pOrig = (await query("SELECT cobrar_taxa FROM pedidos WHERE id = ?", [id])).rows[0];
      const deveTaxa = pOrig ? pOrig.cobrar_taxa : true;
      const tItens = (await query("SELECT i.quantidade, m.preco FROM pedido_itens i JOIN menu m ON i.menu_id = m.id WHERE i.pedido_id = ?", [id])).rows;
      const sub = tItens.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
      totalFinal = deveTaxa ? Math.round(sub * 1.10 * 100) / 100 : sub;
    }

    // Ativa fechamento_liberado quando o garÃ§om processa a solicitaÃ§Ã£o
    await query(`UPDATE pedidos SET status = 'aguardando_fechamento', forma_pagamento = ?, desconto = ?, acrescimo = ?, valor_recebido = ?, troco = ?, total = ?, num_pessoas = ?, valor_por_pessoa = ?, cobrar_taxa = ?, fechamento_liberado = TRUE WHERE id = ?`, 
      [forma_pagamento || 'Dinheiro', desconto || 0, acrescimo || 0, valor_recebido || 0, troco || 0, totalFinal, num_pessoas || 1, valor_por_pessoa || totalFinal, (req.body.cobrar_taxa !== undefined ? (req.body.cobrar_taxa ? 1 : 0) : 1), id]);
    
    if (mesa_id) await query("UPDATE mesas SET status = 'fechando' WHERE id = ?", [mesa_id]);
    await notifyStatus(id, mesa_id, 'aguardando_fechamento');

    // Notifica o cliente que o cupom de conferÃªncia foi liberado
    await safePusherTrigger('garconnexpress', `fechamento-liberado-mesa-${mesa_id}`, {
        pedido_id: id,
        mensagem: "Seu cupom de conferÃªncia estÃ¡ disponÃ­vel!"
    });

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
    if (!pOrig) return res.status(404).json({ error: 'PEDIDO NÃƒO ENCONTRADO' });

    // 2. Registra o valor no fluxo de caixa
    const col = forma_pagamento === 'CartÃ£o' ? 'total_cartao' : (forma_pagamento === 'Pix' ? 'total_pix' : 'total_dinheiro');
    await query(`UPDATE fluxo_caixa SET ${col} = ${col} + ?, total_vendas = total_vendas + ? WHERE id = ?`, [valor_pago, valor_pago, cx.id]);

    // 3. Garante que a tabela existe e registra o pagamento
    const sqlCreate = isPostgres 
      ? `CREATE TABLE IF NOT EXISTS pagamentos (id SERIAL PRIMARY KEY, pedido_id INTEGER, valor REAL, forma_pagamento TEXT, recebido REAL, troco REAL, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
          : `CREATE TABLE IF NOT EXISTS pagamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, pedido_id INTEGER, valor REAL, forma_pagamento TEXT, recebido REAL, troco REAL, data TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`;
    
    await query(sqlCreate);
    await query("INSERT INTO pagamentos (pedido_id, valor, forma_pagamento, recebido, troco) VALUES (?, ?, ?, ?, ?)", [id, valor_pago, forma_pagamento, rec, trc]);

    // 4. Atualiza o pedido original: incrementa o pago_parcial e ajusta o nÃºmero de pessoas
    const novoPagoParcial = (pOrig.pago_parcial || 0) + valor_pago;
    // O total do pedido pOrig.total jÃ¡ deve estar atualizado com o valor total bruto (subtotal+taxa+acres-desc)
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

    // 2. Remove os itens do pedido original (jÃ¡ que foram pagos separadamente)
    for (const i of itens) {
      await query('DELETE FROM pedido_itens WHERE id = ?', [i.id]);
    }

    // 3. Registra o valor no fluxo de caixa
    const col = forma_pagamento === 'CartÃ£o' ? 'total_cartao' : (forma_pagamento === 'Pix' ? 'total_pix' : 'total_dinheiro');
    await query(`UPDATE fluxo_caixa SET ${col} = ${col} + ?, total_vendas = total_vendas + ? WHERE id = ?`, [total, total, cx.id]);

    // 4. Verifica se restam itens no pedido original
    const rest = (await query("SELECT id FROM pedido_itens WHERE pedido_id = ?", [id])).rows;
    if (rest.length === 0) { 
      await query("UPDATE pedidos SET status = 'entregue', pago_parcial = pago_parcial + ?, total = 0 WHERE id = ?", [total, id]); 
      await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [mesa_id]);
      await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [mesa_id]);
      
      // Notifica o cliente para encerrar o acesso
      await safePusherTrigger('garconnexpress', `deslogar-mesa-${mesa_id}`, { 
        mensagem: "Sua conta foi finalizada. Obrigado pela preferÃªncia!" 
      });

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
          // CenÃ¡rio Multi-Pagamento (Suporta formato novo de objeto ou antigo de string)
          for (const pag of pagamentos_detalhados) {
            let forma = (pag && typeof pag === 'object') ? pag.forma_pagamento : pag;
            let valorParte = (pag && typeof pag === 'object') ? pag.valor : (p.total / pagamentos_detalhados.length);
            let recebido = (pag && typeof pag === 'object') ? (pag.recebido || valorParte) : valorParte;
            let troco = (pag && typeof pag === 'object') ? (pag.troco || 0) : 0;
            
            if (!forma) forma = 'Dinheiro';
            if (!valorParte || isNaN(valorParte)) valorParte = 0;

            const col = forma === 'CartÃ£o' ? 'total_cartao' : (forma === 'Pix' ? 'total_pix' : 'total_dinheiro');
            await query(`UPDATE fluxo_caixa SET ${col} = ${col} + ?, total_vendas = total_vendas + ? WHERE id = ?`, [valorParte, valorParte, cx.id]);
            await query("INSERT INTO pagamentos (pedido_id, valor, forma_pagamento, recebido, troco) VALUES (?, ?, ?, ?, ?)", [id, valorParte, forma, recebido, troco]);
          }
        } else {
          // CenÃ¡rio Normal (Um Ãºnico pagamento para o saldo restante)
          const col = p.forma_pagamento === 'CartÃ£o' ? 'total_cartao' : (p.forma_pagamento === 'Pix' ? 'total_pix' : 'total_dinheiro');
          const valorFinal = p.total;
          
          // Busca dados de recebido/troco do pedido original (salvos no solicitar-fechamento)
          const pDatalhes = (await query("SELECT valor_recebido, troco FROM pedidos WHERE id = ?", [id])).rows[0];
          const rec = pDatalhes ? pDatalhes.valor_recebido : valorFinal;
          const trc = pDatalhes ? pDatalhes.troco : 0;

          await query(`UPDATE fluxo_caixa SET ${col} = ${col} + ?, total_vendas = total_vendas + ? WHERE id = ?`, [valorFinal, valorFinal, cx.id]);
          await query("INSERT INTO pagamentos (pedido_id, valor, forma_pagamento, recebido, troco) VALUES (?, ?, ?, ?, ?)", [id, valorFinal, p.forma_pagamento, rec, trc]);
        }

        // Atualiza o pedido: limpa o saldo e soma ao pago_parcial para consolidar o histÃ³rico
        await query("UPDATE pedidos SET pago_parcial = pago_parcial + total, total = 0 WHERE id = ?", [id]);
      }
    }
    await query('UPDATE pedidos SET status = ? WHERE id = ?', [status, id]);
    
    if (status === 'cancelado') {
      await query("UPDATE pedido_itens SET status = 'cancelado' WHERE pedido_id = ?", [id]);
    }
    const pm = (await query("SELECT p.mesa_id, m.numero FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [id])).rows[0];
    const mesaNum = pm ? pm.numero || 'BALCÃƒO' : 'BALCÃƒO';

    // Se o status for cancelado ou entregue, libera a mesa e o cÃ³digo
    if ((status === 'cancelado' || status === 'entregue') && pm && pm.mesa_id) {
        await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [pm.mesa_id]);
        await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [pm.mesa_id]);

        // Notifica o cliente logado para encerrar o acesso
        const msgLogout = status === 'entregue' ? "Sua conta foi finalizada. Obrigado pela preferÃªncia!" : "Este pedido foi cancelado pelo estabelecimento. Seu acesso foi encerrado.";
        await safePusherTrigger('garconnexpress', `deslogar-mesa-${pm.mesa_id}`, { 
          mensagem: msgLogout,
          status: status, // envia 'cancelado' ou 'entregue'
          mesa_id: pm.mesa_id 
        });
        
        if (status === 'cancelado') {
          console.log(`âŒ Pedido ${id} cancelado pelo Admin. Notificando globalmente...`);
          await safePusherTrigger('garconnexpress', 'pedido-cancelado', { 
            id: id,
            pedido_id: id, 
            mesa_numero: mesaNum,
            mensagem: `ðŸš¨ O Pedido #${id} (Mesa ${mesaNum}) foi CANCELADO pelo Admin.` 
          });
        }
    }
    
    await notifyStatus(id, null, status);
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.get('/api/menu', ensureDbInitialized, async (req, res) => {
  try {
    const { admin } = req.query;
    let querySql = 'SELECT * FROM menu';
    if (admin !== 'true') {
      querySql += ' WHERE visivel = ' + (isPostgres ? 'TRUE' : '1');
    }
    const menuRes = await query(querySql);
    let menu = menuRes.rows;

    const ordemRes = await query("SELECT valor FROM sistema_config WHERE chave = 'ordem_categorias'");
    if (ordemRes.rows.length > 0 && ordemRes.rows[0].valor) {
      const ordem = JSON.parse(ordemRes.rows[0].valor).map(c => c.trim().toUpperCase());
      
      menu.sort((a, b) => {
        const catA = a.categoria.trim().toUpperCase();
        const catB = b.categoria.trim().toUpperCase();
        const indexA = ordem.indexOf(catA);
        const indexB = ordem.indexOf(catB);
        
        // Se ambos estÃ£o na lista de ordem, segue a ordem
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        // Se apenas um estÃ¡, ele vem primeiro
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        // Se nenhum estÃ¡, mantÃ©m ordem alfabÃ©tica original ou id
        return catA.localeCompare(catB);
      });
    } else {
      // PadrÃ£o: Ordenar por validade como estava ou alfabÃ©tico
      menu.sort((a, b) => (a.validade || '').localeCompare(b.validade || ''));
    }

    res.json(menu);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/config/ordem-categorias', async (req, res) => {
  const { ordem } = req.body;
  try {
    const valor = JSON.stringify(ordem);
    if (isPostgres) {
      await query("INSERT INTO sistema_config (chave, valor) VALUES ('ordem_categorias', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [valor]);
    } else {
      await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('ordem_categorias', ?)", [valor]);
    }
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/menu/:id', async (req, res) => {
  const { nome, categoria, preco, preco_original, descricao, imagem, estoque, validade, enviar_cozinha, visivel, em_promocao } = req.body;
  const dataValidade = validade && validade.trim() !== "" ? validade : null;
  const envCozinha = enviar_cozinha !== undefined ? (isPostgres ? enviar_cozinha : (enviar_cozinha ? 1 : 0)) : null;
  const isVisivel = visivel !== undefined ? (isPostgres ? visivel : (visivel ? 1 : 0)) : (isPostgres ? true : 1);
  const emPromocao = em_promocao !== undefined ? (isPostgres ? em_promocao : (em_promocao ? 1 : 0)) : (isPostgres ? false : 0);
  try {
    await query('UPDATE menu SET nome = ?, categoria = ?, preco = ?, preco_original = ?, descricao = ?, imagem = ?, estoque = ?, validade = ?, enviar_cozinha = ?, visivel = ?, em_promocao = ? WHERE id = ?', [nome, categoria, preco, preco_original, descricao, imagem, estoque, dataValidade, envCozinha, isVisivel, emPromocao, req.params.id]);
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/menu', async (req, res) => {
  const { nome, categoria, preco, preco_original, descricao, imagem, estoque, validade, enviar_cozinha, visivel, em_promocao } = req.body;
  const envCozinha = enviar_cozinha !== undefined ? (isPostgres ? enviar_cozinha : (enviar_cozinha ? 1 : 0)) : null;
  const isVisivel = visivel !== undefined ? (isPostgres ? visivel : (visivel ? 1 : 0)) : (isPostgres ? true : 1);
  const emPromocao = em_promocao !== undefined ? (isPostgres ? em_promocao : (em_promocao ? 1 : 0)) : (isPostgres ? false : 0);
  try { 
    await query('INSERT INTO menu (nome, categoria, preco, preco_original, descricao, imagem, estoque, validade, enviar_cozinha, visivel, em_promocao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [nome, categoria, preco, preco_original, descricao, imagem, estoque || -1, validade || null, envCozinha, isVisivel, emPromocao]); 
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true }); 
  }
  catch (error) { res.status(500).json({ error: error.message }); }
});
app.delete('/api/menu/:id', async (req, res) => { try { await query('DELETE FROM menu WHERE id = ?', [req.params.id]); res.json({ success: true }); } catch (error) { res.status(500).json({ error: error.message }); } });

app.delete('/api/menu/categoria/:categoria', async (req, res) => {
  const { categoria } = req.params;
  try {
    // Usamos UPPER para garantir que pegue variaÃ§Ãµes de caixa se houver (ex: Bebidas vs bebidas)
    await query('DELETE FROM menu WHERE UPPER(categoria) = UPPER(?)', [categoria]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/menu/categoria/:categoria', async (req, res) => {
  const { categoria } = req.params;
  const { novoNome } = req.body;
  if (!novoNome) return res.status(400).json({ error: 'Novo nome Ã© obrigatÃ³rio' });
  const nomeLimpo = novoNome.trim();
  
  try {
    // 1. Atualiza todos os itens do cardÃ¡pio que pertencem a esta categoria
    await query('UPDATE menu SET categoria = ? WHERE UPPER(categoria) = UPPER(?)', [nomeLimpo, categoria]);

    // 2. Sincroniza a configuraÃ§Ã£o de categorias da cozinha (se existir)
    const configRes = await query("SELECT valor FROM sistema_config WHERE chave = 'categorias_cozinha'");
    if (configRes.rows.length > 0 && configRes.rows[0].valor) {
      let categoriasCozinha = JSON.parse(configRes.rows[0].valor);
      let alterouConfig = false;
      
      // Procura o nome antigo na lista (case-insensitive) e substitui pelo novo
      categoriasCozinha = categoriasCozinha.map(cat => {
        if (cat.toUpperCase() === categoria.toUpperCase()) {
          alterouConfig = true;
          return nomeLimpo;
        }
        return cat;
      });

      if (alterouConfig) {
        const novoValorConfig = JSON.stringify(categoriasCozinha);
        if (isPostgres) {
          await query("UPDATE sistema_config SET valor = ? WHERE chave = 'categorias_cozinha'", [novoValorConfig]);
        } else {
          await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('categorias_cozinha', ?)", [novoValorConfig]);
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao renomear categoria:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/garcons', ensureDbInitialized, async (req, res) => {
  try {
    const result = await query('SELECT id, nome, usuario, telefone, comissao, is_online FROM garcons ORDER BY nome');
    res.json(result.rows);
  } catch (error) { 
    console.error('âŒ ERRO NA ROTA /api/garcons:', error);
    res.status(500).json({ error: error.message, stack: error.stack }); 
  }
});
app.post('/api/garcons', async (req, res) => { 
  try {
    const { nome, usuario, senha, telefone, comissao } = req.body; 
    const hashed = await bcrypt.hash(senha || '123', saltRounds); 
    await query('INSERT INTO garcons (nome, usuario, senha, telefone, comissao) VALUES (?, ?, ?, ?, ?)', [nome, usuario, hashed, telefone, comissao || 0]); 
    res.json({ success: true }); 
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.put('/api/garcons/:id', async (req, res) => {
  try {
    const { nome, usuario, senha, telefone, comissao } = req.body;
    if (senha) {
      const hashed = await bcrypt.hash(senha, saltRounds);
      await query('UPDATE garcons SET nome = ?, usuario = ?, senha = ?, telefone = ?, comissao = ? WHERE id = ?', [nome, usuario, hashed, telefone, comissao || 0, req.params.id]);
    } else {
      await query('UPDATE garcons SET nome = ?, usuario = ?, telefone = ?, comissao = ? WHERE id = ?', [nome, usuario, telefone, comissao || 0, req.params.id]);
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
app.put('/api/mesas/:id/liberar', async (req, res) => { 
  try { 
    const mesaId = req.params.id;
    await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [mesaId]); 
    await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [mesaId]);
    
    // Notifica o cliente para encerrar o acesso
    await safePusherTrigger('garconnexpress', `deslogar-mesa-${mesaId}`, { 
      status: 'cancelado',
      mensagem: "Mesa liberada pelo estabelecimento. Seu acesso foi encerrado." 
    });

    await notifyStatus(null, mesaId, 'liberada'); 
    res.json({ success: true }); 
  } catch (error) { res.status(500).json({ error: error.message }); } 
});
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
    res.json((await query(`
      SELECT m.*, 
        (SELECT p.id FROM pedidos p WHERE p.mesa_id = m.id AND p.status != 'entregue' AND p.status != 'cancelado' ORDER BY p.id DESC LIMIT 1) as pedido_id,
        (SELECT p.created_at FROM pedidos p WHERE p.mesa_id = m.id AND p.status != 'entregue' AND p.status != 'cancelado' ORDER BY p.id DESC LIMIT 1) as pedido_created_at, 
        COALESCE(
          (SELECT p.garcom_id FROM pedidos p WHERE p.mesa_id = m.id AND p.status != 'entregue' AND p.status != 'cancelado' ORDER BY p.id DESC LIMIT 1),
          m.garcom_id
        ) as garcom_id,
        (SELECT p.status FROM pedidos p WHERE p.mesa_id = m.id AND p.status != 'entregue' AND p.status != 'cancelado' ORDER BY p.id DESC LIMIT 1) as pedido_status,
        (SELECT p.solicitou_fechamento FROM pedidos p WHERE p.mesa_id = m.id AND p.status != 'entregue' AND p.status != 'cancelado' ORDER BY p.id DESC LIMIT 1) as solicitou_fechamento,
        (SELECT p.fechamento_liberado FROM pedidos p WHERE p.mesa_id = m.id AND p.status != 'entregue' AND p.status != 'cancelado' ORDER BY p.id DESC LIMIT 1) as fechamento_liberado,
        (SELECT ca.codigo FROM codigos_acesso ca WHERE ca.mesa_id = m.id AND ca.status = 'ativo' ORDER BY ca.id DESC LIMIT 1) as codigo_acesso
      FROM mesas m ORDER BY m.numero
    `)).rows); 
  } catch (error) { res.status(500).json({ error: error.message }); }
});
// Cliente busca seus prÃ³prios pedidos ativos
app.post('/api/cliente/meus-pedidos', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token Ã© obrigatÃ³rio.' });

  try {
    // 1. Valida o JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'SessÃ£o invÃ¡lida ou expirada.' });
    }

    if (decoded.role !== 'cliente') {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const mesaId = decoded.mesa_id;
    const acessoId = decoded.acesso_id;
    const pedidoIdSessao = decoded.pedido_id; // ID do pedido vinculado no login

    // 2. Verifica se o cÃ³digo de acesso existe.
    // Buscamos o status e a data de criaÃ§Ã£o para garantir isolamento entre sessÃµes.
    const acesso = (await query("SELECT id, status, criado_at FROM codigos_acesso WHERE id = ?", [acessoId])).rows[0];
    if (!acesso) return res.status(401).json({ error: 'SessÃ£o invÃ¡lida ou expirada.' });

    // 3. Busca todos os pedidos vinculados a esta sessÃ£o (Isolamento de SessÃ£o)
    // Buscamos todos os pedidos criados APÃ“S a geraÃ§Ã£o do cÃ³digo de acesso.
    const pedidosSessao = (await query(`
      SELECT id, total, status, cobrar_taxa, desconto, acrescimo, solicitou_fechamento, fechamento_liberado 
      FROM pedidos 
      WHERE mesa_id = ? 
      AND STRFTIME('%Y-%m-%d %H:%M:%S', created_at) >= STRFTIME('%Y-%m-%d %H:%M:%S', ?)
      AND status != 'cancelado'
      ORDER BY id ASC
    `, [mesaId, acesso.criado_at])).rows;

    if (pedidosSessao.length === 0) {
      return res.json({ success: true, pedido: null, itens: [] });
    }

    // 4. Busca todos os itens de todos os pedidos da sessÃ£o
    const pedidoIds = pedidosSessao.map(p => p.id);
    const placeholders = pedidoIds.map(() => '?').join(',');
    const itens = (await query(`
      SELECT pi.*, m.nome as menu_nome, m.imagem as menu_imagem, m.preco as menu_preco
      FROM pedido_itens pi
      JOIN menu m ON pi.menu_id = m.id
      WHERE pi.pedido_id IN (${placeholders})
      AND pi.status != 'cancelado'
      ORDER BY pi.id DESC
    `, pedidoIds)).rows;

    // 5. Consolida os dados e calcula o total real
    // Usamos o Ãºltimo pedido da lista para as flags de status (fechamento, etc)
    const ultimoPedido = pedidosSessao[pedidosSessao.length - 1];
    
    let totalReal = 0;
    itens.forEach(i => {
      const preco = i.preco || i.menu_preco || 0;
      totalReal += (i.quantidade * preco);
    });

    // Aplica taxa de serviÃ§o (baseada na preferÃªncia do Ãºltimo pedido ou se algum deles cobrar)
    const cobrarTaxa = pedidosSessao.some(p => p.cobrar_taxa === 1 || p.cobrar_taxa === true);
    if (cobrarTaxa) totalReal = Math.round(totalReal * 1.10 * 100) / 100;

    const pedidoConsolidado = {
      ...ultimoPedido,
      total: totalReal,
      cobrar_taxa: cobrarTaxa
    };

    res.json({
      success: true,
      pedido: pedidoConsolidado,
      itens
    });

  } catch (error) {
    console.error('âŒ ERRO EM /api/cliente/meus-pedidos:', error);
    res.status(500).json({ error: error.message });
  }
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
      res.cookie('admin_token', token, {
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
    const result = await query('SELECT id, nome, usuario, senha FROM garcons WHERE usuario = ?', [usuario]);
    if (result.rows.length > 0 && await bcrypt.compare(senha, result.rows[0].senha)) { 
      const garcom = result.rows[0];
      delete garcom.senha;
      
      const token = jwt.sign({ id: garcom.id, nome: garcom.nome, usuario: garcom.usuario, role: 'garcom' }, JWT_SECRET, { expiresIn: '7d' });
      
      // Define garçom como ONLINE para o rodízio
      const agora = new Date().toISOString();
      await query("UPDATE garcons SET is_online = ?, last_assigned_at = ? WHERE id = ?", [isPostgres ? true : 1, agora, garcom.id]);
      
      const isProd = process.env.NODE_ENV === 'production';
      res.cookie('garcom_token', token, {
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
    key: (process.env.PUSHER_APP_KEY || "5b2b284e309dea9d90fb").trim(),
    cluster: (process.env.PUSHER_CLUSTER || "sa1").trim()
  });
});

// --- ROTAS DO CARDÃPIO DIGITAL (CLIENTE) ---

// Gera um novo cÃ³digo de acesso para uma mesa (Usado pelo GarÃ§om/Admin)
app.post('/api/acesso/gerar', isAuthenticated, async (req, res) => {
  const { mesa_id } = req.body;
  console.log(`ðŸ”‘ GERAR CÃ“DIGO: Mesa ID=${mesa_id}`);
  if (!mesa_id) return res.status(400).json({ error: 'Mesa Ã© obrigatÃ³ria' });
  
  try {
    // 1. Desativa cÃ³digos anteriores desta mesa
    const resDesativa = await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [mesa_id]);
    console.log(`   - Desativados: ${resDesativa.changes}`);
    
    // 2. Gera cÃ³digo aleatÃ³rio de 4 dÃ­gitos
    const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let codigo = '';
    for (let i = 0; i < 4; i++) {
      codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
    }
    
    // 3. Insere o novo cÃ³digo
    const resInsert = await query("INSERT INTO codigos_acesso (mesa_id, codigo) VALUES (?, ?)", [mesa_id, codigo]);
    console.log(`   - Novo cÃ³digo: ${codigo} (ID: ${resInsert.lastInsertRowid})`);
    
    // 4. Marca a mesa como ocupada e associa ao garÃ§om que gerou o cÃ³digo
    const garcom_id = req.user ? (req.user.usuario || req.user.nome) : 'Sistema';
    
    const resUpdateMesa = await query("UPDATE mesas SET status = 'ocupada', garcom_id = ? WHERE id = ?", [garcom_id, mesa_id]);
    console.log(`   - Status Mesa ${mesa_id} atualizado para 'ocupada' (GarÃ§om: ${garcom_id}): ${resUpdateMesa.changes} linha(s) afetada(s)`);
    
    // Notifica via Pusher para atualizar as mesas de todos
    await safePusherTrigger('garconnexpress', 'status-atualizado', { 
      mesa_id, 
      status: 'ocupada',
      garcom_id: garcom_id,
      origem: 'codigo_gerado'
    });
    
    res.json({ success: true, codigo });
  } catch (error) {
    console.error(`âŒ ERRO AO GERAR CÃ“DIGO:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Cancela o acesso de uma mesa (Cliente desistiu ou saiu antes de pedir)
app.post('/api/acesso/cancelar', isAuthenticated, async (req, res) => {
  const { mesa_id } = req.body;
  if (!mesa_id) return res.status(400).json({ error: 'Mesa Ã© obrigatÃ³ria' });

  try {
    // 1. Invalida os cÃ³digos ativos da mesa
    await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [mesa_id]);

    // 2. Libera a mesa no sistema
    await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [mesa_id]);

    // 3. Notifica o cliente para deslogar (via Pusher)
    await safePusherTrigger('garconnexpress', `deslogar-mesa-${mesa_id}`, { 
      status: 'cancelado',
      mensagem: "Este acesso foi cancelado pelo garÃ§om." 
    });

    // 4. Notifica todos os garÃ§ons/admin para atualizar o grid de mesas
    await safePusherTrigger('garconnexpress', 'status-atualizado', { 
      mesa_id, 
      status: 'liberada',
      origem: 'acesso_cancelado'
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Acesso via QR Code (Abre a mesa automaticamente e atribui garÃ§om por rodÃ­zio)
app.post('/api/acesso/qr', async (req, res) => {
  const { mesa_id } = req.body;
  if (!mesa_id) return res.status(400).json({ error: 'Mesa Ã© obrigatÃ³ria' });

  try {
    const caixa = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
    if (!caixa) return res.status(403).json({ error: 'ESTABELECIMENTO FECHADO: O cardÃ¡pio digital sÃ³ funciona com o caixa aberto.' });

    const mesa = (await query("SELECT * FROM mesas WHERE id = ?", [mesa_id])).rows[0];
    if (!mesa) return res.status(404).json({ error: 'Mesa nÃ£o encontrada' });

    let acesso;
    if (mesa.status === 'livre') {
      // LÃ“GICA DE RODÃZIO (Round-Robin): Pega o garÃ§om online que estÃ¡ hÃ¡ mais tempo sem atender
      const proximoGarcom = (await query("SELECT id, usuario, nome FROM garcons WHERE is_online = ? ORDER BY last_assigned_at ASC LIMIT 1", [isPostgres ? true : 1])).rows[0];
      
      if (!proximoGarcom) {
        return res.status(503).json({ error: 'Nenhum garÃ§om online no momento para te atender. Por favor, chame um atendente no balcÃ£o.' });
      }

      const garcom_id = proximoGarcom.usuario;
      const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let codigo = '';
      for (let i = 0; i < 4; i++) codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));

      await query("INSERT INTO codigos_acesso (mesa_id, codigo) VALUES (?, ?)", [mesa_id, codigo]);
      await query("UPDATE mesas SET status = 'ocupada', garcom_id = ? WHERE id = ?", [garcom_id, mesa_id]);
      
      // Atualiza o timestamp para mover o garÃ§om para o fim da fila
      await query("UPDATE garcons SET last_assigned_at = ? WHERE id = ?", [new Date().toISOString(), proximoGarcom.id]);

      acesso = (await query("SELECT ca.*, m.numero as mesa_numero FROM codigos_acesso ca JOIN mesas m ON ca.mesa_id = m.id WHERE ca.mesa_id = ? AND ca.status = 'ativo' ORDER BY ca.id DESC LIMIT 1", [mesa_id])).rows[0];
      
      console.log(`ðŸ¤– [RodÃ­zio] Mesa ${mesa.numero} atribuÃ­da a: ${proximoGarcom.nome}`);
      
      await safePusherTrigger('garconnexpress', 'status-atualizado', { 
        mesa_id, 
        status: 'ocupada',
        garcom_id: garcom_id,
        origem: 'qr_code'
      });
    } else {
      // TRAVA DE SEGURANÃ‡A: Se a mesa nÃ£o estiver livre, bloqueia o novo escaneamento
      return res.status(403).json({ 
        error: 'MESA OCUPADA: Esta mesa jÃ¡ possui um atendimento em andamento. Se vocÃª jÃ¡ estava nesta mesa, use o menu anterior ou peÃ§a ajuda ao garÃ§om.' 
      });
    }

    const pedidoAtivo = (await query("SELECT id FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado') ORDER BY id DESC LIMIT 1", [mesa_id])).rows[0];

    const token = jwt.sign({ 
      mesa_id: acesso.mesa_id, 
      mesa_numero: acesso.mesa_numero, 
      acesso_id: acesso.id,
      pedido_id: pedidoAtivo ? pedidoAtivo.id : null,
      role: 'cliente' 
    }, JWT_SECRET, { expiresIn: '6h' });

    res.json({ 
      success: true,
      mesa_id: acesso.mesa_id,
      mesa_numero: acesso.mesa_numero,
      token_acesso: token
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Valida o acesso do cliente
app.post('/api/acesso/validar', async (req, res) => {
  const { codigo } = req.body;
  if (!codigo) return res.status(400).json({ error: 'CÃ³digo Ã© obrigatÃ³rio' });

  try {
    // 1. Verifica se o caixa estÃ¡ aberto
    const caixa = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
    if (!caixa) return res.status(403).json({ error: 'ESTABELECIMENTO FECHADO: O cardÃ¡pio digital sÃ³ funciona com o caixa aberto.' });

    // 2. Verifica se o cÃ³digo Ã© vÃ¡lido e ativo
    const acesso = (await query("SELECT ca.*, m.numero as mesa_numero FROM codigos_acesso ca JOIN mesas m ON ca.mesa_id = m.id WHERE UPPER(ca.codigo) = UPPER(?) AND ca.status = 'ativo'", [codigo])).rows[0];

    if (!acesso) return res.status(401).json({ error: 'CÃ³digo invÃ¡lido ou jÃ¡ expirado.' });

    // 3. VerificaÃ§Ã£o de SeguranÃ§a: A mesa estÃ¡ realmente ocupada?
    // Isso evita que cÃ³digos de sessÃµes anteriores permitam acesso a mesas jÃ¡ liberadas.
    const mesaStatus = (await query("SELECT status FROM mesas WHERE id = ?", [acesso.mesa_id])).rows[0];
    
    if (!mesaStatus || mesaStatus.status === 'livre') {
      // Se a mesa estÃ¡ livre, o cÃ³digo deve ser invalidado por seguranÃ§a (Ghost Session Prevention)
      await query("UPDATE codigos_acesso SET status = 'expirado' WHERE id = ?", [acesso.id]);
      return res.status(403).json({ error: 'ESTA MESA NÃƒO ESTÃ ATIVA: PeÃ§a ao garÃ§om para abrir sua mesa novamente.' });
    }

    // 4. Busca pedido_id se existir (opcional nesta fase)
    const pedidoAtivo = (await query("SELECT id FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado') ORDER BY id DESC LIMIT 1", [acesso.mesa_id])).rows[0];

    // 5. Gera o token de acesso (pedido_id pode ser null se for mesa recÃ©m aberta)
    const token = jwt.sign({ 
      mesa_id: acesso.mesa_id, 
      mesa_numero: acesso.mesa_numero, 
      acesso_id: acesso.id,
      pedido_id: pedidoAtivo ? pedidoAtivo.id : null,
      role: 'cliente' 
    }, JWT_SECRET, { expiresIn: '6h' });

    res.json({ 
      success: true,
      mesa_id: acesso.mesa_id,
      mesa_numero: acesso.mesa_numero,
      pedido_id: pedidoAtivo ? pedidoAtivo.id : null,
      acesso_id: acesso.id,
      token_acesso: token
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verifica se a sessÃ£o do cliente ainda Ã© vÃ¡lida (cÃ³digo ainda ativo)
app.get('/api/acesso/check', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'NÃ£o autorizado' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'cliente' || !decoded.acesso_id) {
        return res.status(403).json({ error: 'Token invÃ¡lido para esta operaÃ§Ã£o' });
    }

    const acesso = (await query("SELECT status, mesa_id FROM codigos_acesso WHERE id = ?", [decoded.acesso_id])).rows[0];
    if (!acesso || acesso.status !== 'ativo') {
        return res.json({ valid: false, error: 'Acesso expirado' });
    }

    // Verifica se a mesa ainda estÃ¡ ativa (ocupada ou em fechamento)
    const mesa = (await query("SELECT status FROM mesas WHERE id = ?", [acesso.mesa_id])).rows[0];
    if (!mesa || mesa.status === 'livre') {
        // Se a mesa foi liberada, invalida o acesso por seguranÃ§a
        await query("UPDATE codigos_acesso SET status = 'expirado' WHERE id = ?", [decoded.acesso_id]);
        return res.json({ valid: false, error: 'Mesa liberada' });
    }

    res.json({ valid: true });
  } catch (err) {
    res.status(401).json({ error: 'SessÃ£o expirada' });
  }
});
// Cliente solicita atendimento do garÃ§om
app.post('/api/cliente/chamar-garcom', async (req, res) => {
  const { mesa_id, mesa_numero } = req.body;
  try {
    await safePusherTrigger('garconnexpress', 'chamado-garcom', {
      mesa_id,
      mesa_numero,
      mensagem: `ðŸ›Žï¸ MESA ${mesa_numero} solicitou atendimento!`
    });
    
    // Notifica via WhatsApp tambÃ©m se configurado
    sendWhatsAppMessage(`ðŸ›Žï¸ *CHAMADO DE MESA*\nðŸ“ Mesa: ${mesa_numero}\nðŸ™‹â€â™‚ï¸ O cliente solicitou atendimento imediato.`).catch(e => console.error('Erro Wpp Chamado:', e.message));
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cliente envia rascunho do pedido (prÃ©-seleÃ§Ã£o)
app.post('/api/cliente/enviar-rascunho', async (req, res) => {
  const { mesa_id, mesa_numero, itens } = req.body;
  try {
    const itensFormatados = itens.map(i => `${i.quantidade}x ${i.nome}`).join('\n');
    const msg = `ðŸ“ RASCUNHO RECEBIDO - MESA ${mesa_numero}\n${itensFormatados}`;
    
    await safePusherTrigger('garconnexpress', 'rascunho-recebido', {
      mesa_id,
      mesa_numero,
      itens,
      mensagem: msg
    });
    
    // Notifica via WhatsApp tambÃ©m
    sendWhatsAppMessage(`ðŸ“ *RASCUNHO DE PEDIDO*\nðŸ“ Mesa: ${mesa_numero}\n\n${itensFormatados}\n\nâš ï¸ _Aguardando confirmaÃ§Ã£o do garÃ§om._`).catch(e => console.error('Erro Wpp Rascunho:', e.message));
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/whatsapp-status', async (req, res) => {
  try {
    const configRes = await query("SELECT valor FROM sistema_config WHERE chave = 'whatsapp_enabled'");
    const isEnabled = configRes.rows && configRes.rows.length > 0 ? configRes.rows[0].valor === 'true' : true;

    // Busca a lista de nÃºmeros no banco de dados (chave correta: plural)
    const configNums = await query("SELECT valor FROM sistema_config WHERE chave = 'whatsapp_notify_numbers'");
    let numbersDisplay = 'NÃ£o configurado';
    
    if (configNums.rows && configNums.rows.length > 0 && configNums.rows[0].valor) {
      numbersDisplay = configNums.rows[0].valor;
    } else if (process.env.WHATSAPP_NOTIFY_NUMBER) {
      numbersDisplay = process.env.WHATSAPP_NOTIFY_NUMBER;
    }

    res.json({
      configured: !!process.env.WHATSAPP_BOT_URL,
      connected: whatsappSocket ? whatsappSocket.connected : false,
      enabled: isEnabled,
      number: numbersDisplay,
      botUrl: process.env.WHATSAPP_BOT_URL || ''
    });
  } catch (error) {
    console.error('âŒ Erro ao buscar status do WhatsApp:', error.message);
    // Retorna um objeto vÃ¡lido em vez de 500 para evitar o selo de ERRO no frontend
    res.json({
      configured: !!process.env.WHATSAPP_BOT_URL,
      connected: false,
      enabled: false,
      number: 'Erro ao carregar',
      botUrl: process.env.WHATSAPP_BOT_URL || '',
      error: error.message
    });
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
    if (isPostgres) {
      await query("INSERT INTO sistema_config (chave, valor) VALUES ('categorias_cozinha', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [valor]);
    } else {
      await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('categorias_cozinha', ?)", [valor]);
    }
    
    // SINCRONIZAÃ‡ÃƒO COMPLETA: 
    // Define todos os itens como NULL para que passem a seguir a nova regra de categorias global.
    // Isso garante que o "Salvar" da configuraÃ§Ã£o realmente aplique a mudanÃ§a em todo o cardÃ¡pio.
    // MarcaÃ§Ãµes manuais anteriores serÃ£o resetadas para seguir a nova configuraÃ§Ã£o global.
    await query(`UPDATE menu SET enviar_cozinha = NULL`);

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
        PUSHER_CLUSTER: process.env.PUSHER_CLUSTER || 'nÃ£o definido',
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

// Endpoint para forÃ§ar inicializaÃ§Ã£o do DB (Ãºtil se as tabelas nÃ£o existirem)
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
