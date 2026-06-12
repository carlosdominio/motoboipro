const API_BASE_URL = 'https://garconnexpress.vercel.app'; // URL DO SEU SERVIDOR NO VERCEL

let menu = [];
let mesas = [];
let timeoutPusher = null;
let configCozinhaCategorias = []; // Estado global das categorias da cozinha

// --- INTEGRAÇÃO CAPACITOR NATIVA ---
let isNativeApp = false;

document.addEventListener('DOMContentLoaded', async () => {
  // Verifica se o objeto global do Capacitor existe (injetado pelo app nativo)
  if (window.Capacitor) {
    isNativeApp = window.Capacitor.isNativePlatform();
    console.log(`📱 App rodando em ambiente nativo? ${isNativeApp}`);
    
    if (isNativeApp && localStorage.getItem('garcom_token')) {
       await registerNativePush();
    }
  }

  verificarSessao();
  atualizarInterfacePausa();
  
  // Ativa o Wake Lock no primeiro clique do usuário
  document.body.addEventListener('click', () => {
    if (!wakeLock) requestWakeLock();
  }, { once: true });
});

async function registerNativePush() {
  try {
    const { PushNotifications } = window.Capacitor.Plugins;
    
    let permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive === 'prompt') {
      permStatus = await PushNotifications.requestPermissions();
    }

    if (permStatus.receive !== 'granted') {
      console.warn('❌ Permissão de notificação negada.');
      return;
    }

    await PushNotifications.register();

    PushNotifications.addListener('registration', async (token) => {
      console.log('🔥 Token FCM recebido:', token.value);
      await fetch(API_BASE_URL + '/api/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + localStorage.getItem('garcom_token')
        },
        body: JSON.stringify({
          endpoint: token.value,
          keys: { p256dh: '', auth: '' }
        })
      });
    });

    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('📩 Notificação recebida:', notification);
      carregarMesas();
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
      window.focus();
      carregarMesas();
    });

  } catch (error) {
    console.error('❌ Erro Push Nativo:', error);
  }
}

// Interceptador global para adicionar URL base e Token
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const token = localStorage.getItem('garcom_token');
  let url = args[0];
  
  // Se for uma rota interna /api/, coloca a URL do Vercel na frente
  if (typeof url === 'string' && url.startsWith('/api/')) {
      url = API_BASE_URL + url;
  }

  if (token) {
    if (!args[1]) args[1] = {};
    if (!args[1].headers) args[1].headers = {};
    args[1].headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await originalFetch(url, args[1]);
    if ((response.status === 401 || response.status === 403) && !url.includes('/api/login')) {
      localStorage.removeItem('garcom_logado');
      localStorage.removeItem('garcom_token');
      window.location.reload();
    }
    return response;
  } catch (error) {
    console.error("❌ Erro Fetch:", error, "URL:", url);
    throw error;
  }
};

let mesaAtual = null;
let pedidoAtual = [];
let pedidoAbertoNaMesa = null;
let garcomLogado = null;
let caixaAberto = false;
let categoriaAtual = sessionStorage.getItem('garcom_categoria_atual') || 'todas';
let garcomPausado = localStorage.getItem('garcom_pausado') === 'true';
let pusherInstancia = null;

// Wake Lock (Tela sempre ativa)
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (err) { console.error(`Wake Lock Error: ${err.message}`); }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    requestWakeLock();
    carregarMesas();
    if (pusherInstancia && pusherInstancia.connection.state !== 'connected') {
      pusherInstancia.connect();
    }
  }
});

async function togglePausa() {
  if (!garcomLogado) return;
  const check = document.getElementById('check-pausa');
  garcomPausado = !check.checked;
  localStorage.setItem('garcom_pausado', garcomPausado);
  
  try {
    await fetch('/api/garcom/pausar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pausado: garcomPausado })
    });
    atualizarInterfacePausa();
  } catch (e) { console.error("Erro pausa:", e); }
}

function atualizarInterfacePausa() {
  const check = document.getElementById('check-pausa');
  const label = document.getElementById('label-pausa');
  const slider = document.getElementById('slider-pausa');
  if (!check || !label) return;
  check.checked = !garcomPausado;
  label.textContent = garcomPausado ? 'PAUSADO' : 'NA FILA';
  label.style.color = garcomPausado ? '#e67e22' : '#2ecc71';
}

function verificarSessao() {
  const salvo = localStorage.getItem('garcom_logado');
  if (salvo) {
    garcomLogado = JSON.parse(salvo);
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('garcom-nome-exibicao').textContent = `Garçom: ${garcomLogado.nome}`;
    iniciarApp();
  }
}

async function realizarLogin() {
  const usuario = document.getElementById('login-usuario').value;
  const senha = document.getElementById('login-senha').value;
  if (!usuario || !senha) return await mostrarAlerta("Preencha todos os campos");
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, senha })
  });
  if (res.ok) {
    const data = await res.json();
    localStorage.setItem('garcom_logado', JSON.stringify(data.garcom));
    if (data.token) localStorage.setItem('garcom_token', data.token);
    location.reload();
  } else await mostrarAlerta("Usuário ou senha incorretos");
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  localStorage.clear();
  location.reload();
}

async function iniciarApp() {
  await carregarConfigCozinha();
  await carregarMenu();
  await carregarMesas();
  await atualizarStatusCaixa();
  configurarEventos();
  configurarPusher();
  setInterval(() => exibirMesas(), 1000);
  setInterval(() => carregarMesas(), 60000);
}

async function carregarConfigCozinha() {
    try {
        const res = await fetch('/api/config/categorias-cozinha');
        if (res.ok) { configCozinhaCategorias = (await res.json()).map(c => c.trim().toUpperCase()); }
    } catch (e) {}
}

async function atualizarStatusCaixa() {
  try {
    const res = await fetch('/api/caixa/status');
    const caixa = await res.json();
    caixaAberto = !!caixa;
    document.getElementById('closed-screen').style.display = caixaAberto ? 'none' : 'flex';
    const badge = document.getElementById('caixa-status-badge');
    badge.style.display = 'inline-block';
    badge.textContent = caixaAberto ? 'CAIXA ABERTO' : 'CAIXA FECHADO';
    badge.className = `badge-caixa ${caixaAberto ? 'aberto' : 'fechado'}`;
    carregarMesas();
  } catch (e) {}
}

const audioNotificacao = new Audio('notificacao.mp3');
let audioDesbloqueado = false;

function tocarCampainha(suave = false) {
  if (audioDesbloqueado) {
    audioNotificacao.volume = suave ? 0.4 : 1.0;
    audioNotificacao.currentTime = 0;
    audioNotificacao.play().catch(e => console.warn('Audio play error:', e));
  }
}

async function configurarPusher() {
  try {
    const configRes = await fetch('/api/pusher-config');
    const pusherConfig = await configRes.json();
    const pusher = new Pusher(pusherConfig.key, { cluster: pusherConfig.cluster, forceTLS: true });
    pusherInstancia = pusher;
    const channel = pusher.subscribe('garconnexpress');

    channel.bind('pedido-pronto', (data) => {
      tocarCampainha();
      mostrarToast(data.mensagem, 'success', '🍳 PEDIDO PRONTO');
      carregarMesas();
    });

    channel.bind('status-atualizado', (data) => {
      carregarMesas();
      if (data && data.status !== 'cancelado') {
        tocarCampainha(true);
        mostrarToast(`Mesa ${data.mesa_numero || data.mesa_id}: Status Atualizado`);
      }
    });

    channel.bind('pedido-cancelado', (data) => {
      tocarCampainha();
      mostrarToast(data.mensagem || `Mesa ${data.mesa_numero}: Pedido Cancelado`, 'error');
      if (mesaAtual && (mesaAtual.id == data.mesa_id)) voltarParaMesas();
      carregarMesas();
    });

    channel.bind('status-caixa-atualizado', (data) => {
      atualizarStatusCaixa();
      mostrarToast(`O caixa foi ${data.status.toUpperCase()}`);
    });

    channel.bind('chamado-garcom', (data) => {
      tocarCampainha();
      mostrarAlerta(data.mensagem, "🛎️ CHAMADO", "🛎️");
    });

    channel.bind('rascunho-recebido', (data) => {
      tocarCampainha();
      mostrarRascunho(data);
    });

    document.addEventListener('click', () => {
      if (!audioDesbloqueado) {
        audioDesbloqueado = true;
        audioNotificacao.play().then(() => { audioNotificacao.pause(); });
      }
    }, { once: true });

  } catch (e) {}
}

async function carregarMenu() {
  const res = await fetch('/api/menu');
  if (res.ok) { menu = await res.json(); exibirMenu('todas'); }
}

async function carregarMesas() {
  const res = await fetch('/api/mesas');
  if (res.ok) { mesas = await res.json(); exibirMesas(); }
}

function exibirMesas() {
  const grid = document.getElementById('mesas-grid');
  if (!grid) return;
  grid.innerHTML = mesas.map(mesa => {
    let statusTxt = mesa.status.toUpperCase();
    let classeAlerta = '';
    if (!caixaAberto) statusTxt = 'CAIXA FECHADO';
    else if (mesa.solicitou_fechamento) { statusTxt = '🙋‍♂️ FECHAMENTO'; classeAlerta = 'solicitacao-fechamento'; }
    else if (mesa.pedido_status === 'pronto') { statusTxt = '🔥 PRONTO'; classeAlerta = 'pedido-pronto-alert'; }

    return `<div class="mesa ${mesa.status} ${classeAlerta}" onclick="selecionarMesa(${mesa.id})">
              <h3>Mesa ${mesa.numero}</h3>
              <p>${statusTxt}</p>
            </div>`;
  }).join('');
}

window.selecionarMesa = (id) => {
  const mesa = mesas.find(m => m.id == id);
  mesaAtual = mesa;
  mostrarOpcoesMesa(mesa);
};

async function mostrarOpcoesMesa(mesa) {
  mesaAtual = mesa;
  const res = await fetch(`/api/pedidos/mesa/${mesa.id}`);
  pedidoAbertoNaMesa = res.ok ? await res.json() : null;
  document.getElementById('modal-mesa-titulo').textContent = `Mesa ${mesa.numero}`;
  document.getElementById('modal-opcoes').style.display = 'block';
  // Ajuste de botões do modal omitido por brevidade, mas o clique em Adicionar chamará abrirCardapio
}

function abrirCardapio() {
  document.getElementById('mesas').classList.add('hidden');
  document.getElementById('pedido').classList.remove('hidden');
  document.getElementById('mesa-atual').textContent = mesaAtual.numero;
  exibirMenu('todas');
}

async function exibirMenu(cat) {
  const grid = document.getElementById('menu-grid');
  const filtered = cat === 'todas' ? menu : menu.filter(i => i.categoria === cat);
  grid.innerHTML = filtered.map(i => `
    <div class="item-menu" onclick="adicionarAoCarrinho(${i.id})">
      <img src="${i.imagem}" onerror="this.src='https://placehold.co/100x100?text=I'">
      <p>${i.nome}</p>
      <strong>R$ ${i.preco.toFixed(2)}</strong>
    </div>
  `).join('');
}

window.adicionarAoCarrinho = (id) => {
  const item = menu.find(i => i.id == id);
  pedidoAtual.push({...item, quantidade: 1});
  mostrarToast(`${item.nome} adicionado`);
};

async function enviarPedido() {
  if (pedidoAtual.length === 0) return;
  const res = await fetch('/api/pedidos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mesa_id: mesaAtual.id, garcom_id: garcomLogado.usuario, itens: pedidoAtual })
  });
  if (res.ok) {
    mostrarAlerta("Pedido enviado!");
    voltarParaMesas();
  }
}

function voltarParaMesas() {
  document.getElementById('pedido').classList.add('hidden');
  document.getElementById('mesas').classList.remove('hidden');
  pedidoAtual = [];
  carregarMesas();
}

function mostrarAlerta(msg) { alert(msg); return Promise.resolve(); }
function mostrarToast(msg) { console.log("Toast:", msg); }
function fecharOpcoes() { document.getElementById('modal-opcoes').style.display = 'none'; }
window.abrirCardapioAdicionar = () => { fecharOpcoes(); abrirCardapio(); };
window.logout = logout;
window.realizarLogin = realizarLogin;
window.voltarParaMesas = voltarParaMesas;
window.enviarPedido = enviarPedido;
window.togglePausa = togglePausa;
