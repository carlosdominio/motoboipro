const express = require('express');
// v1.0.1 - Deploy forçado para ativação do menu bot
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
const webpush = require('web-push');
const admin = require('firebase-admin');

// --- Configuração VAPID (Web Push - Navegador) ---
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BMyiv6uhCaW8LUu4EsraMpa-aiSYPEScoustJawyZDCgW0JmT9_UH4cQipSyEY5RZVNQuNvEu7cfNfumLAn_0i8';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'E4g3M62wJcFlgy8IeJzB_VlKE6fkfvTqETIall5pce4';

webpush.setVapidDetails(
  'mailto:contato@garconnexpress.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// --- Configuração Firebase Admin (App Nativo Android/iOS) ---
let firebaseGarcomApp = null;
let firebaseMotoboyApp = null;

try {
  let serviceAccountGarcom;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccountGarcom = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    try {
      serviceAccountGarcom = require('./firebase-adminsdk.json');
    } catch (e) { console.log('⚠️ Arquivo firebase-adminsdk.json não encontrado.'); }
  }

  if (serviceAccountGarcom) {
    firebaseGarcomApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccountGarcom)
    }, 'garcom');
    console.log('✅ Firebase Admin (Garçom) pronto.');
  }
} catch (error) {
  console.log('⚠️ Erro ao configurar Firebase Garçom:', error.message);
}

try {
  let serviceAccountMotoboy;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_MOTOBOY) {
    serviceAccountMotoboy = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_MOTOBOY);
  } else {
    try {
      serviceAccountMotoboy = require('./firebase-motoboy-adminsdk.json');
    } catch (e) { /* ignore */ }
  }

  if (serviceAccountMotoboy) {
    firebaseMotoboyApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccountMotoboy)
    }, 'motoboy');
    console.log('✅ Firebase Admin (Motoboy) pronto.');
  }
} catch (error) {
  console.log('⚠️ Erro ao configurar Firebase Motoboy:', error.message);
}

// Configuração de ambiente
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();

// Middleware manual para garantir que OPTIONS responda sempre com sucesso e headers corretos
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With, Accept, Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());
app.use(cookieParser());

// --- CONFIGURAÇÕES DE DELIVERY (CONTROLE INDEPENDENTE) ---
app.get('/api/configs/delivery-status', ensureDbInitialized, async (req, res) => {
  try {
    const result = await query("SELECT valor FROM sistema_config WHERE chave = 'delivery_aberto'");
    const status = result.rows && result.rows.length > 0 ? result.rows[0].valor === 'true' : true;
    res.json({ delivery_aberto: status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/configs/delivery-toggle', ensureDbInitialized, isAdmin, async (req, res) => {
  const { enabled } = req.body;
  try {
    const valor = enabled ? 'true' : 'false';
    if (isPostgres) {
      await query("INSERT INTO sistema_config (chave, valor) VALUES ('delivery_aberto', ?) ON CONFLICT(chave) DO UPDATE SET valor = EXCLUDED.valor", [valor]);
    } else {
      await query("INSERT OR REPLACE INTO sistema_config (chave, valor) VALUES ('delivery_aberto', ?)", [valor]);
    }
    
    await safePusherTrigger('garconnexpress', 'delivery-status-atualizado', { delivery_aberto: enabled });
    res.json({ success: true, delivery_aberto: enabled });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// INTEGRAÇÃO WHATSAPP (BOT EXTERNO)
const DEFAULT_BOT_URL = 'https://meu-zap-bot.onrender.com/';
const botUrlFinal = process.env.WHATSAPP_BOT_URL || DEFAULT_BOT_URL;

let whatsappSocket = null;
const clientesEmAtendimento = new Map(); // Armazena { numero: timestamp } - ESCOPO GLOBAL

if (botUrlFinal) {
  whatsappSocket = ioClient(botUrlFinal, {
    reconnection: true,
    reconnectionAttempts: Infinity
  });

  whatsappSocket.on('new_msg', async (data) => {
    try {
      if (!data || !data.from || !data.body || data.fromMe) return;
      
      const from = data.from.split('@')[0].replace(/\D/g, '');
      const msg = data.body.trim();

      // APENAS VINCULA O CLIENTE AO CACHE, SEM FORÇAR O MODO HUMANO
      // Deixamos o Robô enviar o menu automático primeiro.
      if (msg.includes('🛍️ *NOVO PEDIDO - DELIVERY*') || msg.includes('🛵 DELIVERY')) {
        clientesEmAtendimento.set(from, Date.now() + (4 * 60 * 60 * 1000));
        console.log(`📦 [Server] Pedido detectado para ${from}. Mantendo modo automático do Robô.`);
      }
    } catch (err) {
      console.error('⚠️ Erro ao sincronizar status do WhatsApp:', err.message);
    }
  });
}

// Cache simples para configurações
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
  console.log(`🔎 [WhatsApp] Tentando disparar notificação: "${text.substring(0, 50)}..."`);
  try {
    if (!await isWhatsAppEnabled()) {
      console.log('🚫 [WhatsApp] Automação desativada nas configurações do sistema');
      return;
    }

    let numbersList = [];
    
    if (targetNumber) {
      // Se um número específico foi passado (ex: resposta ao cliente), usa ele
      numbersList = [targetNumber];
    } else {
      // Caso contrário, busca a lista de números de notificação no banco/env
      const configNums = await query("SELECT valor FROM sistema_config WHERE chave = 'whatsapp_notify_numbers'");
      if (configNums.rows && configNums.rows.length > 0 && configNums.rows[0].valor) {
        numbersList = configNums.rows[0].valor.split(',').map(n => n.trim());
      } else if (process.env.WHATSAPP_NOTIFY_NUMBER) {
        numbersList = [process.env.WHATSAPP_NOTIFY_NUMBER];
      }
    }

    if (whatsappSocket && whatsappSocket.connected && numbersList.length > 0) {
      // Remove duplicados e limpa os números
      const uniqueNumbers = [...new Set(numbersList.map(n => n.replace(/\D/g, '')))];
      console.log(`📤 [WhatsApp] Bot CONECTADO. Enviando para: ${uniqueNumbers.join(', ')}`);

      uniqueNumbers.forEach(num => {
        // Envia para o bot usando apenas os dígitos (formato que funcionou nos testes)
        // O bot cuidará do roteamento interno.
        whatsappSocket.emit('send_msg', { number: num, text: text });
      });
    } else {
      console.log('⚠️ [WhatsApp] FALHA NO ENVIO: Bot desconectado ou lista de números vazia.');
      console.log(`   - Socket conectado: ${whatsappSocket ? whatsappSocket.connected : 'null'}`);
      console.log(`   - Números encontrados: ${numbersList.length}`);
    }
  } catch (e) {
    console.error('❌ Erro interno ao enviar WhatsApp:', e.message);
  }
}

// Log global de todas as requisições
app.use((req, res, next) => {
  console.log(`📡 [${new Date().toLocaleTimeString()}] ${req.method} ${req.url} - Origin: ${req.headers.origin}`);
  next();
});

const JWT_SECRET = process.env.JWT_SECRET || 'seusegredomuitolouco123';
const saltRounds = 10;

// INICIALIZAÇÃO DO PUSHER (Com as novas chaves do usuário)
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
      max: 10, // Aumentado para lidar com múltiplas requisições simultâneas em Serverless
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000, // Timeout rápido para falhar e dar retry se necessário
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
    console.log(`📡 [Pusher] Enviando: Canal=${channel}, Evento=${event}`);
    // No Vercel, precisamos de uma confirmação real do envio
    await pusher.trigger(channel, event, data);
    console.log(`✅ [Pusher] Sucesso: ${event}`);
    
    // --- WEB PUSH NATIVO (BACKGROUND) E FCM (NATIVO ANDROID/IOS) ---
    // Dispara notificação nativa para todos os garçons inscritos quando houver eventos cruciais
    const eventsToPush = ['novo-pedido', 'pedido-cancelado', 'chamado-garcom', 'pedido-pronto', 'rascunho-recebido', 'solicitacao-fechamento-cliente', 'status-atualizado'];
    if (eventsToPush.includes(event)) {
      try {
        const subs = (await query("SELECT * FROM push_subscriptions")).rows;
        let pushMsg = '';
        const mesaNum = data.mesa_numero || (data.pedido ? data.pedido.mesa_numero : 'BALCÃO');
        
        if (event === 'novo-pedido') pushMsg = `🚀 NOVO PEDIDO: ${mesaNum}`;
        else if (event === 'pedido-cancelado') pushMsg = `❌ CANCELADO: ${mesaNum}`;
        else if (event === 'chamado-garcom') pushMsg = `🛎️ CHAMADO: ${mesaNum}`;
        else if (event === 'pedido-pronto') pushMsg = `🍳 PRONTO: ${mesaNum}`;
        else if (event === 'rascunho-recebido') pushMsg = `📝 RASCUNHO: ${mesaNum}`;
        else if (event === 'solicitacao-fechamento-cliente') pushMsg = `💰 FECHAMENTO: ${mesaNum}`;
        else if (event === 'status-atualizado') {
           if (data.status === 'servido' || data.status === 'entregue') pushMsg = `✅ ENTREGUE: ${mesaNum}`;
           else if (data.status === 'saiu_entrega') pushMsg = `🛵 SAIU ENTREGA: ${mesaNum}`;
           else return true; 
        }
        else pushMsg = `Notificação: ${event}`;
        
        const payload = JSON.stringify({ title: 'GarçomExpress', body: pushMsg, event });
        
        // Deduplicação de tokens para evitar envios repetidos ao mesmo aparelho
        const uniqueSubs = [];
        const seenTokens = new Set();
        for (const s of subs) {
          if (!seenTokens.has(s.endpoint)) {
            seenTokens.add(s.endpoint);
            uniqueSubs.push(s);
          }
        }

        for (const sub of uniqueSubs) {
          const isMotoboy = sub.garcom_id === 'DELIVERY';
          
          // Filtro robusto para identificar se o evento é de Delivery
          const isDeliveryEvent = 
            (data.garcom_id === 'DELIVERY') || 
            (data.pedido && data.pedido.garcom_id === 'DELIVERY') ||
            (mesaNum && String(mesaNum).toUpperCase().includes('DELIVERY'));
            
          if (event === 'pedido-cancelado') {
             console.log(`[DEBUG-PUSH] Evento: cancelado | isMotoboy: ${isMotoboy} | isDeliveryEvent: ${isDeliveryEvent} | data.garcom_id: ${data.garcom_id} | mesaNum: ${mesaNum}`);
          }
          
          if (isMotoboy && !isDeliveryEvent) {
             if (event === 'pedido-cancelado') console.log(`[DEBUG-PUSH] 🚫 Ignorado Motoboy (Não é evento de delivery)`);
             continue;
          }
          if (!isMotoboy && isDeliveryEvent) {
             if (event === 'pedido-cancelado') console.log(`[DEBUG-PUSH] 🚫 Ignorado Garçom (É evento de delivery)`);
             continue; 
          }

          if (sub.endpoint.includes('fcm.googleapis.com') || sub.endpoint.startsWith('https://')) {
             // ... [Web Push remains same] ...
          } else {
             // Tratamento para Token Nativo (Capacitor/Firebase SDK)
             const firebaseAppToUse = isMotoboy ? firebaseMotoboyApp : firebaseGarcomApp;

             if (firebaseAppToUse) {
               const message = {
                 notification: {
                   title: 'GarçomExpress',
                   body: pushMsg
                 },
                 data: {
                   event: event,
                   sound: 'notificacao',
                   title: 'GarçomExpress',
                   body: pushMsg
                 },
                 android: {
                   priority: 'high',
                   notification: {
                     sound: 'notificacao',
                     channelId: 'pedidos',
                     defaultSound: false,
                     clickAction: 'FCM_PLUGIN_ACTIVITY'
                   }
                 },
                 apns: {
                   payload: {
                     aps: {
                       sound: 'notificacao.caf',
                       badge: 1
                     }
                   }
                 },
                 token: sub.endpoint
               };
               
               firebaseAppToUse.messaging().send(message)
                 .then((response) => {
                   console.log(`✅ FCM Nativo (${isMotoboy ? 'Motoboy' : 'Garçom'}) enviado com sucesso:`, response);
                 })
                 .catch(async (error) => {
                   console.error(`❌ Erro enviando FCM Nativo (${isMotoboy ? 'Motoboy' : 'Garçom'}):`, error);
                   // Remove tokens inválidos
                   if (error.code === 'messaging/invalid-registration-token' || error.code === 'messaging/registration-token-not-registered') {
                      console.log('🗑️ Removendo token FCM inativo:', sub.endpoint);
                      await query("DELETE FROM push_subscriptions WHERE id = ?", [sub.id]);
                   }
                 });
             }
          }
        }
      } catch (err) {
        console.error('Erro ao buscar subscriptions:', err.message);
      }
    }
    
    return true;
  } catch (e) {
    console.error(`❌ [Pusher] Falha (${event}):`, e.message);
    return false;
  }
}

// --- ROTAS WEB PUSH ---
app.get('/api/vapid-publicKey', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post('/api/subscribe', isAuthenticated, async (req, res) => {
  const subscription = req.body;
  const garcomId = req.user.id || req.user.usuario; // Depende de como está no token
  try {
    // Tenta encontrar se a inscrição já existe
    const exists = await query("SELECT id FROM push_subscriptions WHERE endpoint = ?", [subscription.endpoint]);
    if (exists.rows.length === 0) {
      await query("INSERT INTO push_subscriptions (garcom_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)",
        [garcomId, subscription.endpoint, subscription.keys?.p256dh || '', subscription.keys?.auth || '']);
    }
    res.status(201).json({ success: true });
  } catch (error) {
    console.error("Erro ao salvar inscrição push:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/subscribe-motoboy', async (req, res) => {
  const subscription = req.body;
  const garcomId = 'DELIVERY';
  try {
    // Inscrição para Motoboy (Pode ser Token FCM direto do Capacitor ou WebPush)
    const exists = await query("SELECT id FROM push_subscriptions WHERE endpoint = ?", [subscription.endpoint]);
    if (exists.rows.length === 0) {
      await query("INSERT INTO push_subscriptions (garcom_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)",
        [garcomId, subscription.endpoint, subscription.keys?.p256dh || '', subscription.keys?.auth || '']);
      console.log('✅ Novo dispositivo Motoboy inscrito para Push:', subscription.endpoint);
    }
    res.status(201).json({ success: true });
  } catch (error) {
    console.error("Erro ao salvar inscrição push motoboy:", error);
    res.status(500).json({ error: error.message });
  }
});

async function verificarEstoqueBaixo(menuId) {
  try {
    const item = (await query("SELECT id, nome, estoque FROM menu WHERE id = ?", [menuId])).rows[0];
    if (item && item.estoque !== -1 && item.estoque <= 5) {
      console.log(`⚠️ [Estoque] Baixo: ${item.nome} (${item.estoque})`);
      await safePusherTrigger('garconnexpress', 'estoque-baixo', {
        id: item.id,
        nome: item.nome,
        estoque: item.estoque,
        mensagem: `⚠️ ESTOQUE BAIXO: ${item.nome} restam apenas ${item.estoque} un.`
      });
    }
  } catch (e) {
    console.error("Erro ao verificar estoque baixo:", e);
  }
}

async function notifyStatus(pedidoId, mesaDbId, status, mesaNumPredefined = null) {
  try {
    let mesaNum = mesaNumPredefined;
    let finalMesaId = mesaDbId;
    let garcomId = null;

    // Prioridade: Se temos o ID do pedido, buscamos os dados reais para evitar rotular Delivery como Balcão
    if (pedidoId) {
      const res = await query("SELECT m.id as mesa_id, m.numero as mesa_numero, p.garcom_id FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [pedidoId]);
      if (res.rows[0]) {
        garcomId = res.rows[0].garcom_id;
        finalMesaId = finalMesaId || res.rows[0].mesa_id;
        
        if (garcomId === 'DELIVERY') {
          mesaNum = `DELIVERY #${pedidoId}`;
        } else if (!mesaNum) {
          mesaNum = res.rows[0].mesa_numero ? `Mesa ${res.rows[0].mesa_numero}` : 'BALCÃO';
        }
      }
    }

    // Caso não tenha pedidoId ou a busca falhou, tenta buscar pela mesaDbId
    if (!mesaNum && finalMesaId) {
      const res = await query("SELECT numero FROM mesas WHERE id = ?", [finalMesaId]);
      mesaNum = res.rows[0] ? `Mesa ${res.rows[0].numero}` : 'BALCÃO';
    }

    // Fallback final
    if (!mesaNum) mesaNum = 'BALCÃO';
    
    const payload = { pedido_id: pedidoId, mesa_id: finalMesaId, mesa_numero: mesaNum, status: status, garcom_id: garcomId };
    console.log(`🔔 [Notificação] ${status.toUpperCase()}: ${mesaNum} (ID Pedido: ${pedidoId || 'N/A'})`);

    // Dispara Pusher IMEDIATAMENTE (Prioridade)
    await safePusherTrigger('garconnexpress', 'status-atualizado', payload);

    const statusMessages = {
      recebido: '✅ *PEDIDO RECEBIDO!*\n\nOlá! Seu pedido *#{pedidoId}* foi recebido com sucesso!',
      preparando: '🍳 *PREPARANDO SEU PEDIDO*\n\nSeu pedido *#{pedidoId}* já está sendo preparado pela nossa cozinha!',
      aguardando_fechamento: '🛎️ *FECHAMENTO SOLICITADO*\n\nOlá! Seu pedido *#{pedidoId}* foi finalizado e está aguardando pagamento.',
      pronto: '✅ *PEDIDO PRONTO!*\n\nOlá! Seu pedido *#{pedidoId}* já está pronto!',
      servido: '📝 *PEDIDO SERVIDO!*\n\nOlá! Seu pedido *#{pedidoId}* foi marcado como servido.',
      saiu_entrega: '🛵 *SAIU PARA ENTREGA!*\n\nBoa notícia! Seu pedido *#{pedidoId}* saiu para entrega agora mesmo!',
      entregue: '✅ *PEDIDO CONCLUÍDO!*\n\nOlá! Seu pedido *#{pedidoId}* foi finalizado com sucesso. Obrigado pela preferência!',
      cancelado: '❌ *PEDIDO CANCELADO*\n\nOlá! Seu pedido *#{pedidoId}* foi cancelado pelo estabelecimento.'
    };

    // NOTIFICAÇÃO PROATIVA VIA WHATSAPP PARA QUALQUER PEDIDO COM TELEFONE CADASTRADO
    if (pedidoId) {
       try {
         const pData = (await query("SELECT cliente_telefone, garcom_id FROM pedidos WHERE id = ?", [pedidoId])).rows[0];
         const clienteTelefone = (pData && pData.cliente_telefone) ? pData.cliente_telefone.trim() : null;
         
         if (clienteTelefone) {
           let statusBot = status;
           // Mapeia 'servido' para 'saiu_entrega' se for DELIVERY
           if (status === 'servido' && pData.garcom_id === 'DELIVERY') {
             statusBot = 'saiu_entrega';
           }

           const mensagem = (statusMessages[statusBot] || `📊 Status do pedido *#{pedidoId}*: ${statusBot}`).replace('#{pedidoId}', pedidoId);
           console.log(`📡 [Notificação Proativa] Enviando status '${statusBot}' para ${clienteTelefone}`);
           notifyDeliveryStatusToBot(clienteTelefone, statusBot, pedidoId, null, mensagem).catch(console.error);
         }
       } catch (e) { console.error('Erro notificação cliente:', e.message); }
    }

    // Notificação WhatsApp em paralelo/background para o ADMIN
    if (status === 'aguardando_fechamento') {
      sendWhatsAppMessage(`🛎️ *SOLICITAÇÃO DE FECHAMENTO*\n📍 Local: ${mesaNum}\n💰 O cliente solicitou a conta.`).catch(e => console.error('Erro Wpp:', e.message));
    } else if (status === 'cancelado') {
      sendWhatsAppMessage(`❌ *PEDIDO CANCELADO*\n📍 Local: ${mesaNum}\n🗑️ O pedido foi removido do sistema.`).catch(e => console.error('Erro Wpp:', e.message));
    }

  } catch (e) { console.error('Erro ao notificar status:', e.message); }
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
    `CREATE TABLE IF NOT EXISTS push_subscriptions (id SERIAL PRIMARY KEY, garcom_id TEXT, endpoint TEXT, p256dh TEXT, auth TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido_id ON pedido_itens(pedido_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pedidos_mesa_id ON pedidos(mesa_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status)`
  ];
  
  // Executa queries sequencialmente para evitar sobrecarga de conexões
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
    await query("INSERT INTO sistema_config (chave, valor) SELECT 'delivery_aberto', 'true' WHERE NOT EXISTS (SELECT 1 FROM sistema_config WHERE chave = 'delivery_aberto')");

    // LIMPEZA E REGISTRO DO NÃšMERO DE WHATSAPP (CONSOLIDADO)
    const notificationNumbers = '558293157048'; 
    try {
      // Remove a chave antiga (singular) se existir para evitar confusão
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
          // Verifica se a coluna já existe no SQLite antes de adicionar
          const info = db.prepare(`PRAGMA table_info(${t})`).all();
          if (!info.some(col => col.name === c)) {
            db.prepare(`ALTER TABLE ${t} ADD COLUMN ${c} ${type}`).run();
          }
        }
      } catch (e) {
        console.warn(`Aviso ao adicionar coluna ${c} em ${t}:`, e.message);
      } 
    };
    
    // Migrações garantidas para todos os bancos
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
    await addCol('pedidos', 'cliente_telefone', 'TEXT');
    await addCol('pedidos', 'pagamentos_detalhados', 'TEXT');
    
    // Garante que a tabela pagamentos tenha as colunas necessárias
    await addCol('pagamentos', 'recebido', 'REAL DEFAULT 0');
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
let dbInitializationPromise = null;

// Função para inicializar banco de forma lazy
async function lazyInitDb() {
  if (dbInitialized) return true;
  if (dbInitializationPromise) return dbInitializationPromise;

  dbInitializationPromise = (async () => {
    try {
      console.log('🔄 Inicializando banco de dados (lazy)...');
      await retryWithDelay(async () => {
        if (isPostgres) await db.query('SELECT 1');
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
      dbInitializationPromise = null; // Permite tentar novamente em próxima requisição
      return false;
    }
  })();

  return dbInitializationPromise;
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
  console.log('â³ Inicialização do banco adiada (lazy loading)');
}

// --- CONFIGURAÇÕES DE DELIVERY (CONTROLE INDEPENDENTE) ---
// --- DELIVERY CLEANUP ---

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
app.get('/motoboy', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'motoboy', 'index.html')));
app.get('/delivery', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'delivery', 'index.html')));
app.get('/cardapio', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'cardapio', 'index.html')));

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

// Pausar/Retomar atendimento (Rodízio)
app.post('/api/garcom/pausar', isAuthenticated, async (req, res) => {
  const { pausado } = req.body;
  if (req.user.role !== 'garcom') return res.status(403).json({ error: 'Apenas garçons podem pausar atendimento.' });

  try {
    const isOnline = pausado ? (isPostgres ? false : 0) : (isPostgres ? true : 1);
    await query("UPDATE garcons SET is_online = ? WHERE id = ?", [isOnline, req.user.id]);
    
    console.log(`👤 Garçom ${req.user.usuario} agora está ${pausado ? 'PAUSADO' : 'DISPONÍVEL'}.`);
    
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

// Admin força pausa/disponibilidade do garçom
app.post('/api/admin/garcons/:id/toggle-status', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const garcom = (await query("SELECT id, is_online FROM garcons WHERE id = ?", [id])).rows[0];
    if (!garcom) return res.status(404).json({ error: 'Garçom não encontrado' });

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

// Helper para verificar se uma lista de IDs de menu contém itens para a cozinha (JS)
async function checkTemItemCozinha(itensIds) {
  const configK = await query("SELECT valor FROM sistema_config WHERE chave = 'categorias_cozinha'");
  const catsCozinha = configK.rows[0]?.valor ? JSON.parse(configK.rows[0].valor).map(c => c.trim().toUpperCase()) : [];
  
  for (const menuId of itensIds) {
    const m = (await query("SELECT enviar_cozinha, categoria FROM menu WHERE id = ?", [menuId])).rows[0];
    if (m) {
      const envCozinha = m.enviar_cozinha;
      const categoria = (m.categoria || '').trim().toUpperCase();
      
      // Lógica consistente com getFilterCozinha (Prioridade):
      // 1. Override manual (0 ou 1) ganha sempre.
      // 2. Se nulo ou não definido, segue a categoria.
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

async function notifyDeliveryStatusToBot(number, status, pedidoId, tempo = null, mensagem = null) {
  if (!botUrlFinal) return;
  try {
    const botUrl = botUrlFinal.endsWith('/') ? botUrlFinal : `${botUrlFinal}/`;
    await fetch(`${botUrl}api/notify-delivery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, status, pedidoId, tempo, mensagem })
    });
    console.log(`✅ [Notificação Bot] Status '${status}' enviado para ${number}`);
  } catch (e) {
    console.error(`❌ Erro ao notificar bot sobre status delivery:`, e.message);
  }
}

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
    const pedido = (await query("SELECT p.garcom_id, p.cliente_telefone, m.numero as mesa_numero FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [id])).rows[0];
    let mesaExibicao = 'BALCÃO';
    if (pedido) {
      if (pedido.garcom_id === 'DELIVERY') mesaExibicao = `DELIVERY #${id}`;
      else mesaExibicao = pedido.mesa_numero ? `Mesa ${pedido.mesa_numero}` : 'BALCÃO';
    }
    
    await safePusherTrigger('garconnexpress', 'pedido-pronto', { 
      pedido_id: id, 
      mesa_numero: mesaExibicao,
      garcom_id: pedido ? pedido.garcom_id : null,
      mensagem: `🍳 Pedido ${mesaExibicao} está pronto!` 
    });

    await notifyStatus(id, null, 'pronto');
    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Helper para gerar a cláusula WHERE de itens da cozinha de forma consistente
async function getFilterCozinha() {
  const config = await query("SELECT valor FROM sistema_config WHERE chave = 'categorias_cozinha'");
  const categoriasCozinha = config.rows[0]?.valor ? JSON.parse(config.rows[0].valor) : [];
  
  const sqlTrue = isPostgres ? 'TRUE' : '1';
  const sqlFalse = isPostgres ? 'FALSE' : '0';

  // Lógica de Prioridade (Três Estados):
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
    // O que for NULL não vai (pois não tem categoria habilitada).
    return `m.enviar_cozinha = ${sqlTrue}`;
  }
}

app.put('/api/pedidos/:id/marcar-entregue', async (req, res) => {
  const { id } = req.params;
  const { apenasProntos } = req.body;
  try {
    const filterCozinha = await getFilterCozinha();

    if (apenasProntos) {
      // Marca como entregue apenas os itens que já estão PRONTOS ou que NÃO vão para a cozinha (bebidas etc)
      // Note que invertemos a lógica do filtro para pegar o que NÃO é cozinha
      await query(`
        UPDATE pedido_itens 
        SET status = 'entregue' 
        WHERE pedido_id = ? 
        AND (status = 'pronto' OR (status = 'pendente' AND menu_id IN (SELECT id FROM menu m WHERE NOT (${filterCozinha}))))
      `, [id]);
    } else {
      // BLOQUEIO SERVER-SIDE: Verifica se há itens SENDO FEITOS na cozinha
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
          mensagem: `Não é possível entregar tudo! Existem ${prep.rows.length} itens ainda em preparo na cozinha.` 
        });
      }

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
  } catch (error) { 
    console.error('Erro ao marcar entregue:', error);
    res.status(500).json({ error: error.message }); 
  }
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
      // Apenas marca como entregue (OU PRONTO? A função chama /pronto mas o código original marca como entregue?)
      // Na verdade, cozinha marca como pronto, garçom marca como entregue.
      // Vou manter a lógica de marcar como entregue se for essa a intenção da rota original
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
    if (aberto.rows.length > 0) return res.status(400).json({ error: 'Já existe um caixa aberto' });
    const agora = new Date();
    const dataLocal = agora.getFullYear() + '-' + String(agora.getMonth() + 1).padStart(2, '0') + '-' + String(agora.getDate()).padStart(2, '0') + ' ' + String(agora.getHours()).padStart(2, '0') + ':' + String(agora.getMinutes()).padStart(2, '0') + ':' + String(agora.getSeconds()).padStart(2, '0');
    await query("INSERT INTO fluxo_caixa (valor_inicial, status, data_abertura) VALUES (?, 'aberto', ?)", [valor_inicial || 0, dataLocal]);
    await safePusherTrigger('garconnexpress', 'status-caixa-atualizado', { status: 'aberto' });
    
    // Notificação WhatsApp
    sendWhatsAppMessage(`💰 *CAIXA ABERTO*\n🕒 Horário: ${new Date().toLocaleTimeString()}\n💵 Valor Inicial: R$ ${Number(valor_inicial || 0).toFixed(2)}`).catch(e => console.error('Erro Wpp:', e.message));

    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Erro ao abrir caixa' }); }
});

app.post('/api/caixa/fechar', async (req, res) => {
  const { valor_final, id } = req.body;
  try {
    const pedidosAtivos = await query("SELECT id FROM pedidos WHERE status NOT IN ('entregue', 'cancelado')");
    if (pedidosAtivos.rows.length > 0) return res.status(400).json({ error: 'Existem pedidos pendentes.' });
    
    // Busca dados do caixa antes de fechar para o relatório do WhatsApp
    const dadosCaixa = (await query("SELECT * FROM fluxo_caixa WHERE id = ?", [id])).rows[0];

    const agora = new Date();
    const dataLocal = agora.getFullYear() + '-' + String(agora.getMonth() + 1).padStart(2, '0') + '-' + String(agora.getDate()).padStart(2, '0') + ' ' + String(agora.getHours()).padStart(2, '0') + ':' + String(agora.getMinutes()).padStart(2, '0') + ':' + String(agora.getSeconds()).padStart(2, '0');
    await query("UPDATE fluxo_caixa SET valor_final = ?, status = 'fechado', data_fechamento = ? WHERE id = ?", [valor_final, dataLocal, id]);

    // Expira todos os códigos de acesso ativos ao fechar o caixa
    await query("UPDATE codigos_acesso SET status = 'expirado' WHERE status = 'ativo'");

    await safePusherTrigger('garconnexpress', 'status-caixa-atualizado', { status: 'fechado' });

    // Notificação WhatsApp detalhada
    if (dadosCaixa) {
      const msgWpp = `💰 *CAIXA FECHADO*\n🕒 Horário: ${new Date().toLocaleTimeString()}\n\n` +
                     `📊 *RESUMO DO DIA:*\n` +
                     `💵 Dinheiro: R$ ${Number(dadosCaixa.total_dinheiro || 0).toFixed(2)}\n` +
                     `💳 Cartão: R$ ${Number(dadosCaixa.total_cartao || 0).toFixed(2)}\n` +
                     `📱 Pix: R$ ${Number(dadosCaixa.total_pix || 0).toFixed(2)}\n` +
                     `📈 Total Vendas: R$ ${Number(dadosCaixa.total_vendas || 0).toFixed(2)}\n` +
                     `🏁 Valor Final: R$ ${Number(valor_final || 0).toFixed(2)}`;
      sendWhatsAppMessage(msgWpp).catch(e => console.error('Erro Wpp:', e.message));
    }

    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Erro ao fechar caixa' }); }
});

// --- CONFIGURAÇÕES DE DELIVERY (CONTROLE INDEPENDENTE) ---
// --- LIMPANDO DELIVERY ---

app.get('/api/pedidos/ativos-detalhado', ensureDbInitialized, async (req, res) => {
  try {
    const pedidosRes = await query(`
      SELECT p.*, m.numero as mesa_numero, g.nome as garcom_nome 
      FROM pedidos p 
      LEFT JOIN mesas m ON p.mesa_id = m.id
      LEFT JOIN garcons g ON p.garcom_id = g.usuario
      WHERE p.status NOT IN ('entregue', 'cancelado', 'rascunho')
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
    
    // Lógica super restrita: SÃ“ mostra o que for recebido ou aguardando fechamento
    // Isso exclui automaticamente cancelados, entregues, prontos, etc.
    let whereClause = `LOWER(pi.status) = 'pendente' AND LOWER(p.status) IN ('recebido', 'aguardando_fechamento', 'pronto')`;

    console.log(`🔎 [Cozinha] Filtro SQL: ${filterCozinha}`);

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
        p.garcom_id,
        mes.numero as mesa_numero
        FROM pedido_itens pi
      JOIN menu m ON pi.menu_id = m.id 
      JOIN pedidos p ON pi.pedido_id = p.id 
      LEFT JOIN mesas mes ON p.mesa_id = mes.id 
      WHERE (${whereClause}) AND ${filterCozinha}
      ORDER BY p.created_at ASC
    `);
    
    if (result.rows.length > 0) {
      console.log(`👨‍🍳 [Cozinha] Enviando ${result.rows.length} itens. IDs de pedidos:`, [...new Set(result.rows.map(r => r.pedido_id))]);
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
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pedidos/:id/itens', ensureDbInitialized, async (req, res) => { 
  try {
    const result = await query(`SELECT pi.*, m.nome, m.preco, m.categoria, m.enviar_cozinha, m.imagem FROM pedido_itens pi JOIN menu m ON pi.menu_id = m.id WHERE pi.pedido_id = ? ORDER BY pi.status DESC, pi.id ASC`, [req.params.id]);
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
    if (!item) return res.status(404).json({ error: 'Item não encontrado' });
    await query("UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque + ? END WHERE id = ?", [item.quantidade, item.menu_id]);
    await query("DELETE FROM pedido_itens WHERE id = ?", [id]);
    const itensRestantes = (await query("SELECT status FROM pedido_itens WHERE pedido_id = ?", [item.pedido_id])).rows;
    if (itensRestantes.length === 0) {
      const pedido = (await query("SELECT mesa_id, m.numero, p.garcom_id FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [item.pedido_id])).rows[0];
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

      const mesaNum = pedido ? (pedido.garcom_id === 'DELIVERY' ? `DELIVERY #${item.pedido_id}` : (pedido.numero || 'BALCÃO')) : 'BALCÃO';
      await safePusherTrigger('garconnexpress', 'pedido-cancelado', { 
        pedido_id: item.pedido_id, 
        mesa_numero: mesaNum,
        garcom_id: pedido ? pedido.garcom_id : null,
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
    const pedido = (await query("SELECT p.mesa_id, p.status, p.garcom_id, m.numero FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [id])).rows[0];
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
      const mesaNum = pedido.garcom_id === 'DELIVERY' ? `DELIVERY #${id}` : (pedido.numero || 'BALCÃO');
      await safePusherTrigger('garconnexpress', 'pedido-cancelado', { 
        pedido_id: id, 
        mesa_numero: mesaNum,
        garcom_id: pedido.garcom_id,
        mensagem: `🚨 O Pedido #${id} (Mesa ${mesaNum}) foi REMOVIDO pelo Admin.` 
      });
    }

    await safePusherTrigger('garconnexpress', 'menu-atualizado', {});
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/pedidos', async (req, res) => {
  const { mesa_id, garcom_id, itens, cobrar_taxa, observacao, cliente_telefone, forma_pagamento, metodo_pagamento, valor_recebido, troco } = req.body;
  const deveCobrarTaxa = cobrar_taxa !== false;
  try {
    const caixaAberto = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
    if (!caixaAberto) return res.status(400).json({ error: 'O CAIXA ESTÁ FECHADO!' });

    // TRAVA DEFINITIVA: Verifica status da mesa no banco de mesas (MUITO MAIS SEGURO)
    if (mesa_id) {
      const mesaObj = (await query("SELECT status FROM mesas WHERE id = ?", [mesa_id])).rows[0];
      if (mesaObj && (mesaObj.status === 'fechando' || mesaObj.status === 'aguardando_fechamento')) {
        return res.status(403).json({ error: 'CONTA_SOLICITADA' });
      }

      // BLOQUEIO DE DUPLICIDADE (LOCKOUT): Se já existe um pedido ativo, não permite criar outro (POST)
      // O correto em mesas ocupadas é usar ADICIONAR (PUT)
      const pedidoAtivo = (await query("SELECT id FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado', 'rascunho')", [mesa_id])).rows[0];
      if (pedidoAtivo) {
          console.log(`🚫 [BLOQUEIO] Tentativa de duplicar pedido na Mesa ${mesa_id}. Pedido ativo detectado: #${pedidoAtivo.id}`);
          return res.status(400).json({ 
              error: 'MESA_OCUPADA', 
              message: 'Já existe um pedido em andamento para esta mesa. Use a função de adicionar itens.',
              pedido_id: pedidoAtivo.id 
          });
      }

      // LIMPEZA ANTECIPADA DE RASCUNHOS: Evita duplicação ao garantir que rascunhos sumam ANTES do novo pedido entrar
      const mesaIdNum = Number(mesa_id);
      const rascunhos = (await query("SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'rascunho'", [mesaIdNum])).rows;
      for (const r of rascunhos) {
          console.log(`[LIMPEZA-PRE] Removendo rascunho #${r.id} para evitar duplicidade`);
          await query("DELETE FROM pedido_itens WHERE pedido_id = ?", [r.id]);
          await query("DELETE FROM pedidos WHERE id = ?", [r.id]);
      }
    }
    for (const item of itens) {
      const p = (await query("SELECT nome, estoque FROM menu WHERE id = ?", [item.menu_id])).rows[0];
      if (p && p.estoque !== -1 && p.estoque < item.quantidade) return res.status(400).json({ error: `Estoque insuficiente: ${p.nome}` });
    }
    const subtotal = itens.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);

    // Se for delivery e vier total no body, usa ele. Caso contrário, calcula (Subtotal + 3.00 se delivery).
    let total;
    if (req.body.total !== undefined) {
      total = req.body.total;
    } else {
      if (garcom_id === 'DELIVERY') {
        total = subtotal + 3.00;
      } else {
        total = deveCobrarTaxa ? Math.round(subtotal * 1.10 * 100) / 100 : subtotal;
      }
    }

    let pedidoId;
    let resPedido;

    // Captura a forma de pagamento (tenta ambos os nomes para evitar erros de versão)
    const fPag = forma_pagamento || metodo_pagamento || null;
    const vRec = valor_recebido || 0;
    const vTrc = troco || 0;

    if (isPostgres) {
      resPedido = await query('INSERT INTO pedidos (mesa_id, garcom_id, total, status, created_at, cobrar_taxa, observacao, cliente_telefone, forma_pagamento, valor_recebido, troco) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id', [mesa_id || null, garcom_id, total, 'recebido', new Date().toISOString(), deveCobrarTaxa, observacao || '', cliente_telefone || null, fPag, vRec, vTrc]);
      pedidoId = resPedido.rows[0].id;
    } else {
      resPedido = await query('INSERT INTO pedidos (mesa_id, garcom_id, total, status, created_at, cobrar_taxa, observacao, cliente_telefone, forma_pagamento, valor_recebido, troco) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [mesa_id || null, garcom_id, total, 'recebido', new Date().toISOString(), deveCobrarTaxa ? 1 : 0, observacao || '', cliente_telefone || null, fPag, vRec, vTrc]);
      pedidoId = resPedido.lastInsertRowid;
    }

    // NOTIFICAÇÃO PARA DELIVERY (MANTÉM MODO AUTOMÁTICO DO ROBÔ)
    if (garcom_id === 'DELIVERY' && cliente_telefone) {
      const numClean = cliente_telefone.replace(/\D/g, '');
      if (numClean) {
        console.log(`📦 [Delivery] Notificando cliente ${numClean} sobre recebimento...`);
        
        if (whatsappSocket && whatsappSocket.connected) {
          // Apenas notifica o status, o Robô agora está configurado para manter o modo automático
          notifyDeliveryStatusToBot(numClean, 'recebido', pedidoId).catch(console.error);
        }
      }
    }
    if (mesa_id) {
      const mesaIdNum = Number(mesa_id);
      console.log(`[Pedido] Processando mesa ${mesaIdNum}. Garçom: ${garcom_id}`);
      
      // LIMPA RASCUNHOS: Quando o garçom lança o pedido oficial, removemos o rascunho de bloqueio
      const rascunhos = (await query("SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'rascunho'", [mesaIdNum])).rows;
      for (const r of rascunhos) {
          console.log(`[LIMPEZA] Removendo rascunho #${r.id} da mesa ${mesaIdNum}`);
          await query("DELETE FROM pedido_itens WHERE pedido_id = ?", [r.id]);
          await query("DELETE FROM pedidos WHERE id = ?", [r.id]);
      }

      // Notifica o cliente que o rascunho foi processado e ele pode pedir mais
      safePusherTrigger('garconnexpress', `rascunho-processado-mesa-${mesaIdNum}`, { success: true }).catch(console.error);

      await query("UPDATE mesas SET status = 'ocupada', garcom_id = ? WHERE id = ?", [garcom_id, mesaIdNum]);

      // GERAÇÃO AUTOMÁTICA DE CÃ“DIGO DE ACESSO (Só se não houver um ativo)
      const acessoExistente = (await query("SELECT id, codigo FROM codigos_acesso WHERE mesa_id = ? AND status = 'ativo' LIMIT 1", [mesaIdNum])).rows[0];

      if (!acessoExistente) {
        const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let novoCodigo = '';
        for (let i = 0; i < 4; i++) novoCodigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));

        await query("INSERT INTO codigos_acesso (mesa_id, codigo, status) VALUES (?, ?, 'ativo')", [mesaIdNum, novoCodigo]);
        console.log(`🔑 Código automático gerado para Mesa ${mesaIdNum}: ${novoCodigo}`);
      } else {
        console.log(`ℹ️ Mesa ${mesaIdNum} já possui código de acesso ativo (ID: ${acessoExistente.id}, Código: ${acessoExistente.codigo}). Mantendo sessão.`);
      }
    }    for (const item of itens) {
      await query('INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status) VALUES (?, ?, ?, ?, ?)', [pedidoId, item.menu_id, item.quantidade, item.observacao || '', 'pendente']);
      await query("UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque - ? END WHERE id = ?", [item.quantidade, item.menu_id]);
      await verificarEstoqueBaixo(item.menu_id);
    }
    let mesaNum = 'BALCÃO';
    if (mesa_id) { 
      const rm = await query("SELECT numero FROM mesas WHERE id = ?", [mesa_id]); 
      mesaNum = rm.rows[0] ? rm.rows[0].numero : 'BALCÃO'; 
    } else if (garcom_id === 'DELIVERY') {
      mesaNum = `DELIVERY #${pedidoId}`;
    }

    // NOTIFICAÇÃO WHATSAPP DETALHADA
    const itensNomes = [];
    for (const item of itens) {
      const p = (await query("SELECT nome FROM menu WHERE id = ?", [item.menu_id])).rows[0];
      itensNomes.push(`${item.quantidade}x ${p ? p.nome : 'Item'}`);
    }
    const msgWpp = `🚀 *NOVO PEDIDO #${pedidoId}*\n📍 Mesa: ${mesaNum}\n📝 Itens:\n${itensNomes.join('\n')}\n💰 Total: R$ ${total.toFixed(2)}`;

    // Verifica se o pedido tem itens para a cozinha (respeitando as categorias configuradas)
    const configK = await query("SELECT valor FROM sistema_config WHERE chave = 'categorias_cozinha'");
    const catsCozinha = configK.rows[0]?.valor ? JSON.parse(configK.rows[0].valor).map(c => c.trim().toUpperCase()) : [];
    
    let temItemCozinha = false;
    for (const item of itens) {
      const m = (await query("SELECT enviar_cozinha, categoria FROM menu WHERE id = ?", [item.menu_id])).rows[0];
      if (m) {
        const envCozinha = m.enviar_cozinha;
        const categoria = (m.categoria || '').trim().toUpperCase();
        
        // Lógica consistente com getFilterCozinha:
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

    // Dispara notificações CRÍTICAS para a UI (Aguardar para garantir envio no Vercel)
    await Promise.all([
      notifyStatus(pedidoId, mesa_id, 'recebido', mesaNum),
      safePusherTrigger('garconnexpress', 'menu-atualizado', {}),
      // Notifica o cliente especificamente que o botão pode ser liberado
      safePusherTrigger('garconnexpress', `rascunho-processado-mesa-${mesa_id}`, {
        success: true,
        mensagem: "Seu rascunho foi processado pelo garçom!"
      }),
      safePusherTrigger('garconnexpress', 'novo-pedido', {
        para_cozinha: temItemCozinha,
        pedido: { id: pedidoId, mesa_id, mesa_numero: mesaNum, status: 'recebido', garcom_id }
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
    
    // Busca o status atual para saber se deve resetar o cronômetro
    const statusAtualRes = await query("SELECT status FROM pedidos WHERE id = ?", [id]);
    const statusAnterior = statusAtualRes.rows[0] ? statusAtualRes.rows[0].status : '';

    // Se está voltando para 'recebido' vindo de um status diferente de 'recebido', reinicia o cronômetro
    // Se já estava em 'recebido', mantém o original.
    if (temPendente) {
      if (statusAnterior !== 'recebido') {
        await query("UPDATE pedidos SET total = ?, status = ?, created_at = ?, observacao = ? WHERE id = ?", [total, novoStatusPedido, agora, observacao || '', id]);
      } else {
        await query("UPDATE pedidos SET total = ?, status = ?, observacao = ? WHERE id = ?", [total, novoStatusPedido, observacao || '', id]);
      }
      
      const resMesa = await query("SELECT m.numero FROM pedidos p JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [id]);
      const mesaNum = resMesa.rows[0] ? resMesa.rows[0].numero : 'BALCÃO';
      
      // Verifica se há itens para a cozinha
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

    // Busca o status atual para saber se deve resetar o cronômetro
    const statusAtualRes = await query("SELECT status FROM pedidos WHERE id = ?", [id]);
    const statusAnterior = statusAtualRes.rows[0] ? statusAtualRes.rows[0].status : '';

    // Se está voltando para 'recebido' vindo de um status diferente, reinicia o cronômetro (novo ciclo de preparo)
    // Se já estava em 'recebido', mantém o original.
    if (statusAnterior !== 'recebido') {
      await query("UPDATE pedidos SET total = ?, cobrar_taxa = ?, status = 'recebido', created_at = ?, observacao = ? WHERE id = ?", [tot, isPostgres ? deveTaxa : (deveTaxa?1:0), agora, observacao || '', id]);
    } else {
      await query("UPDATE pedidos SET total = ?, cobrar_taxa = ?, status = 'recebido', observacao = ? WHERE id = ?", [tot, isPostgres ? deveTaxa : (deveTaxa?1:0), observacao || '', id]);
    }
    const pMesa = (await query("SELECT mesa_id, m.numero FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [id])).rows[0];
    if (pMesa && pMesa.mesa_id) {
      const mesaIdNum = pMesa.mesa_id;
      await query("UPDATE mesas SET status = 'ocupada' WHERE id = ?", [mesaIdNum]);

      // LIMPA RASCUNHOS: Quando o garçom lança o pedido oficial (adição), removemos o rascunho de bloqueio
      const rascunhos = (await query("SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'rascunho'", [mesaIdNum])).rows;
      for (const r of rascunhos) {
          console.log(`[LIMPEZA-ADD] Removendo rascunho #${r.id} da mesa ${mesaIdNum}`);
          await query("DELETE FROM pedido_itens WHERE pedido_id = ?", [r.id]);
          await query("DELETE FROM pedidos WHERE id = ?", [r.id]);
      }

      // Notifica o cliente que o rascunho foi processado e ele pode pedir mais
      safePusherTrigger('garconnexpress', `rascunho-processado-mesa-${mesaIdNum}`, { success: true }).catch(console.error);
    }
    
    // Notifica a cozinha que há novos itens para preparar (com som)
    const mesaNum = pMesa ? pMesa.numero || 'BALCÃO' : 'BALCÃO';
    
    // Verifica se os NOVOS itens vão para a cozinha
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

// Cliente solicita o fechamento da conta (avisar garçom)
app.post('/api/cliente/solicitar-conta', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token é obrigatório.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'cliente') return res.status(403).json({ error: 'Acesso negado.' });

    const mesaId = decoded.mesa_id;
    
    // Busca o pedido ativo da mesa
    const pedido = (await query("SELECT id, mesa_id FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado') ORDER BY id DESC LIMIT 1", [mesaId])).rows[0];

    if (!pedido) return res.status(404).json({ error: 'Nenhum pedido ativo encontrado para esta mesa.' });

    // TRAVA DE SEGURANÇA: Verifica se existem itens pendentes de entrega
    const itensPendentes = (await query(`
      SELECT id FROM pedido_itens 
      WHERE pedido_id = ? 
      AND status NOT IN ('entregue', 'servido', 'cancelado')
    `, [pedido.id])).rows;

    if (itensPendentes.length > 0) {
      return res.status(400).json({ 
        error: 'PENDENCIAS_ENTREGA', 
        mensagem: 'Você ainda tem itens em preparo ou entrega. Aguarde o recebimento de todos para pedir a conta.' 
      });
    }

    // 1. Atualiza o banco de dados
    // NÃO muda o status da mesa para 'fechando' ainda. 
    // Mantém 'ocupada' para o garçom processar primeiro, mas marca a flag de solicitação.
    await query("UPDATE pedidos SET solicitou_fechamento = TRUE WHERE id = ?", [pedido.id]);
    await query("UPDATE mesas SET status = 'ocupada' WHERE id = ?", [mesaId]); 

    // 2. Busca número da mesa para a notificação
    const mesaRes = await query("SELECT numero FROM mesas WHERE id = ?", [mesaId]);
    const mesaNum = mesaRes.rows[0]?.numero || '??';

    // 3. Notifica Garçom e Admin via Pusher (Som + Modal + Visual Pulsante)
    await safePusherTrigger('garconnexpress', 'solicitacao-fechamento-cliente', {
      pedido_id: pedido.id,
      mesa_id: mesaId,
      mesa_numero: mesaNum,
      mensagem: `🙋‍♂️ MESA ${mesaNum} solicitou o fechamento da conta!`
    });

    res.json({ success: true });
  } catch (error) {
    console.error('❌ ERRO EM /api/cliente/solicitar-conta:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/pedidos/:id/solicitar-fechamento', async (req, res) => {
  const { id } = req.params;
  const { mesa_id, forma_pagamento, desconto, acrescimo, valor_recebido, troco, total, num_pessoas, valor_por_pessoa, pagamentos_detalhados } = req.body;
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

    const pagamentosStr = pagamentos_detalhados ? JSON.stringify(pagamentos_detalhados) : null;
    const formaPagamentoFinal = (num_pessoas > 1 && pagamentos_detalhados) ? 'Múltiplas' : (forma_pagamento || 'Dinheiro');

    // Ativa fechamento_liberado quando o garçom processa a solicitação
    await query(`UPDATE pedidos SET status = 'aguardando_fechamento', forma_pagamento = ?, desconto = ?, acrescimo = ?, valor_recebido = ?, troco = ?, total = ?, num_pessoas = ?, valor_por_pessoa = ?, cobrar_taxa = ?, fechamento_liberado = TRUE, pagamentos_detalhados = ? WHERE id = ?`, 
      [formaPagamentoFinal, desconto || 0, acrescimo || 0, valor_recebido || 0, troco || 0, totalFinal, num_pessoas || 1, valor_por_pessoa || totalFinal, (req.body.cobrar_taxa !== undefined ? (req.body.cobrar_taxa ? 1 : 0) : 1), pagamentosStr, id]);
    
    if (mesa_id) await query("UPDATE mesas SET status = 'fechando' WHERE id = ?", [mesa_id]);
    await notifyStatus(id, mesa_id, 'aguardando_fechamento');

    // Notifica o cliente que o cupom de conferência foi liberado
    await safePusherTrigger('garconnexpress', `fechamento-liberado-mesa-${mesa_id}`, {
        pedido_id: id,
        mensagem: "Seu cupom de conferência está disponível!"
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
      await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [mesa_id]);
      await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [mesa_id]);
      
      // Notifica o cliente para encerrar o acesso
      await safePusherTrigger('garconnexpress', `deslogar-mesa-${mesa_id}`, { 
        mensagem: "Sua conta foi finalizada. Obrigado pela preferência!" 
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
    // Busca status anterior para controle de estoque
    const prevStatusRes = await query("SELECT status FROM pedidos WHERE id = ?", [id]);
    const prevStatus = prevStatusRes.rows[0] ? prevStatusRes.rows[0].status : null;

    await query('UPDATE pedidos SET status = ? WHERE id = ?', [status, id]);
    
    if (status === 'cancelado' && prevStatus !== 'cancelado' && prevStatus !== 'rascunho') {
      const itens = (await query("SELECT menu_id, quantidade FROM pedido_itens WHERE pedido_id = ?", [id])).rows;
      for (const item of itens) {
        await query("UPDATE menu SET estoque = CASE WHEN estoque = -1 THEN -1 ELSE estoque + ? END WHERE id = ?", [item.quantidade, item.menu_id]);
      }
      await query("UPDATE pedido_itens SET status = 'cancelado' WHERE pedido_id = ?", [id]);
    }
    const pm = (await query("SELECT p.mesa_id, p.garcom_id, m.numero FROM pedidos p LEFT JOIN mesas m ON p.mesa_id = m.id WHERE p.id = ?", [id])).rows[0];
    const mesaNum = pm ? (pm.garcom_id === 'DELIVERY' ? `DELIVERY #${id}` : (pm.numero || 'BALCÃO')) : 'BALCÃO';

    // Se o status for cancelado ou entregue, libera a mesa e o código
    if ((status === 'cancelado' || status === 'entregue') && pm && pm.mesa_id) {
        await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [pm.mesa_id]);
        await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [pm.mesa_id]);

        // Notifica o cliente logado para encerrar o acesso
        const msgLogout = status === 'entregue' ? "Sua conta foi finalizada. Obrigado pela preferência!" : "Este pedido foi cancelado pelo estabelecimento. Seu acesso foi encerrado.";
        await safePusherTrigger('garconnexpress', `deslogar-mesa-${pm.mesa_id}`, { 
          mensagem: msgLogout,
          status: status, // envia 'cancelado' ou 'entregue'
          mesa_id: pm.mesa_id 
        });
        
        if (status === 'cancelado') {
          console.log(`❌ Pedido ${id} cancelado pelo Admin. Notificando globalmente...`);
          await safePusherTrigger('garconnexpress', 'pedido-cancelado', { 
            id: id,
            pedido_id: id, 
            mesa_numero: mesaNum,
            garcom_id: pm ? pm.garcom_id : null,
            mensagem: `🚨 O Pedido #${id} (Mesa ${mesaNum}) foi CANCELADO pelo Admin.` 
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
      // Camada 1: SQL - Filtra no banco (Visível = 1 E (Ilimitado -1 OU Maior que 0))
      const visivelValue = isPostgres ? 'TRUE' : '1';
      querySql += ` WHERE visivel = ${visivelValue} AND (estoque = -1 OR (estoque IS NOT NULL AND estoque > 0))`;
    }
    
    const menuRes = await query(querySql);
    let menu = menuRes.rows;

    // Camada 2: JavaScript - Filtro de segurança extra para clientes
    if (admin !== 'true') {
      menu = menu.filter(item => {
        const est = parseInt(item.estoque);
        return item.visivel && (est === -1 || est > 0);
      });
    }

    const ordemRes = await query("SELECT valor FROM sistema_config WHERE chave = 'ordem_categorias'");
    if (ordemRes.rows.length > 0 && ordemRes.rows[0].valor) {
      const ordem = JSON.parse(ordemRes.rows[0].valor).map(c => c.trim().toUpperCase());
      
      menu.sort((a, b) => {
        const catA = a.categoria.trim().toUpperCase();
        const catB = b.categoria.trim().toUpperCase();
        const indexA = ordem.indexOf(catA);
        const indexB = ordem.indexOf(catB);
        
        // Se ambos estão na lista de ordem, segue a ordem
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        // Se apenas um está, ele vem primeiro
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        // Se nenhum está, mantém ordem alfabética original ou id
        return catA.localeCompare(catB);
      });
    } else {
      // Padrão: Ordenar por validade como estava ou alfabético
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
    // Usamos UPPER para garantir que pegue variações de caixa se houver (ex: Bebidas vs bebidas)
    await query('DELETE FROM menu WHERE UPPER(categoria) = UPPER(?)', [categoria]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/menu/categoria/:categoria', async (req, res) => {
  const { categoria } = req.params;
  const { novoNome } = req.body;
  if (!novoNome) return res.status(400).json({ error: 'Novo nome é obrigatório' });
  const nomeLimpo = novoNome.trim();
  
  try {
    // 1. Atualiza todos os itens do cardápio que pertencem a esta categoria
    await query('UPDATE menu SET categoria = ? WHERE UPPER(categoria) = UPPER(?)', [nomeLimpo, categoria]);

    // 2. Sincroniza a configuração de categorias da cozinha (se existir)
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
    console.error('❌ ERRO NA ROTA /api/garcons:', error);
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
    res.json((await query(`SELECT * FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY created_at DESC LIMIT 1`, [req.params.mesaId])).rows[0] || null); 
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/mesas', ensureDbInitialized, async (req, res) => { 
  try {
    res.json((await query(`
      SELECT m.*, 
        (SELECT p.id FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as pedido_id,
        (SELECT p.created_at FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as pedido_created_at, 
        COALESCE(
          (SELECT p.garcom_id FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1),
          m.garcom_id
        ) as garcom_id,
        (SELECT p.status FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as pedido_status,
        (SELECT p.solicitou_fechamento FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as solicitou_fechamento,
        (SELECT p.fechamento_liberado FROM pedidos p WHERE p.mesa_id = m.id AND p.status NOT IN ('entregue', 'cancelado', 'rascunho') ORDER BY p.id DESC LIMIT 1) as fechamento_liberado,
        (SELECT ca.codigo FROM codigos_acesso ca WHERE ca.mesa_id = m.id AND ca.status = 'ativo' ORDER BY ca.id DESC LIMIT 1) as codigo_acesso
      FROM mesas m ORDER BY m.numero
    `)).rows); 
  } catch (error) { res.status(500).json({ error: error.message }); }
});
// Cliente busca seus próprios pedidos ativos
app.post('/api/cliente/meus-pedidos', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token é obrigatório.' });

  try {
    // 1. Valida o JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }

    if (decoded.role !== 'cliente') {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const mesaId = decoded.mesa_id;
    const acessoId = decoded.acesso_id;
    const pedidoIdSessao = decoded.pedido_id; // ID do pedido vinculado no login

    // 2. Verifica se o código de acesso existe.
    // Buscamos o status e a data de criação para garantir isolamento entre sessões.
    const acesso = (await query("SELECT id, status, criado_at, mesa_id FROM codigos_acesso WHERE id = ?", [acessoId])).rows[0];
    if (!acesso) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });

    // Busca status atual da mesa
    const mesaAtual = (await query("SELECT status FROM mesas WHERE id = ?", [mesaId])).rows[0];
    const mesaStatus = mesaAtual ? mesaAtual.status : 'livre';

    // 3. Busca todos os pedidos vinculados a esta mesa que ainda não foram finalizados (PAGOS)
    // Buscamos pedidos com status 'aberto' ou 'pendente', mas também incluímos pedidos 'entregues' 
    // que tenham sido criados após a geração do código de acesso para que o cliente veja seu histórico.
    const dateComparison = isPostgres 
      ? "created_at >= ?" 
      : "STRFTIME('%Y-%m-%d %H:%M:%S', created_at) >= STRFTIME('%Y-%m-%d %H:%M:%S', ?)";

    const pedidosSessao = (await query(`
      SELECT id, total, status, cobrar_taxa, desconto, acrescimo, solicitou_fechamento, fechamento_liberado 
      FROM pedidos 
      WHERE mesa_id = ? 
      AND (
        status NOT IN ('entregue', 'cancelado') -- Pedidos ativos na mesa (lançados pelo garçom ou cliente)
        OR 
        (status = 'entregue' AND ${dateComparison}) -- Pedidos já entregues nesta sessão
      )
      ORDER BY id ASC
    `, [mesaId, acesso.criado_at])).rows;

    if (pedidosSessao.length === 0) {
      return res.json({ success: true, pedido: null, itens: [] });
    }

    // 4. Busca todos os itens de todos os pedidos da sessão
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
    // Usamos o último pedido da lista para as flags de status (fechamento, etc)
    const ultimoPedido = pedidosSessao[pedidosSessao.length - 1];
    
    // 6. Verifica se há algum pedido ou item que ainda não foi confirmado pelo garçom
    // Um rascunho no banco (status 'rascunho') bloqueia novos envios do cliente.
    const temPendente = pedidosSessao.some(p => p.status === 'rascunho') || itens.some(i => i.status === 'rascunho');

    console.log(`[DEBUG] Mesa ${mesaId}: ${pedidosSessao.length} pedidos na sessão. temPendente=${temPendente}`);
    if (temPendente) {
      console.log(`[DEBUG] Pedidos rascunho:`, pedidosSessao.filter(p => p.status === 'rascunho').map(p => p.id));
    }

    let totalReal = 0;
    itens.forEach(i => {
      const preco = i.preco || i.menu_preco || 0;
      totalReal += (i.quantidade * preco);
    });

    // Aplica taxa de serviço (baseada na preferência do último pedido ou se algum deles cobrar)
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
      itens,
      tem_pendente: temPendente,
      mesaStatus: mesaStatus
    });

  } catch (error) {
    console.error('❌ ERRO EM /api/cliente/meus-pedidos:', error);
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

// --- ROTAS DO CARDÁPIO DIGITAL (CLIENTE) ---

// Gera um novo código de acesso para uma mesa (Usado pelo Garçom/Admin)
app.post('/api/acesso/gerar', isAuthenticated, async (req, res) => {
  const { mesa_id } = req.body;
  console.log(`🔑 GERAR CÃ“DIGO: Mesa ID=${mesa_id}`);
  if (!mesa_id) return res.status(400).json({ error: 'Mesa é obrigatória' });
  
  try {
    // 1. Desativa códigos anteriores desta mesa
    const resDesativa = await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [mesa_id]);
    console.log(`   - Desativados: ${resDesativa.changes}`);
    
    // 2. Gera código aleatório de 4 dígitos
    const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let codigo = '';
    for (let i = 0; i < 4; i++) {
      codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
    }
    
    // 3. Insere o novo código
    const resInsert = await query("INSERT INTO codigos_acesso (mesa_id, codigo) VALUES (?, ?)", [mesa_id, codigo]);
    console.log(`   - Novo código: ${codigo} (ID: ${resInsert.lastInsertRowid})`);
    
    // 4. Marca a mesa como ocupada e associa ao garçom que gerou o código
    const garcom_id = req.user ? (req.user.usuario || req.user.nome) : 'Sistema';
    
    const resUpdateMesa = await query("UPDATE mesas SET status = 'ocupada', garcom_id = ? WHERE id = ?", [garcom_id, mesa_id]);
    console.log(`   - Status Mesa ${mesa_id} atualizado para 'ocupada' (Garçom: ${garcom_id}): ${resUpdateMesa.changes} linha(s) afetada(s)`);
    
    // Notifica via Pusher para atualizar as mesas de todos
    await safePusherTrigger('garconnexpress', 'status-atualizado', { 
      mesa_id, 
      status: 'ocupada',
      garcom_id: garcom_id,
      origem: 'codigo_gerado'
    });
    
    res.json({ success: true, codigo });
  } catch (error) {
    console.error(`❌ ERRO AO GERAR CÃ“DIGO:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Cancela o acesso de uma mesa (Cliente desistiu ou saiu antes de pedir)
app.post('/api/acesso/cancelar', isAuthenticated, async (req, res) => {
  const { mesa_id } = req.body;
  if (!mesa_id) return res.status(400).json({ error: 'Mesa é obrigatória' });

  try {
    // 1. Invalida os códigos ativos da mesa
    await query("UPDATE codigos_acesso SET status = 'expirado' WHERE mesa_id = ? AND status = 'ativo'", [mesa_id]);

    // 2. Libera a mesa no sistema
    await query("UPDATE mesas SET status = 'livre' WHERE id = ?", [mesa_id]);

    // 3. Notifica o cliente para deslogar (via Pusher)
    await safePusherTrigger('garconnexpress', `deslogar-mesa-${mesa_id}`, { 
      status: 'cancelado',
      mensagem: "Este acesso foi cancelado pelo garçom." 
    });

    // 4. Notifica todos os garçons/admin para atualizar o grid de mesas
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

// Acesso via QR Code (Abre a mesa automaticamente e atribui garçom por rodízio)
app.post('/api/acesso/qr', async (req, res) => {
  const { mesa_id } = req.body;
  if (!mesa_id) return res.status(400).json({ error: 'Mesa é obrigatória' });

  try {
    const caixa = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
    if (!caixa) return res.status(403).json({ error: 'ESTABELECIMENTO FECHADO: O cardápio digital só funciona com o caixa aberto.' });

    const mesa = (await query("SELECT * FROM mesas WHERE id = ?", [mesa_id])).rows[0];
    if (!mesa) return res.status(404).json({ error: 'Mesa não encontrada' });

    // 2.5 BLOQUEIO: Se já existe um código ativo (gerado pelo garçom), impede o escaneamento direto
    const acessoExistente = (await query("SELECT id FROM codigos_acesso WHERE mesa_id = ? AND status = 'ativo'", [mesa_id])).rows[0];
    if (acessoExistente) {
        return res.status(400).json({ success: false, error: 'Esta mesa já possui um código ativo. Por favor, insira o código manualmente ou peça ao garçom.' });
    }

    let acesso;
    if (mesa.status === 'livre') {
      // LÃ“GICA DE RODÍZIO (Round-Robin): Pega o garçom online que está há mais tempo sem atender
      const proximoGarcom = (await query("SELECT id, usuario, nome FROM garcons WHERE is_online = ? ORDER BY last_assigned_at ASC LIMIT 1", [isPostgres ? true : 1])).rows[0];
      
      if (!proximoGarcom) {
        return res.status(503).json({ error: 'Nenhum garçom online no momento para te atender. Por favor, chame um atendente no balcão.' });
      }

      const garcom_id = proximoGarcom.usuario;
      const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let codigo = '';
      for (let i = 0; i < 4; i++) codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));

      await query("INSERT INTO codigos_acesso (mesa_id, codigo) VALUES (?, ?)", [mesa_id, codigo]);
      await query("UPDATE mesas SET status = 'ocupada', garcom_id = ? WHERE id = ?", [garcom_id, mesa_id]);
      
      // Atualiza o timestamp para mover o garçom para o fim da fila
      await query("UPDATE garcons SET last_assigned_at = ? WHERE id = ?", [new Date().toISOString(), proximoGarcom.id]);

      acesso = (await query("SELECT ca.*, m.numero as mesa_numero FROM codigos_acesso ca JOIN mesas m ON ca.mesa_id = m.id WHERE ca.mesa_id = ? AND ca.status = 'ativo' ORDER BY ca.id DESC LIMIT 1", [mesa_id])).rows[0];
      
      console.log(`🤖 [Rodízio] Mesa ${mesa.numero} atribuída a: ${proximoGarcom.nome}`);
      
      await safePusherTrigger('garconnexpress', 'status-atualizado', { 
        mesa_id, 
        status: 'ocupada',
        garcom_id: garcom_id,
        origem: 'qr_code'
      });
    } else {
      // TRAVA DE SEGURANÇA: Se a mesa não estiver livre, bloqueia o novo escaneamento
      return res.status(403).json({ 
        error: 'MESA OCUPADA: Esta mesa já possui um atendimento em andamento. Se você já estava nesta mesa, use o menu anterior ou peça ajuda ao garçom.' 
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
  if (!codigo) return res.status(400).json({ error: 'Código é obrigatório' });

  try {
    // 1. Verifica se o caixa está aberto
    const caixa = (await query("SELECT id FROM fluxo_caixa WHERE status = 'aberto'")).rows[0];
    if (!caixa) return res.status(403).json({ error: 'ESTABELECIMENTO FECHADO: O cardápio digital só funciona com o caixa aberto.' });

    // 2. Verifica se o código é válido e ativo
    const acesso = (await query("SELECT ca.*, m.numero as mesa_numero FROM codigos_acesso ca JOIN mesas m ON ca.mesa_id = m.id WHERE UPPER(ca.codigo) = UPPER(?) AND ca.status = 'ativo'", [codigo])).rows[0];

    if (!acesso) return res.status(401).json({ error: 'Código inválido ou já expirado.' });

    // 3. Verificação de Segurança: A mesa está realmente ocupada?
    // Isso evita que códigos de sessões anteriores permitam acesso a mesas já liberadas.
    const mesaStatus = (await query("SELECT status FROM mesas WHERE id = ?", [acesso.mesa_id])).rows[0];
    
    if (!mesaStatus || mesaStatus.status === 'livre') {
      // Se a mesa está livre, o código deve ser invalidado por segurança (Ghost Session Prevention)
      await query("UPDATE codigos_acesso SET status = 'expirado' WHERE id = ?", [acesso.id]);
      return res.status(403).json({ error: 'ESTA MESA NÃO ESTÁ ATIVA: Peça ao garçom para abrir sua mesa novamente.' });
    }

    // 4. Busca pedido_id se existir (opcional nesta fase)
    const pedidoAtivo = (await query("SELECT id FROM pedidos WHERE mesa_id = ? AND status NOT IN ('entregue', 'cancelado') ORDER BY id DESC LIMIT 1", [acesso.mesa_id])).rows[0];

    // 5. Gera o token de acesso (pedido_id pode ser null se for mesa recém aberta)
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

// Verifica se a sessão do cliente ainda é válida (código ainda ativo)
app.get('/api/acesso/check', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Não autorizado' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'cliente' || !decoded.acesso_id) {
        return res.status(403).json({ error: 'Token inválido para esta operação' });
    }

    const acesso = (await query("SELECT status, mesa_id FROM codigos_acesso WHERE id = ?", [decoded.acesso_id])).rows[0];
    if (!acesso || acesso.status !== 'ativo') {
        return res.json({ valid: false, error: 'Acesso expirado' });
    }

    // Verifica se a mesa ainda está ativa (ocupada ou em fechamento)
    const mesa = (await query("SELECT status FROM mesas WHERE id = ?", [acesso.mesa_id])).rows[0];
    if (!mesa || mesa.status === 'livre') {
        // Se a mesa foi liberada, invalida o acesso por segurança
        await query("UPDATE codigos_acesso SET status = 'expirado' WHERE id = ?", [decoded.acesso_id]);
        return res.json({ valid: false, error: 'Mesa liberada' });
    }

    res.json({ valid: true });
  } catch (err) {
    res.status(401).json({ error: 'Sessão expirada' });
  }
});
// Cliente solicita atendimento do garçom
app.post('/api/cliente/chamar-garcom', async (req, res) => {
  const { mesa_id, mesa_numero } = req.body;
  try {
    await safePusherTrigger('garconnexpress', 'chamado-garcom', {
      mesa_id,
      mesa_numero,
      mensagem: `🛎️ MESA ${mesa_numero} solicitou atendimento!`
    });
    
    // Notifica via WhatsApp também se configurado
    sendWhatsAppMessage(`🛎️ *CHAMADO DE MESA*\n📍 Mesa: ${mesa_numero}\n🙋‍♂️ O cliente solicitou atendimento imediato.`).catch(e => console.error('Erro Wpp Chamado:', e.message));
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cliente envia rascunho do pedido (pré-seleção)
app.post('/api/cliente/enviar-rascunho', async (req, res) => {
  const { mesa_id, mesa_numero, itens } = req.body;
  try {
    // BLOQUEIO DEFINITIVO: Verifica status real da mesa
    if (mesa_id) {
      const mesaObj = (await query("SELECT status FROM mesas WHERE id = ?", [mesa_id])).rows[0];
      if (mesaObj && (mesaObj.status === 'fechando' || mesaObj.status === 'aguardando_fechamento')) {
        return res.status(403).json({ 
          error: 'CONTA_SOLICITADA',
          mensagem: 'Você já solicitou o fechamento da conta para esta mesa. Se deseja pedir novos itens, por favor, chame o garçom.' 
        });
      }
    }

    // TRAVA DE SEGURANÇA BACKEND: Verifica se já existe rascunho no Banco de Dados
    const pendentes = await query(`
      SELECT id FROM pedidos WHERE mesa_id = ? AND status = 'rascunho'
    `, [mesa_id]);

    if (pendentes.rows.length > 0) {
      return res.status(403).json({ 
        error: 'PENDENTE', 
        mensagem: 'Ops! Você já enviou um pedido que está aguardando a confirmação do garçom. Por favor, aguarde ele confirmar este primeiro pedido para poder enviar novos itens. Obrigado pela paciência!' 
      });
    }

    // Cria um registro de pedido temporário (rascunho) no banco para bloquear novos envios
    let pedidoRascunhoId;
    const agora = new Date().toISOString();
    if (isPostgres) {
      const resR = await query('INSERT INTO pedidos (mesa_id, total, status, created_at, observacao) VALUES (?, ?, ?, ?, ?) RETURNING id', 
        [mesa_id, 0, 'rascunho', agora, 'RASCUNHO CLIENTE']);
      pedidoRascunhoId = resR.rows[0].id;
    } else {
      const resR = await query('INSERT INTO pedidos (mesa_id, total, status, created_at, observacao) VALUES (?, ?, ?, ?, ?)', 
        [mesa_id, 0, 'rascunho', agora, 'RASCUNHO CLIENTE']);
      pedidoRascunhoId = resR.lastInsertRowid;
    }

    // Insere os itens do rascunho para que o cliente possa vê-los em "Meus Pedidos"
    for (const item of itens) {
      await query('INSERT INTO pedido_itens (pedido_id, menu_id, quantidade, observacao, status) VALUES (?, ?, ?, ?, ?)', 
        [pedidoRascunhoId, item.menu_id, item.quantidade, '', 'rascunho']);
    }

    const itensFormatados = itens.map(i => `${i.quantidade}x ${i.nome}`).join('\n');
    const msg = `📝 RASCUNHO RECEBIDO - MESA ${mesa_numero}\n${itensFormatados}`;

    await safePusherTrigger('garconnexpress', 'rascunho-recebido', {
      mesa_id,
      mesa_numero,
      itens,
      pedido_id: pedidoRascunhoId,
      mensagem: msg
    });

    // Notifica via WhatsApp também
    sendWhatsAppMessage(`📝 *RASCUNHO DE PEDIDO*\n📍 Mesa: ${mesa_numero}\n\n${itensFormatados}\n\n⚠️ _Aguardando confirmação do garçom._`).catch(e => console.error('Erro Wpp Rascunho:', e.message));

    res.json({ success: true, pedido_id: pedidoRascunhoId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/whatsapp-status', async (req, res) => {
  try {
    const configRes = await query("SELECT valor FROM sistema_config WHERE chave = 'whatsapp_enabled'");
    const isEnabled = configRes.rows && configRes.rows.length > 0 ? configRes.rows[0].valor === 'true' : true;

    // Busca a lista de números no banco de dados (chave correta: plural)
    const configNums = await query("SELECT valor FROM sistema_config WHERE chave = 'whatsapp_notify_numbers'");
    let numbersDisplay = 'Não configurado';
    
    if (configNums.rows && configNums.rows.length > 0 && configNums.rows[0].valor) {
      numbersDisplay = configNums.rows[0].valor;
    } else if (process.env.WHATSAPP_NOTIFY_NUMBER) {
      numbersDisplay = process.env.WHATSAPP_NOTIFY_NUMBER;
    }

    res.json({
      configured: !!botUrlFinal,
      connected: whatsappSocket ? whatsappSocket.connected : false,
      enabled: isEnabled,
      number: numbersDisplay,
      botUrl: botUrlFinal || ''
    });
  } catch (error) {
    console.error('❌ Erro ao buscar status do WhatsApp:', error.message);
    // Retorna um objeto válido em vez de 500 para evitar o selo de ERRO no frontend
    res.json({
      configured: !!botUrlFinal,
      connected: false,
      enabled: false,
      number: 'Erro ao carregar',
      botUrl: botUrlFinal || '',
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
    
    // SINCRONIZAÇÃO COMPLETA: 
    // Define todos os itens como NULL para que passem a seguir a nova regra de categorias global.
    // Isso garante que o "Salvar" da configuração realmente aplique a mudança em todo o cardápio.
    // Marcações manuais anteriores serão resetadas para seguir a nova configuração global.
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
