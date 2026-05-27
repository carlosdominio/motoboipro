let menu = [];
let mesas = [];
let timeoutPusher = null;
let configCozinhaCategorias = []; // Estado global das categorias da cozinha

let configCozinhaLoaded = false; // Flag para saber se já carregou do servidor

// Helper para verificar se um item deve ir para a cozinha (Sincronizado com Backend)
function isItemParaCozinha(item) {
    if (!item) return false;
    const envCozinha = item.enviar_cozinha;
    const cat = (item.categoria || '').trim().toUpperCase();

    // 1. Override Manual: Se for explicitamente 0/false ou 1/true, esse valor manda.
    if (envCozinha === 0 || envCozinha === false || envCozinha === '0' || envCozinha === 'false') return false;
    if (envCozinha === 1 || envCozinha === true || envCozinha === '1' || envCozinha === 'true') return true;

    // 2. Regra por Categoria: Se for NULL/Indefinido, verifica se a categoria está na lista da cozinha.
    if (configCozinhaCategorias.length > 0) {
        return configCozinhaCategorias.includes(cat);
    }

    // 3. Fallback: Se não há categorias configuradas e é NULL, por padrão vai para a cozinha.
    return true;
}

// --- SUPRESSÃO DE ERROS DE WEBSOCKET (Pusher/Socket.io) ---
window.onerror = function(msg, url, line) {
  if (msg && typeof msg === 'string' && (msg.includes('WebSocket') || msg.includes('CLOSING') || msg.includes('CLOSED'))) {
    return true; // Suprime o erro
  }
};

const originalWarn = console.warn;
console.warn = function(...args) {
  const msg = args[0] ? (args[0].message || args[0].toString()) : '';
  if (typeof msg === 'string' && (msg.includes('WebSocket') || msg.includes('CLOSING') || msg.includes('CLOSED'))) return;
  originalWarn.apply(console, args);
};

const originalError = console.error;
console.error = function(...args) {
  const msg = args[0] ? (args[0].message || args[0].toString()) : '';
  if (typeof msg === 'string' && (msg.includes('WebSocket') || msg.includes('CLOSING') || msg.includes('CLOSED'))) return;
  originalError.apply(console, args);
};
// ---------------------------------------------------------

// Interceptador global para redirecionar ao login se a sessão expirar
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    // Adiciona token ao header Authorization se existir no localStorage
    const token = localStorage.getItem('garcom_token');
    if (token) {
      if (!args[1]) args[1] = {};
      if (!args[1].headers) args[1].headers = {};
      args[1].headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      console.log(`🌐 FETCH INICIADO: ${args[0]}`, args[1] || {});
      const response = await originalFetch(...args);

      if (!response.ok) {
        console.error(`❌ ERRO DE FETCH [${response.status}] URL:`, args[0]);
        const text = await response.clone().text().catch(() => 'Erro ao ler corpo da resposta');
        console.error('📄 CORPO DO ERRO:', text.substring(0, 200));
      }

      if ((response.status === 401 || response.status === 403) && !args[0].includes('/api/login')) {
        console.warn("⚠️ Sessão expirada ou acesso negado (401/403).");
        
        localStorage.removeItem('garcom_logado');
        localStorage.removeItem('garcom_token');
        
        // Em vez de reload direto, avisa o usuário (isso pausa a execução e permite ver o console)
        window.location.reload();
        // console.log("🔄 Auto-reload cancelado para debug. Verifique o console.");
      }
      return response;
    } catch (error) {
      console.error("❌ ERRO DE REDE/FETCH:", error, "URL:", args[0]);
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

document.addEventListener('DOMContentLoaded', async () => {
  verificarSessao();
  atualizarInterfacePausa();
});

async function togglePausa() {
  if (!garcomLogado) return;
  
  const check = document.getElementById('check-pausa');
  // Se o checkbox está marcado, o garçom está ONLINE (Disponível na fila)
  // Se desmarcado, está PAUSADO.
  garcomPausado = !check.checked;
  localStorage.setItem('garcom_pausado', garcomPausado);
  
  try {
    await fetch('/api/garcom/pausar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pausado: garcomPausado })
    });
    
    atualizarInterfacePausa();
    const status = garcomPausado ? "PAUSADO" : "DISPONÍVEL";
    console.log(`👤 Status do garçom: ${status}`);
  } catch (e) {
    console.error("Erro ao sincronizar pausa:", e);
  }
}

function atualizarInterfacePausa() {
  const check = document.getElementById('check-pausa');
  const label = document.getElementById('label-pausa');
  const slider = document.getElementById('slider-pausa');
  
  if (!check || !label) return;
  
  // check.checked = true significa que ele está NA FILA (Disponível)
  check.checked = !garcomPausado;
  
  if (garcomPausado) {
    label.textContent = 'PAUSADO';
    label.style.color = '#e67e22'; // Laranja
    if (slider) slider.style.backgroundColor = '#ccc';
  } else {
    label.textContent = 'NA FILA';
    label.style.color = '#2ecc71'; // Verde
    if (slider) slider.style.backgroundColor = '#27ae60';
  }
}

function verificarSessao() {
  const salvo = localStorage.getItem('garcom_logado');
  if (salvo) {
    garcomLogado = JSON.parse(salvo);
    const telaLogin = document.getElementById('tela-login');
    if (telaLogin) telaLogin.style.display = 'none';
    const nomeExib = document.getElementById('garcom-nome-exibicao');
    if (nomeExib) nomeExib.textContent = `Garçom: ${garcomLogado.nome}`;
    iniciarApp();
  }
}
// FUNÇÕES DE SISTEMA (SUBSTITUIÇÃO DE ALERT/CONFIRM)
function mostrarAlerta(msg, titulo = "Aviso") {
  return new Promise(resolve => {
    document.getElementById('modal-sistema-titulo').innerText = titulo;
    document.getElementById('modal-sistema-mensagem').innerHTML = msg;
    document.getElementById('btn-sistema-cancelar').classList.add('hidden');
    document.getElementById('btn-sistema-confirmar').innerText = "OK";
    document.getElementById('btn-sistema-confirmar').style.background = "#27ae60";

    const modal = document.getElementById('modal-sistema');
    modal.style.display = 'flex';

    document.getElementById('btn-sistema-confirmar').onclick = () => {
      modal.style.display = 'none';
      resolve(true);
    };
  });
}

function mostrarConfirmacao(msg, titulo = "Confirmação", txtConfirmar = "Confirmar", txtCancelar = "Cancelar") {
  return new Promise(resolve => {
    document.getElementById('modal-sistema-titulo').innerText = titulo;
    document.getElementById('modal-sistema-mensagem').innerHTML = msg;
    document.getElementById('btn-sistema-cancelar').classList.remove('hidden');
    document.getElementById('btn-sistema-cancelar').innerText = txtCancelar;
    document.getElementById('btn-sistema-confirmar').innerText = txtConfirmar;
    document.getElementById('btn-sistema-confirmar').style.background = "#e74c3c";

    const modal = document.getElementById('modal-sistema');
    modal.style.display = 'flex';

    document.getElementById('btn-sistema-confirmar').onclick = () => {
      modal.style.display = 'none';
      resolve(true);
    };

    document.getElementById('btn-sistema-cancelar').onclick = () => {
      modal.style.display = 'none';
      resolve(false);
    };
  });
}

async function realizarLogin() {
  const usuario = document.getElementById('login-usuario').value;
  const senha = document.getElementById('login-senha').value;
  if (!usuario || !senha) return await mostrarAlerta("Preencha todos os campos", "Aviso");
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, senha })
  });
  if (res.ok) {
    const data = await res.json();
    garcomLogado = data.garcom;
    localStorage.setItem('garcom_logado', JSON.stringify(garcomLogado));
    if (data.token) localStorage.setItem('garcom_token', data.token); // Salva token
    location.reload();
  } else await mostrarAlerta("Usuário ou senha incorretos", "Erro de Login");
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  localStorage.removeItem('garcom_logado');
  localStorage.removeItem('garcom_token');
  location.reload();
}

async function iniciarApp() {
  await carregarConfigCozinha();
  await carregarMenu();
  await carregarMesas();
  await atualizarStatusCaixa();
  atualizarIconeSom();
  configurarEventos();
  configurarPusher();
  
  // Atualiza os cronômetros das mesas a cada 1 segundo (visual apenas)
  setInterval(() => {
    exibirMesas();
  }, 1000);

  // Recarrega os dados das mesas a cada 60 segundos para garantir sincronia
  setInterval(() => {
    carregarMesas();
  }, 60000);
}

async function carregarConfigCozinha() {
    try {
        const res = await fetch('/api/config/categorias-cozinha');
        if (res.ok) {
            const cats = await res.json();
            configCozinhaCategorias = cats.map(c => c.trim().toUpperCase());
            configCozinhaLoaded = true;
            console.log("🍳 Configurações de cozinha carregadas:", configCozinhaCategorias);
        }
    } catch (e) { console.error("Erro ao carregar configs cozinha:", e); }
}

async function atualizarStatusCaixa() {
  try {
    const res = await fetch('/api/caixa/status');
    const caixa = await res.json();
    caixaAberto = !!caixa;
    const badge = document.getElementById('caixa-status-badge');
    if (!badge) return;
    
    badge.style.display = 'inline-block';
    if (caixa) {
      badge.textContent = 'CAIXA ABERTO';
      badge.className = 'badge-caixa aberto';
    } else {
      badge.textContent = 'CAIXA FECHADO';
      badge.className = 'badge-caixa fechado';
    }
    // Sempre recarrega as mesas para aplicar o visual correto (bloqueado ou liberado)
    carregarMesas();
  } catch (e) { console.error('Erro status caixa:', e); }
}

let somAtivo = localStorage.getItem('garcom_som_ativo') !== 'false';
let audioDesbloqueado = false;
const audioNotificacao = new Audio('/notificacao.mp3');

function atualizarIconeSom() {
  const check = document.getElementById('check-som');
  const label = document.getElementById('label-som');
  if (check) check.checked = somAtivo;
  if (label) {
    label.innerText = somAtivo ? '🔔 SOM' : '🔕 MUDO';
    label.style.color = somAtivo ? '#2ecc71' : '#bdc3c7';
  }
  if (audioNotificacao) audioNotificacao.muted = !somAtivo;
}

function alternarSom() {
  const check = document.getElementById('check-som');
  somAtivo = check ? check.checked : !somAtivo;
  localStorage.setItem('garcom_som_ativo', somAtivo);
  atualizarIconeSom();
}

function tocarCampainha(suave = false) {
  if (somAtivo && audioDesbloqueado) {
    audioNotificacao.volume = suave ? 0.4 : 1.0;
    audioNotificacao.currentTime = 0;
    audioNotificacao.play().catch(e => console.warn('Erro ao tocar áudio:', e));
  }
}

async function configurarPusher() {
  try {
    const configRes = await fetch('/api/pusher-config');
    const pusherConfig = await configRes.json();

    console.log('📡 Inicializando Pusher no garçom...', pusherConfig.key);
    const pusher = new Pusher(pusherConfig.key, {
      cluster: pusherConfig.cluster,
      forceTLS: true
    });
    pusher.connection.bind('connected', () => {
      console.log('✅ Conectado ao Pusher com sucesso!');
      atualizarIconeSom();
    });

    pusher.connection.bind('error', function(err) {
      console.warn('❌ Erro de conexão no Pusher:', err);
    });

    const channel = pusher.subscribe('garconnexpress');
    console.log('📺 Inscrito no canal: garconnexpress');

    channel.bind('pedido-pronto', (data) => {
      console.log('📢 Evento recebido: pedido-pronto', data);
      // Garçom sempre toca para pedidos prontos
      tocarCampainha();

      // Mostra apenas alerta informativo
      mostrarAlerta(data.mensagem, "👨‍🍳 COZINHA: PEDIDO PRONTO!");

      clearTimeout(timeoutPusher);
      timeoutPusher = setTimeout(() => carregarMesas(), 50);
    });

    channel.bind('novo-pedido', (data) => {
      console.log('📢 Evento recebido: novo-pedido', data);
      // Garçom NÃO toca som para novo pedido (apenas ADM/Cozinha)
      clearTimeout(timeoutPusher);
      timeoutPusher = setTimeout(() => carregarMesas(), 50);
    });

    channel.bind('status-atualizado', (data) => {
      console.log('📢 Status atualizado no garçom:', data);
      
      clearTimeout(timeoutPusher);
      timeoutPusher = setTimeout(() => {
        console.log('🔄 Recarregando mesas devido a atualização de status...');
        carregarMesas();
        if (data) {
          const nMesa = data.mesa_numero || data.mesa_id || 'X';
          let msg = '';
          
          if (data.status === 'liberada') msg = `✅ Mesa ${nMesa} liberada`;
          else if (data.status === 'servido') msg = `🚚 Pedido da Mesa ${nMesa} entregue!`;
          else if (data.status === 'itens_atualizados') msg = `📝 Pedido da Mesa ${nMesa} atualizado pelo Admin`;
          else if (data.status === 'cancelado') msg = `❌ Pedido da Mesa ${nMesa} CANCELADO pelo Admin`;

          if (msg) {
            mostrarToast(msg);
            // Toca som suave para notificações vindas do Admin ou sistema
            tocarCampainha(true);
          }
        }
      }, 50);
    });

    channel.bind('status-caixa-atualizado', (data) => {
      console.log('📢 Evento recebido: status-caixa-atualizado', data);
      atualizarStatusCaixa();
    });

    channel.bind('garcom-status-alterado', (data) => {
      console.log('📢 Status do garçom alterado remotamente:', data);
      if (garcomLogado && parseInt(data.garcom_id) === parseInt(garcomLogado.id)) {
        garcomPausado = !!data.pausado;
        localStorage.setItem('garcom_pausado', garcomPausado);
        atualizarInterfacePausa();
        
        const statusTxt = garcomPausado ? 'PAUSADO' : 'DISPONÍVEL (NA FILA)';
        mostrarToast(`Status alterado pelo Admin: ${statusTxt}`);
      }
    });

    channel.bind('chamado-garcom', (data) => {
      console.log('📢 Evento recebido: chamado-garcom', data);
      tocarCampainha();
      mostrarAlerta(data.mensagem, "🛎️ CHAMADO DE CLIENTE");
    });

    channel.bind('menu-atualizado', (data) => {
      console.log('📢 Evento recebido: menu-atualizado', data);
      carregarMenu();
      carregarMesas(); // Sincroniza mesas também pois estoque pode afetar visual da mesa
    });

    channel.bind('rascunho-recebido', (data) => {
      console.log('📢 Evento recebido: rascunho-recebido', data);
      tocarCampainha();
      mostrarRascunho(data);
    });

    channel.bind('solicitacao-fechamento-cliente', (data) => {
      console.log('📢 Evento recebido: solicitacao-fechamento-cliente', data);
      tocarCampainha();
      mostrarAlerta(data.mensagem, "🙋‍♂️ SOLICITAÇÃO DE FECHAMENTO");
      
      clearTimeout(timeoutPusher);
      timeoutPusher = setTimeout(() => carregarMesas(), 50);
    });

    // Desbloqueia áudio no primeiro clique do usuário
    document.addEventListener('click', () => {
      if (audioDesbloqueado) return;
      audioDesbloqueado = true;
      
      audioNotificacao.muted = true;
      audioNotificacao.play().then(() => {
          audioNotificacao.pause();
          audioNotificacao.currentTime = 0;
          // Só desmuda se o som estiver ativo
          if (somAtivo) {
              audioNotificacao.muted = false;
          }
          console.log('🔊 Áudio preparado!');
      }).catch(e => console.log('Erro ao preparar áudio:', e));
    }, { once: true });

  } catch (e) { console.warn('Pusher init error:', e); }
}

async function mostrarRascunho(data) {
  const itensHtml = data.itens.map(i => `<li>${i.quantidade}x ${i.nome}</li>`).join('');
  const msgHtml = `
    <div style="text-align: left; background: #fdf9f3; padding: 15px; border-radius: 10px; border: 1px solid #f3e5ab; color: #2f3542;">
      <p style="margin-bottom: 10px; font-weight: bold; color: #d35400;">Mesa ${data.mesa_numero} enviou um rascunho:</p>
      <ul style="padding-left: 20px; margin-bottom: 15px;">${itensHtml}</ul>
      <p style="font-size: 0.85rem; color: #7f8c8d; border-top: 1px dashed #f3e5ab; pt: 10px;">Deseja carregar estes itens no carrinho agora?</p>
    </div>
  `;

  // Fallback para o modal do sistema adaptado
  document.getElementById('modal-sistema-titulo').innerText = "📝 RASCUNHO RECEBIDO";
  document.getElementById('modal-sistema-mensagem').innerHTML = msgHtml;
  
  const btnCancelar = document.getElementById('btn-sistema-cancelar');
  const btnConfirmar = document.getElementById('btn-sistema-confirmar');
  
  btnCancelar.classList.remove('hidden');
  btnCancelar.innerText = "SÓ VER";
  btnCancelar.style.background = "#95a5a6";
  
  btnConfirmar.innerText = "ACEITAR / CARREGAR";
  btnConfirmar.style.background = "#f39c12";

  const modal = document.getElementById('modal-sistema');
  modal.style.display = 'flex';

  btnConfirmar.onclick = () => {
    modal.style.display = 'none';
    aceitarRascunho(data);
  };

  btnCancelar.onclick = () => {
    modal.style.display = 'none';
  };
}

async function aceitarRascunho(data) {
  // 1. Localiza a mesa no grid local
  const mesa = mesas.find(m => m.id === data.mesa_id || m.numero == data.mesa_numero);
  if (!mesa) return;

  mesaAtual = mesa;
  
  // 2. Verifica se já existe um pedido aberto na mesa (para adicionar a ele)
  pedidoAbertoNaMesa = null;
  try {
    const res = await fetch(`/api/pedidos/mesa/${mesa.id}`);
    if (res.ok) {
      const dados = await res.json();
      if (dados) pedidoAbertoNaMesa = dados;
    }
  } catch (e) { console.error("Erro ao checar pedido existente:", e); }

  // 3. Abre a tela de cardápio (limpa o carrinho atual do garçom)
  abrirCardapio();

  // 4. Popula o carrinho com os itens do rascunho
  for (const itemDraft of data.itens) {
    const menuItem = menu.find(m => m.id === itemDraft.menu_id);
    if (menuItem) {
      // Adiciona a quantidade exata enviada pelo cliente
      for (let i = 0; i < itemDraft.quantidade; i++) {
        adicionarItemPedido(menuItem);
      }
    }
  }

  // 5. Abre o modal do carrinho automaticamente para o garçom revisar e enviar
  toggleCarrinho();
  
  mostrarToast(`Mesa ${data.mesa_numero}: Itens carregados no carrinho!`);
}

function mostrarToast(mensagem) {
  const toastExistente = document.querySelector('.toast-notificacao');
  if (toastExistente) toastExistente.remove();
  const toast = document.createElement('div');
  toast.className = 'toast-notificacao';
  toast.innerText = mensagem;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 500);
    }, 4000);
  }, 100);
}

async function carregarMenu() {
  const res = await fetch('/api/menu');
  if (!res.ok) return; // Evita crash se não autenticado
  menu = await res.json();
  if (Array.isArray(menu)) {
    // Verifica se a categoria atual ainda existe
    const categoriasExistentes = ['todas', ...new Set(menu.map(i => i.categoria))];
    if (!categoriasExistentes.includes(categoriaAtual)) {
      categoriaAtual = 'todas';
      sessionStorage.setItem('garcom_categoria_atual', 'todas');
    }
    exibirMenu(categoriaAtual);
    // Se as categorias já foram renderizadas, atualiza o visual
    const container = document.getElementById('categorias');
    if (container && container.innerHTML !== '') {
        configurarEventos(); 
    }
  }
}

async function carregarMesas() {
  const res = await fetch('/api/mesas');
  // Se der erro 401 ou outro, não tenta converter para JSON nem exibir, para evitar o "map is not a function"
  if (!res.ok) return; 
  mesas = await res.json();
  if (Array.isArray(mesas)) exibirMesas();
}

function calcularMinutos(dataIso) {
  if (!dataIso) return 0;
  try {
    const data = new Date(dataIso);
    const agora = new Date();
    const diffMs = agora - data;
    // Se a diferença for negativa (relógio do cliente atrasado em relação ao servidor), retorna 0
    const minutos = Math.floor(diffMs / 60000);
    return minutos > 0 ? minutos : 0;
  } catch (e) {
    return 0;
  }
}

let filtroMesaAtual = 'todas';

function filtrarMesas(filtro, element) {
  filtroMesaAtual = filtro;
  
  // Atualiza visual dos botões de filtro
  document.querySelectorAll('.btn-filtro-mesa').forEach(btn => {
    btn.classList.remove('ativa');
    btn.style.background = '#95a5a6';
  });
  
  if (element) {
    element.classList.add('ativa');
    element.style.background = filtro === 'fechamentos' ? '#f1c40f' : '#3498db';
  }
  
  exibirMesas();
}

function exibirMesas() {
  const grid = document.getElementById('mesas-grid');
  if (!grid) return;

  let mesasExibidas = mesas;
  if (filtroMesaAtual === 'fechamentos') {
    mesasExibidas = mesas.filter(m => m.solicitou_fechamento || m.status === 'fechando');
  }

  grid.innerHTML = mesasExibidas.map(mesa => {
    let cronometroHtml = '';
    let classeAlerta = '';
    let classeBloqueada = '';
    let statusTexto = mesa.status.toUpperCase();

    // Bloqueia se o caixa estiver fechado
    if (!caixaAberto) {
      classeBloqueada = 'caixa-fechado';
      statusTexto = 'CAIXA FECHADO';
    } else if (mesa.status === 'ocupada' || mesa.status === 'fechando') {
      const eMeuPedido = mesa.garcom_id === garcomLogado.usuario;
      
      // DESTAQUE PARA SOLICITAÇÃO DE FECHAMENTO DO CLIENTE (Prioridade)
      if (mesa.solicitou_fechamento && mesa.status !== 'fechando') {
        classeAlerta = 'solicitacao-fechamento';
        statusTexto = '🙋‍♂️ CLIENTE SOLICITA FECHAMENTO';
      } else if (!eMeuPedido && mesa.garcom_id) {
        // SE NÃO É MEU E TEM GARÇOM, BLOQUEIA IMEDIATAMENTE (Independente de pedido_created_at)
        classeBloqueada = 'bloqueada';
        statusTexto = `OCUPADA (${mesa.garcom_id})`;
      } else if (!mesa.pedido_created_at && !mesa.pedido_status && mesa.status === 'ocupada') {
        statusTexto = '📱 AGUARDANDO CLIENTE';
        classeAlerta = 'cliente-acessando';
      } else if (mesa.status === 'fechando') {
        statusTexto = '💰 AGUARDANDO CAIXA';
        classeAlerta = 'aguardando-fechamento';
      } else if (mesa.pedido_status === 'servido') {
        statusTexto = 'OCUPADA';
      }
      
      // DESTAQUE PARA PEDIDO PRONTO NA COZINHA (Se não estiver solicitando fechamento)
      if (mesa.pedido_status === 'pronto' && !mesa.solicitou_fechamento) {
        classeAlerta = 'pedido-pronto-alert';
        statusTexto = '🔥 PRONTO PARA ENTREGA';
      }

      // SÓ MOSTRA O CRONÔMETRO SE TIVER PEDIDO E NÃO ESTIVER "SERVIDO"
      if (mesa.pedido_created_at && mesa.pedido_status !== 'servido') {
        const minutos = calcularMinutos(mesa.pedido_created_at);
        cronometroHtml = `<div class="cronometro">⏱️ ${minutos} min</div>`;
        if (minutos >= 10 && mesa.status !== 'fechando' && !mesa.solicitou_fechamento) classeAlerta = 'alerta-atraso';
      }
    }

    return `
      <div class="mesa ${mesa.status} ${classeAlerta} ${classeBloqueada}" data-id="${mesa.id}" style="cursor:pointer">
        <h3>Mesa ${mesa.numero}</h3>
        <p style="font-weight:bold">${statusTexto}</p>
        ${cronometroHtml}
      </div>
    `;
  }).join('');

  document.querySelectorAll('.mesa').forEach(mesaEl => {
    mesaEl.onclick = async () => {
      if (!caixaAberto) {
        await mostrarAlerta("O CAIXA ESTÁ FECHADO!", "Aviso");
        return;
      }
      const mesaSelecionada = mesas.find(m => m.id == mesaEl.dataset.id);
      mesaAtual = mesaSelecionada;
      
      if (mesaSelecionada.status === 'ocupada' || mesaSelecionada.status === 'fechando') {
        const eMeuPedido = mesaSelecionada.garcom_id === garcomLogado.usuario;
        // BLOQUEIO REFORÇADO: Se a mesa tem um garçom e não é você, bloqueia o clique
        if (!eMeuPedido && mesaSelecionada.garcom_id) {
          await mostrarAlerta(`Atendida por: ${mesaSelecionada.garcom_id}`, "Mesa Ocupada");
          return;
        }
      }
      
      mostrarOpcoesMesa(mesaSelecionada);
    };
  });
}

async function mostrarOpcoesMesa(mesa) {
  // Reset
  pedidoAbertoNaMesa = null;

  if (mesa.status === 'ocupada' || mesa.status === 'fechando') {
    try {
      const res = await fetch(`/api/pedidos/mesa/${mesa.id}`);
      if (res.ok) {
        const dados = await res.json();
        if (dados) pedidoAbertoNaMesa = dados;
      }
    } catch (e) { console.error("Erro ao buscar pedido:", e); }
  }

  // Ajusta visibilidade dos botões
  const btnVerItens = document.querySelector('.btn-ver-itens');
  const btnFecharConta = document.querySelector('.btn-fechar-conta');
  const btnAdd = document.querySelector('.btn-adicionar');
  const btnGerarCodigo = document.querySelector('.btn-gerar-codigo');
  const btnCancelarCodigo = document.querySelector('.btn-cancelar-codigo');
  
  if (btnVerItens) btnVerItens.style.display = pedidoAbertoNaMesa ? 'block' : 'none';
  if (btnFecharConta) btnFecharConta.style.display = (pedidoAbertoNaMesa && mesa.status !== 'fechando') ? 'block' : 'none';
  if (btnAdd) btnAdd.innerText = pedidoAbertoNaMesa ? '➕ Adicionar mais itens' : '📝 Abrir Mesa / Pedido';

  // Lógica dos botões de código digital e exibição do código ativo
  let tituloModal = `Mesa ${mesa.numero}`;
  
  if (mesa.status === 'livre') {
    if (btnGerarCodigo) btnGerarCodigo.style.display = 'block';
    if (btnCancelarCodigo) btnCancelarCodigo.style.display = 'none';
  } else if (mesa.status === 'ocupada' && !pedidoAbertoNaMesa) {
    // Mesa ocupada sem pedido = Mesa aberta via código digital
    if (btnGerarCodigo) btnGerarCodigo.style.display = 'none';
    if (btnCancelarCodigo) btnCancelarCodigo.style.display = 'block';
    
    // Adiciona o código ao título para o garçom ver
    if (mesa.codigo_acesso) {
      tituloModal = `Mesa ${mesa.numero} [Código: ${mesa.codigo_acesso}]`;
    }
  } else {
    // Mesa ocupada com pedido real
    if (btnGerarCodigo) btnGerarCodigo.style.display = 'none';
    if (btnCancelarCodigo) btnCancelarCodigo.style.display = 'none';
    
    // Mesmo com pedido, se houver código ativo, mostra no título
    if (mesa.codigo_acesso) {
      tituloModal = `Mesa ${mesa.numero} [Código: ${mesa.codigo_acesso}]`;
    }
  }

  document.getElementById('modal-mesa-titulo').textContent = tituloModal;
  document.getElementById('modal-opcoes').style.display = 'block';
}

async function verItensDaMesa() {
  if (!mesaAtual) return;
  try {
    const resPedido = await fetch(`/api/pedidos/mesa/${mesaAtual.id}`);
    pedidoAbertoNaMesa = await resPedido.json();
    if (!pedidoAbertoNaMesa) return await mostrarAlerta("Nenhum pedido ativo.", "Aviso");
    const resItens = await fetch(`/api/pedidos/${pedidoAbertoNaMesa.id}/itens`);
    const itens = await resItens.json();
    
    // Agora consideramos 'pendente' e 'pronto' como pendentes de entrega
    const pendentes = itens.filter(i => i.status === 'pendente' || i.status === 'pronto');
    const entregues = itens.filter(i => i.status === 'entregue');

    let html = '';
    if (pendentes.length > 0) {
      html += `<h4 style="color:#e74c3c; margin-bottom:10px; border-bottom:2px solid #e74c3c;">⏳ PARA ENTREGAR AGORA</h4>`;
      html += pendentes.map(item => {
        const isPronto = item.status === 'pronto';
        const emPreparo = item.status === 'pendente' && isItemParaCozinha(item);
        
        let bgColor = '#fff5f5';
        let statusLabel = '';
        
        if (isPronto) {
          bgColor = '#e8f8f5'; // Verde claro para pronto
          statusLabel = '<span style="background:#2ecc71; color:white; padding:2px 6px; border-radius:4px; font-size:10px; margin-left:5px; white-space:nowrap; display:inline-block; vertical-align:middle;">PRONTO</span>';
        } else if (emPreparo) {
          bgColor = '#fff9f0'; // Laranja muito claro para preparo
          statusLabel = '<span style="background:#f39c12; color:white; padding:2px 6px; border-radius:4px; font-size:10px; margin-left:5px; white-space:nowrap; display:inline-block; vertical-align:middle;">EM PREPARO</span>';
        }

        return `
          <div style="border-bottom: 1px solid #eee; padding: 10px 0; display: flex; justify-content: space-between; align-items: center; background:${bgColor};">
            <div style="flex-grow: 1; text-align: left;">
              <p><strong>${item.quantidade}x ${item.nome}</strong> ${statusLabel}</p>
              ${item.observacao ? `<small style="color:#e67e22;" id="obs-${item.id}"></small>` : ''}
            </div>
            <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
              <p style="white-space: nowrap; font-weight: bold;">R$ ${(item.preco * item.quantidade).toFixed(2)}</p>
              <button onclick="removerItemDoPedido(${item.id})" style="background: #e74c3c; color: white; border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer; width: auto !important; margin: 0 !important;">🗑️</button>
            </div>
          </div>
        `;
      }).join('');
      html += `<button class="btn-opcoes" onclick="marcarComoServido(${pedidoAbertoNaMesa.id})" style="background-color: #27ae60; margin: 1rem 0;">🚚 ENTREGUEI ESTES ITENS</button>`;
    }

    if (entregues.length > 0) {
      html += `<h4 style="color:#27ae60; margin: 20px 0 10px 0; border-bottom:2px solid #27ae60;">✅ JÁ ESTÃO NA MESA</h4>`;
      html += entregues.map(item => `
        <div style="border-bottom: 1px solid #eee; padding: 10px 0; display: flex; justify-content: space-between; align-items: center; opacity:0.7;">
          <div style="flex-grow: 1; text-align: left;">
            <p>${item.quantidade}x ${item.nome}</p>
          </div>
          <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
            <p style="white-space: nowrap;">R$ ${(item.preco * item.quantidade).toFixed(2)}</p>
            <button onclick="removerItemDoPedido(${item.id})" style="background: #e74c3c; color: white; border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer; width: auto !important; margin: 0 !important;">🗑️</button>
          </div>
        </div>
      `).join('');
    }

    const lista = document.getElementById('lista-itens-mesa');
    lista.innerHTML = html || '<p>Nenhum item no pedido.</p>';
  
    // Sanitizar observações
    if (itens) {
      itens.forEach(item => {
        if (item.observacao) {
          const obsElement = document.getElementById(`obs-${item.id}`);
          if (obsElement) {
            obsElement.textContent = `Obs: ${item.observacao}`;
          }
        }
      });
    }

    const totalEntregue = entregues.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);
    const totalPendente = pendentes.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);
    const totalConsumido = totalEntregue + totalPendente;
    const taxaServico = totalConsumido * 0.10;
    const totalGeral = totalConsumido + taxaServico;

    document.getElementById('total-resumo-mesa').innerHTML = `
      <div style="text-align: right; border-top: 2px solid #eee; padding-top: 10px;">
        <p style="color: #7f8c8d; font-size: 0.9rem; white-space: nowrap;">Subtotal Consumido: <strong>R$ ${totalConsumido.toFixed(2)}</strong></p>
        <p style="color: #3498db; font-size: 0.9rem; white-space: nowrap;">Taxa de Serviço (10%): <strong>R$ ${taxaServico.toFixed(2)}</strong></p>
        <p style="font-size: 1.2rem; margin-top: 8px; color: #2c3e50; border-top: 1px dashed #ddd; padding-top: 5px; white-space: nowrap;">Total Final: <strong>R$ ${totalGeral.toFixed(2)}</strong></p>
      </div>
    `;
    
    document.getElementById('resumo-mesa-titulo').textContent = `Resumo - Mesa ${mesaAtual.numero}`;
    
    fecharOpcoes();
    document.getElementById('modal-resumo-mesa').style.display = 'block';
  } catch (error) { await mostrarAlerta("Erro ao carregar dados.", "Erro"); }
}

async function removerItemDoPedido(itemId) {
  if (!await mostrarConfirmacao("Remover este item do pedido?", "Remover Item")) return;
  try {
    const res = await fetch(`/api/pedidos/itens/${itemId}`, { method: 'DELETE' });
    if (res.ok) {
      // Recarrega o resumo da mesa para mostrar os dados atualizados
      verItensDaMesa();
    }
  } catch (error) { await mostrarAlerta("Erro ao excluir item.", "Erro"); }
}

async function marcarComoServido(idPedido) {
  try {
    // Busca itens atuais para saber se tem algo em preparo
    const resItens = await fetch(`/api/pedidos/${idPedido}/itens`);
    const itens = await resItens.json();

    const emPreparoCozinha = itens.filter(i => i.status === 'pendente' && isItemParaCozinha(i));
    const prontosOuForaCozinha = itens.filter(i => i.status === 'pronto' || (i.status === 'pendente' && !isItemParaCozinha(i)));

    if (emPreparoCozinha.length > 0) {
      // Se houver itens fora da cozinha ou prontos para entregar...
      if (prontosOuForaCozinha.length > 0) {
        const confirmParcial = await mostrarConfirmacao(
          `<div style="text-align: center;">
            <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🚚</div>
            <p style="font-weight: bold; color: #e67e22;">ENTREGA PARCIAL</p>
            <p style="font-size: 0.95rem; margin-bottom: 10px;">Existem <strong>${emPreparoCozinha.length} itens</strong> ainda na cozinha. Deseja entregar apenas as bebidas e itens prontos agora?</p>
            <p style="font-size: 0.8rem; color: #7f8c8d;">O cronômetro continuará rodando para os itens que ficarem.</p>
          </div>`,
          "Cozinha em Andamento",
          "Sim, Entregar Prontos",
          "Não, Cancelar"
        );

        if (!confirmParcial) return;

        const res = await fetch(`/api/pedidos/${idPedido}/marcar-entregue`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apenasProntos: true })
        });

        if (res.ok) {
          await mostrarAlerta("Itens prontos marcados como entregues! Os demais continuam em preparo.", "Entrega Realizada");
          verItensDaMesa();
          carregarMesas();
        }
      } else {
        // Se SÓ houver itens de cozinha em preparo, bloqueio total
        const msgHtml = `
          <div style="text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 1rem;">👨‍🍳</div>
            <p style="font-weight: bold; color: #e74c3c; font-size: 1.1rem; margin-bottom: 10px;">AGUARDANDO COZINHA!</p>
            <p style="color: #2c3e50; margin-bottom: 15px;">Todos os itens deste pedido estão sendo feitos na cozinha agora.</p>
            <div style="background: #fff5f5; padding: 10px; border-radius: 8px; border: 1px solid #feb2b2; text-align: left; font-size: 0.9rem;">
              ${emPreparoCozinha.map(i => `• ${i.quantidade}x ${i.nome}`).join('<br>')}
            </div>
            <p style="font-size: 0.8rem; color: #666; margin-top: 15px;">Você só poderá confirmar a entrega quando a cozinha finalizar ou quando houver bebidas prontas.</p>
          </div>
        `;
        return await mostrarAlerta(msgHtml, "Cozinha Ativa");
      }
      return;
    }

    // Se não tem nada em preparo na cozinha, confirmação normal de tudo
    if (!await mostrarConfirmacao("Deseja marcar todos os itens como entregues?", "Entregar Pedido")) return;

    const res = await fetch(`/api/pedidos/${idPedido}/marcar-entregue`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apenasProntos: false })
    });

    if (res.ok) {
      await mostrarAlerta("Sucesso! Todos os itens foram entregues.", "Sucesso");
      document.getElementById('modal-resumo-mesa').style.display = 'none';
      carregarMesas();
    }
  } catch (error) { await mostrarAlerta("Erro ao atualizar status de entrega.", "Erro"); }
}
function fecharResumoMesa() {
  document.getElementById('modal-resumo-mesa').style.display = 'none';
  document.getElementById('modal-opcoes').style.display = 'block';
}

function fecharOpcoes() {
  document.getElementById('modal-opcoes').style.display = 'none';
}

function abrirCardapioAdicionar() {
  fecharOpcoes();
  abrirCardapio();
}

function abrirCardapio() {
  const mesaTxt = document.getElementById('mesa-atual');
  if (mesaTxt) mesaTxt.textContent = pedidoAbertoNaMesa ? `${mesaAtual.numero} (+ itens)` : mesaAtual.numero;

  // Resetar visual das categorias para "Todas"
  document.querySelectorAll('.categoria').forEach(c => {
    c.classList.toggle('ativa', c.dataset.categoria === 'todas');
  });

  document.getElementById('mesas').classList.add('hidden');
  document.getElementById('pedido').classList.remove('hidden');
  document.getElementById('btn-header-mesas').style.display = 'flex';
  // Esconde o modal do carrinho caso esteja aberto
  const modalCarrinho = document.getElementById('modal-carrinho');
  if (modalCarrinho) {
    modalCarrinho.style.display = 'none';
    document.body.style.overflow = ''; // Destrava o scroll
  }

  pedidoAtual = [];
  window.pedidoObservacaoGeral = ''; // Reset observação geral
  exibirResumoPedido();
  exibirMenu('todas');
}
function toggleCarrinho() {
  const modal = document.getElementById('modal-carrinho');
  if (!modal) return;
  
  if (modal.style.display === 'flex') {
    modal.style.display = 'none';
    document.body.style.overflow = ''; // Destrava o scroll
  } else {
    if (pedidoAtual.length === 0) {
      mostrarAlerta("O carrinho está vazio!", "Aviso");
      return;
    }
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // Trava o scroll
    exibirResumoPedido();
  }
}

function voltarParaMesas() {
  if (pedidoAtual.length > 0) {
    mostrarConfirmacao("Você tem itens no carrinho. Deseja realmente voltar e descartar este pedido?", "Aviso", "Sim, descartar", "Não, manter").then(confirm => {
      if (confirm) {
        document.getElementById('pedido').classList.add('hidden');
        document.getElementById('mesas').classList.remove('hidden');
        document.getElementById('btn-header-mesas').style.display = 'none';
        document.body.style.overflow = ''; // Destrava o scroll
      }
    });
  } else {
    document.getElementById('pedido').classList.add('hidden');
    document.getElementById('mesas').classList.remove('hidden');
    document.getElementById('btn-header-mesas').style.display = 'none';
  }
}

async function finalizarEDesocupar() {
  if (!mesaAtual || !pedidoAbertoNaMesa) return;

  try {
    const resItens = await fetch(`/api/pedidos/${pedidoAbertoNaMesa.id}/itens`);
    if (!resItens.ok) {
      const errorText = await resItens.text();
      console.error("Erro do servidor:", errorText);
      return await mostrarAlerta("O servidor demorou para responder (Timeout). Tente novamente em alguns segundos.", "Erro de Conexão");
    }
    const itens = await resItens.json();
    
    // Separa itens por tipo de pendência
    const emPreparo = itens.filter(i => i.status === 'pendente' && isItemParaCozinha(i));
    const prontosParaEntrega = itens.filter(i => (i.status === 'pendente' && !i.enviar_cozinha) || i.status === 'pronto');
    const temPendentesGeral = emPreparo.length > 0 || prontosParaEntrega.length > 0;

    if (emPreparo.length > 0) {
      // MODAL ESPECÍFICO PARA COZINHA (SOLICITADO PELO USUÁRIO)
      const msgHtml = `
        <div style="text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">👨‍🍳</div>
          <p style="font-weight: bold; color: #e74c3c; font-size: 1.1rem; margin-bottom: 10px;">PEDIDO EM PREPARO NA COZINHA!</p>
          <p style="color: #2c3e50; margin-bottom: 15px;">Existem <strong>${emPreparo.length} itens</strong> sendo preparados agora. Você não pode fechar a conta enquanto a cozinha não finalizar!</p>
          <div style="background: #fff5f5; padding: 10px; border-radius: 8px; border: 1px solid #feb2b2; text-align: left; font-size: 0.9rem;">
            ${emPreparo.map(i => `• ${i.quantidade}x ${i.nome}`).join('<br>')}
          </div>
        </div>
      `;
      return await mostrarAlerta(msgHtml, "Atenção: Cozinha Ativa");
    }

    if (prontosParaEntrega.length > 0) {
      // Outras situações de pendência (bebidas ou prontos)
      return await mostrarAlerta(`Existem <strong>${prontosParaEntrega.length} itens</strong> que já estão prontos mas ainda não foram marcados como entregues. Entregue-os primeiro para poder fechar a conta!`, "Itens não Entregues");
    }

    const subtotal = itens.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
    const totalComTaxa = Math.round(subtotal * 1.10 * 100) / 100;

    const elTotal = document.getElementById('total-fechamento-garcom');
    const elRecebido = document.getElementById('valor-recebido-garcom');
    const elTroco = document.getElementById('troco-garcom');
    const elForma = document.getElementById('forma-pagamento-garcom');

    if (elTotal) elTotal.textContent = `R$ ${totalComTaxa.toFixed(2)}`;
    if (elRecebido) elRecebido.value = '';
    if (elTroco) elTroco.textContent = 'R$ 0,00';
    if (elForma) elForma.value = 'Dinheiro';
    
    // Zera divisão de conta
    const elPessoas = document.getElementById('divisao-pessoas-garcom');
    const elValorPessoa = document.getElementById('valor-pessoa-garcom');
    if (elPessoas) elPessoas.value = '1';
    if (elValorPessoa) elValorPessoa.textContent = `R$ ${totalComTaxa.toFixed(2)}`;

    alternarCampoTroco();

    // Fecha o modal de opções antes de abrir o de fechamento
    fecharOpcoes();
    
    const modalFechamento = document.getElementById('modal-fechamento-garcom');
    if (modalFechamento) modalFechamento.style.display = 'flex';

  } catch (error) {
    console.error("Erro no fechamento:", error);
    await mostrarAlerta("Erro ao carregar dados do pedido.", "Erro");
  }
}

function alternarCampoTroco() {
  const elForma = document.getElementById('forma-pagamento-garcom');
  const elCampoRecebido = document.getElementById('campo-recebido-garcom');
  if (elForma && elCampoRecebido) {
    elCampoRecebido.style.display = (elForma.value === 'Dinheiro') ? 'block' : 'none';
  }
}

function calcularTrocoGarcom() {
  const elTotal = document.getElementById('total-fechamento-garcom');
  const elRecebido = document.getElementById('valor-recebido-garcom');
  const elTroco = document.getElementById('troco-garcom');
  const elPessoas = document.getElementById('divisao-pessoas-garcom');
  const elValorPessoa = document.getElementById('valor-pessoa-garcom');

  if (elTotal && elRecebido && elTroco) {
    const total = parseFloat(elTotal.textContent.replace('R$ ', '')) || 0;
    const recebido = parseFloat(elRecebido.value) || 0;
    const troco = recebido > total ? recebido - total : 0;
    elTroco.textContent = `R$ ${troco.toFixed(2)}`;

    // Divisão de conta
    const pessoas = parseInt(elPessoas.value) || 1;
    const valorPessoa = total / pessoas;
    if (elValorPessoa) elValorPessoa.textContent = `R$ ${valorPessoa.toFixed(2)}`;
  }
}

function cancelarFechamentoGarcom() {
  const modalFechamento = document.getElementById('modal-fechamento-garcom');
  if (modalFechamento) modalFechamento.style.display = 'none';
  
  const modalOpcoes = document.getElementById('modal-opcoes');
  if (modalOpcoes) modalOpcoes.style.display = 'block';
}

async function confirmarSolicitacaoFechamento() {
  const elForma = document.getElementById('forma-pagamento-garcom');
  const elRecebido = document.getElementById('valor-recebido-garcom');
  const elTotal = document.getElementById('total-fechamento-garcom');
  const elPessoas = document.getElementById('divisao-pessoas-garcom');

  if (!elForma || !elTotal) return;

  const forma = elForma.value;
  const recebido = elRecebido ? (parseFloat(elRecebido.value) || 0) : 0;
  const total = parseFloat(elTotal.textContent.replace('R$ ', '')) || 0;
  const troco = recebido > total ? recebido - total : 0;
  const num_pessoas = elPessoas ? (parseInt(elPessoas.value) || 1) : 1;
  const valor_por_pessoa = total / num_pessoas;

  if (forma === 'Dinheiro' && recebido < total && recebido > 0) {
    if (!await mostrarConfirmacao("O valor recebido é menor que o total. Deseja continuar?", "Aviso")) return;
  }

  try {
    const res = await fetch(`/api/pedidos/${pedidoAbertoNaMesa.id}/solicitar-fechamento`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        mesa_id: mesaAtual.id,
        forma_pagamento: forma,
        valor_recebido: recebido,
        troco: troco,
        total: total,
        num_pessoas: num_pessoas,
        valor_por_pessoa: valor_por_pessoa
      })
    });

    if (res.ok) {
      const modalFechamento = document.getElementById('modal-fechamento-garcom');
      if (modalFechamento) modalFechamento.style.display = 'none';
      
      await mostrarAlerta("Solicitação de fechamento enviada ao caixa!", "Sucesso");
      carregarMesas();
    } else {
      throw new Error("Falha na solicitação");
    }
  } catch (error) {
    await mostrarAlerta("Erro ao enviar solicitação.", "Erro");
  }
}

async function exibirMenu(categoria) {
  const grid = document.getElementById('menu-grid');
  if (!grid) return;
  
  if (!categoria) {
    const elAtivo = document.querySelector('.categoria.ativa');
    categoria = elAtivo ? elAtivo.dataset.categoria : 'todas';
  }

  const itens = categoria === 'todas' ? menu : menu.filter(item => item.categoria === categoria);
  grid.innerHTML = itens.map(item => {
    const itemNoPedido = pedidoAtual.find(p => p.menu_id === item.id);
    const qtdNoCarrinho = itemNoPedido ? itemNoPedido.quantidade : 0;

    // Lógica de estoque: subtrai o que já está no carrinho local para mostrar o real disponível
    const estoqueBase = (item.estoque !== null && item.estoque !== undefined) ? parseInt(item.estoque) : -1;
    const temEstoqueDefinido = estoqueBase !== -1;
    const estoqueExibido = temEstoqueDefinido ? (estoqueBase - qtdNoCarrinho) : -1;
    
    const esgotado = temEstoqueDefinido && estoqueExibido <= 0;
    const emPromocao = item.em_promocao === 1 || item.em_promocao === true;

    return `
      <div class="item-menu ${esgotado ? 'esgotado' : ''} ${emPromocao ? 'com-promo' : ''}" data-id="${item.id}" style="position: relative; ${esgotado ? 'opacity: 0.6; filter: grayscale(1);' : ''}">
        <!-- Badge de Quantidade (TOPO ESQUERDO) -->
        ${qtdNoCarrinho > 0 ? `<div class="badge-qtd" style="position: absolute; top: 5px; left: 5px; right: auto;">${qtdNoCarrinho}</div>` : ''}
        
        <!-- Container de Info (TOPO DIREITO) -->
        <div style="position: absolute; top: 6px; right: 6px; z-index: 10; display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
          <!-- Preço -->
          <div style="background: #27ae60; color: white; padding: 4px 8px; border-radius: 6px; font-weight: 900; font-size: 1.0rem; box-shadow: 0 2px 4px rgba(0,0,0,0.2); display: flex; flex-direction: column; align-items: flex-end;">
            ${item.preco_original ? `<span style="text-decoration: line-through; opacity: 0.7; font-size: 0.7rem; line-height: 1;">R$ ${item.preco_original.toFixed(2)}</span>` : ''}
            <span>R$ ${item.preco.toFixed(2)}</span>
          </div>          
          <!-- Info de ESTOQUE (Mostra o que resta tirando o carrinho) -->
          <div style="background: ${esgotado ? '#e74c3c' : '#3498db'}; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 0.8rem; display: flex; align-items: center; gap: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
            ${temEstoqueDefinido ? `<span>📦</span> ${estoqueExibido}` : '<span>♾️</span> Ilimitado'}
          </div>

          <!-- PROMOÇÃO -->
          ${emPromocao ? '<div class="promo-badge">PROMOÇÃO</div>' : ''}
          
          <!-- COZINHA -->
          ${item.enviar_cozinha ? '<div style="background: #3498db; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 0.75rem; box-shadow: 0 2px 4px rgba(0,0,0,0.2); margin-top: 2px;">👨‍🍳 COZINHA</div>' : ''}
        </div>

        <img src="${item.imagem}" alt="${item.nome}">
        <h3 style="font-size: 1.0rem !important;">${item.nome}</h3>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.item-menu').forEach(itemEl => {
    itemEl.addEventListener('click', async () => {
      const menuItem = menu.find(m => m.id == itemEl.dataset.id);
      
      const itemNoPedido = pedidoAtual.find(p => p.menu_id === menuItem.id);
      const qtdNoCarrinho = itemNoPedido ? itemNoPedido.quantidade : 0;
      const estoqueDisponivel = (menuItem.estoque !== -1) ? (menuItem.estoque - qtdNoCarrinho) : 999;

      if (menuItem.estoque !== -1 && estoqueDisponivel <= 0) {
        return await mostrarAlerta("Este item está esgotado ou você já pegou todo o estoque disponível!", "Estoque");
      }
      
      adicionarItemPedido(menuItem);
      exibirMenu(categoria);
    });
  });
}

async function adicionarItemPedido(item) {
  const existing = pedidoAtual.find(p => p.menu_id === item.id);
  const quantidadeNoCarrinho = existing ? existing.quantidade : 0;

  // Verifica se tem estoque para adicionar mais um (se não for ilimitado)
  if (item.estoque !== -1 && (quantidadeNoCarrinho + 1) > item.estoque) {
    return await mostrarAlerta(`Estoque insuficiente! Você já adicionou o limite de ${item.estoque} unidades.`, "Estoque");
  }

  if (existing) existing.quantidade++;
  else pedidoAtual.push({ menu_id: item.id, nome: item.nome, preco: item.preco, quantidade: 1, observacao: '' });
  exibirResumoPedido();
}

function exibirResumoPedido() {
  const container = document.getElementById('itens-pedido');
  if (!container) return;

  // Atualiza o Badge do Carrinho
  const badge = document.getElementById('carrinho-badge');
  const totalItens = pedidoAtual.reduce((sum, item) => sum + item.quantidade, 0);
  if (badge) {
    badge.textContent = totalItens;
    // Opcional: animação se o carrinho ganhar itens
    badge.style.transform = 'scale(1.2)';
    setTimeout(() => badge.style.transform = 'scale(1)', 200);
  }

  // Verifica se há pelo menos um item que vai para a cozinha
  const temItemCozinha = pedidoAtual.some(itemNoPedido => {
    const itemInfo = menu.find(m => m.id === itemNoPedido.menu_id);
    return itemInfo && (itemInfo.enviar_cozinha === 1 || itemInfo.enviar_cozinha === true);
  });

  container.innerHTML = pedidoAtual.map((item, index) => `
    <div class="item-pedido">
      <div class="item-pedido-info">
        <div style="flex-grow: 1; padding-right: 10px;">
          <p><strong>${item.nome}</strong></p>
        </div>
        <div class="controle-qtd-container">
          <div class="seletor-qtd">
            <button class="btn-qtd" onclick="alterarQuantidadeItem(${index}, -1)">-</button>
            <span class="valor-qtd">${item.quantidade}</span>
            <button class="btn-qtd" onclick="alterarQuantidadeItem(${index}, 1)">+</button>
          </div>
          <p class="subtotal-item">R$ ${(item.preco * item.quantidade).toFixed(2)}</p>
        </div>
      </div>
      
      <div class="obs-container">
        <span class="obs-icon">📝</span>
        <input type="text" 
               class="obs-input" 
               placeholder="Alguma observação? (ex: sem cebola)" 
               value="${item.observacao}" 
               oninput="pedidoAtual[${index}].observacao = this.value">
      </div>
      
      <button class="btn-remover-item" style="margin-top:12px; width:100% !important; background:#dfe6e9 !important; color:#636e72 !important;" onclick="removerItemPedido(${index})">Remover este item</button>
    </div>
  `).join('');
  const total = pedidoAtual.reduce((sum, item) => sum + (item.preco * item.quantidade), 0);
  document.getElementById('total-pedido').textContent = `Total: R$ ${total.toFixed(2)}`;

  // Campo de Observação Geral do Pedido (Só aparece se houver item para a cozinha)
  let containerObs = document.getElementById('container-obs-geral');
  if (temItemCozinha) {
    if (!containerObs) {
      const totalEl = document.getElementById('total-pedido');
      const obsHtml = `
        <div id="container-obs-geral" style="margin-top:15px; background:#fdf9f3; padding:12px; border-radius:10px; border:1px solid #f3e5ab;">
          <label style="display:block; font-size:0.9rem; font-weight:bold; color:#d35400; margin-bottom:6px;">📝 Observação p/ Cozinha (Geral):</label>
          <textarea id="obs-geral-pedido" 
                    placeholder="Ex: Capricha no tempero, cliente com pressa..." 
                    style="width:100%; border:1px solid #f3e5ab; border-radius:8px; padding:10px; font-size:0.95rem; font-family:inherit; min-height:60px; resize:none;"
                    oninput="window.pedidoObservacaoGeral = this.value"></textarea>
        </div>
      `;
      totalEl.insertAdjacentHTML('afterend', obsHtml);
      containerObs = document.getElementById('container-obs-geral');
    }
    const textareaObs = document.getElementById('obs-geral-pedido');
    if (textareaObs) {
      textareaObs.value = window.pedidoObservacaoGeral || '';
    }
  } else if (containerObs) {
    containerObs.remove();
  }

  // Se o carrinho ficar vazio, fecha o modal automaticamente
  if (totalItens === 0) {
    const modal = document.getElementById('modal-carrinho');
    if (modal) {
      modal.style.display = 'none';
      document.body.style.overflow = ''; // Destrava o scroll
    }
  }
}

async function alterarQuantidadeItem(index, delta) {
  const itemNoPedido = pedidoAtual[index];
  const itemNoMenu = menu.find(m => m.id === itemNoPedido.menu_id);

  if (delta > 0 && itemNoMenu && itemNoMenu.estoque !== -1) {
    if (itemNoPedido.quantidade + delta > itemNoMenu.estoque) {
      return await mostrarAlerta(`Estoque insuficiente! Restam apenas ${itemNoMenu.estoque} unidades.`, "Estoque");
    }
  }

  const novoValor = itemNoPedido.quantidade + delta;
  if (novoValor > 0) {
    itemNoPedido.quantidade = novoValor;
    exibirResumoPedido();
    const catAtiva = document.querySelector('.categoria.ativa').dataset.categoria;
    exibirMenu(catAtiva);
  } else removerItemPedido(index);
}

function removerItemPedido(index) {
  pedidoAtual.splice(index, 1);
  exibirResumoPedido();
  const catAtivaElement = document.querySelector('.categoria.ativa');
  const catAtiva = catAtivaElement ? catAtivaElement.dataset.categoria : 'todas';
  exibirMenu(catAtiva);
}

async function enviarPedido() {
  if (pedidoAtual.length === 0) return await mostrarAlerta('Adicione pelo menos um item', "Aviso");
  
  const btnEnviar = document.getElementById('enviar-pedido');
  const originalTexto = btnEnviar.innerText;
  
  try {
    // Desabilita o botão para evitar duplicidade
    btnEnviar.disabled = true;
    btnEnviar.innerText = "Enviando...";
    btnEnviar.style.opacity = "0.5";
    btnEnviar.style.cursor = "not-allowed";

    const mesa_id = mesaAtual ? mesaAtual.id : null;
    let url = '/api/pedidos';
    let method = 'POST';

    if (pedidoAbertoNaMesa) {
       url = `/api/pedidos/${pedidoAbertoNaMesa.id}/adicionar`;
       method = 'PUT';
    }
    
    // Identificação do Garçom
    let idGarcom = 'garcom-desconhecido';
    if (garcomLogado) {
      idGarcom = garcomLogado.usuario || garcomLogado.id || garcomLogado.nome || 'garcom-sem-id';
    }
    
    console.log(`🚀 ENVIANDO PEDIDO: Mesa ${mesa_id}, Garçom: ${idGarcom}`, garcomLogado);

    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        mesa_id: mesa_id, 
        garcom_id: idGarcom, 
        itens: pedidoAtual,
        observacao: window.pedidoObservacaoGeral || ''
      })
    });
    
    if (res.ok) {
      await mostrarAlerta(pedidoAbertoNaMesa ? 'Itens adicionados!' : 'Pedido enviado!', "Sucesso");
      pedidoAtual = [];
      pedidoAbertoNaMesa = null;
      mesaAtual = null; // Limpa mesa atual
      
      // Fecha o modal do carrinho
      const modalCarrinho = document.getElementById('modal-carrinho');
      if (modalCarrinho) {
        modalCarrinho.style.display = 'none';
        document.body.style.overflow = ''; // Destrava o scroll
      }

      document.getElementById('pedido').classList.add('hidden');
      document.getElementById('mesas').classList.remove('hidden');
      document.getElementById('btn-header-mesas').style.display = 'none';
      carregarMesas();
    } else {
      const errorData = await res.json();
      await mostrarAlerta(errorData.error || 'Erro ao enviar pedido', "Erro");
    }
  } catch (error) { 
    console.error("Erro ao enviar pedido:", error);
    await mostrarAlerta('Erro de conexão com o servidor', "Erro"); 
  } finally {
    // Reabilita o botão em caso de erro ou ao finalizar
    btnEnviar.disabled = false;
    btnEnviar.innerText = originalTexto;
    btnEnviar.style.opacity = "1";
    btnEnviar.style.cursor = "pointer";
  }
}

async function gerarCodigoAcesso() {
  if (!mesaAtual) return;
  try {
    const res = await fetch('/api/acesso/gerar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mesa_id: mesaAtual.id })
    });
    const data = await res.json();
    if (data.success) {
      fecharOpcoes();
      await mostrarAlerta(`CÓDIGO DE ACESSO: ${data.codigo}\n\nInforme este código ao cliente para liberar o cardápio digital na Mesa ${mesaAtual.numero}.`, "Código Gerado");
    } else {
      await mostrarAlerta("Erro ao gerar código.", "Erro");
    }
  } catch (error) {
    await mostrarAlerta("Erro de conexão.", "Erro");
  }
}

async function cancelarCodigoAcesso() {
  if (!mesaAtual) return;
  
  const confirm = await mostrarConfirmacao(`Deseja realmente CANCELAR o acesso digital da Mesa ${mesaAtual.numero}? O cliente será deslogado e a mesa ficará livre.`, "Confirmar Cancelamento");
  if (!confirm) return;

  try {
    const res = await fetch('/api/acesso/cancelar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mesa_id: mesaAtual.id })
    });
    const data = await res.json();
    if (data.success) {
      fecharOpcoes();
      await mostrarAlerta("Acesso cancelado e mesa liberada com sucesso.", "Cancelado");
    } else {
      await mostrarAlerta("Erro ao cancelar acesso.", "Erro");
    }
  } catch (error) {
    await mostrarAlerta("Erro de conexão.", "Erro");
  }
}

function configurarEventos() {
  document.getElementById('enviar-pedido').addEventListener('click', enviarPedido);
  document.getElementById('voltar-mesas').addEventListener('click', voltarParaMesas);
  const categorias = ['todas', ...new Set(menu.map(item => item.categoria))];
  const container = document.getElementById('categorias');
  if (container) {
    container.innerHTML = categorias.map(cat => `<div class="categoria ${cat === categoriaAtual ? 'ativa' : ''}" data-categoria="${cat}">${cat === 'todas' ? 'Todos' : cat}</div>`).join('');
    
    // Habilitar scroll horizontal com a roda do mouse
    container.addEventListener('wheel', (evt) => {
        evt.preventDefault();
        container.scrollLeft += evt.deltaY;
    });

    document.querySelectorAll('.categoria').forEach(cat => {
      cat.addEventListener('click', () => {
        categoriaAtual = cat.dataset.categoria;
        sessionStorage.setItem('garcom_categoria_atual', categoriaAtual);
        document.querySelectorAll('.categoria').forEach(c => c.classList.remove('ativa'));
        cat.classList.add('ativa');
        exibirMenu(categoriaAtual);
      });
    });
  }
}

function verQRCodeMesa() {
  if (!mesaAtual) return;
  // URL absoluta para o cardápio da mesa específica
  // Corrigido: Removido /frontend/ pois a pasta frontend já é a raiz do servidor estático
  const urlMesa = window.location.origin + '/cardapio/index.html?mesa=' + mesaAtual.id;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(urlMesa)}`;
  
  const html = `
    <div style="text-align: center; padding: 10px;">
      <p style="margin-bottom: 15px; font-weight: bold; color: #2c3e50; font-size: 1.2rem;">Acesso Digital - Mesa ${mesaAtual.numero}</p>
      <div style="background: white; padding: 15px; border-radius: 15px; display: inline-block; box-shadow: 0 4px 15px rgba(0,0,0,0.1); margin-bottom: 15px;">
        <img src="${qrUrl}" style="width: 220px; height: 220px; display: block;">
      </div>
      <p style="font-size: 0.8rem; color: #7f8c8d; margin-bottom: 15px; word-break: break-all; background: #f8f9fa; padding: 8px; border-radius: 5px;">${urlMesa}</p>
      <div style="display: flex; gap: 10px; justify-content: center;">
        <button onclick="window.open('${qrUrl}', '_blank')" style="background: #3498db; color: white; border: none; padding: 12px 20px; border-radius: 8px; font-weight: bold; cursor: pointer; width: 100%;">Baixar QR Code</button>
      </div>
    </div>
  `;
  
  fecharOpcoes();
  mostrarAlerta(html, "📱 QR CODE DA MESA");
}
