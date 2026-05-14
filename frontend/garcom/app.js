let menu = [];
let mesas = [];

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
      const response = await originalFetch(...args);

      if (!response.ok) {
        console.error(`❌ ERRO DE FETCH [${response.status}] URL:`, args[0]);
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

document.addEventListener('DOMContentLoaded', async () => {
  verificarSessao();
});

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
    document.getElementById('modal-sistema-mensagem').innerText = msg;
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
    document.getElementById('modal-sistema-mensagem').innerText = msg;
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
  await carregarMenu();
  await carregarMesas();
  await atualizarStatusCaixa();
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

let timeoutPusher = null;
let somAtivo = localStorage.getItem('garcom_som_ativo') !== 'false';

function atualizarIconeSom() {
  const btn = document.getElementById('btn-toggle-som');
  if (btn) {
    btn.innerHTML = somAtivo ? '🔔' : '🔕';
    btn.style.opacity = somAtivo ? '1' : '0.5';
  }
}

function alternarSom() {
  somAtivo = !somAtivo;
  localStorage.setItem('garcom_som_ativo', somAtivo);
  atualizarIconeSom();
}

function tocarCampainha() {
  if (!somAtivo) return;
  const audio = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-home-standard-ding-dong-109.mp3');
  audio.play().catch(e => console.log('Erro som:', e));
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
      atualizarIconeSom(); // Garante que o ícone carregue no estado correto
    });

    pusher.connection.bind('error', function(err) {
      console.warn('❌ Erro de conexão no Pusher:', err);
    });

    const channel = pusher.subscribe('garconnexpress');
    console.log('📺 Inscrito no canal: garconnexpress');
  
  channel.bind('pedido-pronto', (data) => {
    console.log('📢 Evento recebido: pedido-pronto', data);
    tocarCampainha();
    
    // Mostra apenas alerta informativo (sem o botão de entregar agora no modal)
    mostrarAlerta(data.mensagem, "👨‍🍳 COZINHA: PEDIDO PRONTO!");

    clearTimeout(timeoutPusher);
    timeoutPusher = setTimeout(() => carregarMesas(), 500);
  });

  channel.bind('novo-pedido', (data) => {
    console.log('📢 Evento recebido: novo-pedido', data);
    tocarCampainha();
    clearTimeout(timeoutPusher);
    timeoutPusher = setTimeout(() => carregarMesas(), 500);
  });

  // Desbloqueia áudio no primeiro clique do usuário
  document.addEventListener('click', () => {
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/594/594-preview.mp3');
    audio.muted = true;
    audio.play().then(() => {
      console.log('🔊 Áudio desbloqueado!');
    }).catch(e => console.log('Erro ao desbloquear áudio:', e));
  }, { once: true });

  channel.bind('status-caixa-atualizado', (data) => {
    console.log('📢 Evento recebido: status-caixa-atualizado', data);
    atualizarStatusCaixa();
  });

  channel.bind('status-atualizado', (data) => {
    console.log('📢 Evento recebido: status-atualizado', data);
    // Debounce de 500ms para evitar recargas excessivas se vários eventos chegarem juntos
    clearTimeout(timeoutPusher);
    timeoutPusher = setTimeout(() => {
      console.log('🔄 Recarregando mesas devido a atualização de status...');
      carregarMesas();
      if (data) {
        const nMesa = data.mesa_numero || data.mesa_id || 'X';
        if (data.status === 'liberada') mostrarToast(`✅ Mesa ${nMesa} liberada`);
        else if (data.status === 'servido') mostrarToast(`🚚 Pedido da Mesa ${nMesa} entregue!`);
        else if (data.status === 'itens_atualizados') mostrarToast(`📝 Pedido da Mesa ${nMesa} atualizado pelo Admin`);
        else if (data.status === 'cancelado') mostrarToast(`❌ Pedido da Mesa ${nMesa} CANCELADO pelo Admin`);
      }
    }, 500);
  });

  channel.bind('menu-atualizado', (data) => {
    console.log('📢 Evento recebido: menu-atualizado', data);
    carregarMenu();
  });
  } catch (e) { console.warn('Pusher init error:', e); }
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
  if (Array.isArray(menu)) exibirMenu('todas');
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

function exibirMesas() {
  const grid = document.getElementById('mesas-grid');
  if (!grid) return;

  grid.innerHTML = mesas.map(mesa => {
    let cronometroHtml = '';
    let classeAlerta = '';
    let classeBloqueada = '';
    let statusTexto = mesa.status.toUpperCase();

    // Bloqueia se o caixa estiver fechado
    if (!caixaAberto) {
      classeBloqueada = 'caixa-fechado';
      statusTexto = 'CAIXA FECHADO';
    } else if (mesa.status === 'ocupada') {
      const eMeuPedido = mesa.garcom_id === garcomLogado.nome;
      if (!eMeuPedido) {
        classeBloqueada = 'bloqueada';
        statusTexto = `OCUPADA (${mesa.garcom_id})`;
      }
      
      // DESTAQUE PARA PEDIDO PRONTO NA COZINHA
      if (mesa.pedido_status === 'pronto') {
        classeAlerta = 'pedido-pronto-alert';
        statusTexto = '🔥 PRONTO PARA ENTREGA';
      }

      if (mesa.pedido_created_at) {
        const minutos = calcularMinutos(mesa.pedido_created_at);
        cronometroHtml = `<div class="cronometro">⏱️ ${minutos} min</div>`;
        if (minutos >= 10) classeAlerta = 'alerta-atraso';
      }
    }

    return `
      <div class="mesa ${mesa.status} ${classeAlerta} ${classeBloqueada}" data-id="${mesa.id}">
        <h3>Mesa ${mesa.numero}</h3>
        <p>${statusTexto}</p>
        ${cronometroHtml}
      </div>
    `;
  }).join('');

  document.querySelectorAll('.mesa').forEach(mesa => {
    mesa.addEventListener('click', async () => {
      if (!caixaAberto) {
        await mostrarAlerta("O CAIXA ESTÁ FECHADO! Não é possível realizar pedidos agora.", "Aviso");
        return;
      }
      const mesaSelecionada = mesas.find(m => m.id == mesa.dataset.id);
      mesaAtual = mesaSelecionada;
      
      if (mesaSelecionada.status === 'ocupada') {
        const eMeuPedido = mesaSelecionada.garcom_id === garcomLogado.nome;
        if (!eMeuPedido) {
          await mostrarAlerta(`Esta mesa está sendo atendida pelo colega: ${mesaSelecionada.garcom_id}`, "Mesa Ocupada");
          return;
        }
        mostrarOpcoesMesa(mesaSelecionada);
      } else { 
        pedidoAbertoNaMesa = null; 
        abrirCardapio(); 
      }
    });
  });
}

async function mostrarOpcoesMesa(mesa) {
  const res = await fetch(`/api/pedidos/mesa/${mesa.id}`);
  pedidoAbertoNaMesa = await res.json();
  if (!pedidoAbertoNaMesa) {
    await mostrarAlerta("Erro: Mesa ocupada sem pedido. Liberando...", "Erro");
    await fetch(`/api/mesas/${mesa.id}/liberar`, { method: 'PUT' });
    return carregarMesas();
  }
  document.getElementById('modal-mesa-titulo').textContent = `Mesa ${mesa.numero}`;
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
        const emPreparo = item.status === 'pendente' && item.enviar_cozinha;
        
        let bgColor = '#fff5f5';
        let statusLabel = '';
        
        if (isPronto) {
          bgColor = '#e8f8f5'; // Verde claro para pronto
          statusLabel = '<span style="background:#2ecc71; color:white; padding:2px 6px; border-radius:4px; font-size:10px; margin-left:5px;">PRONTO</span>';
        } else if (emPreparo) {
          bgColor = '#fff9f0'; // Laranja muito claro para preparo
          statusLabel = '<span style="background:#f39c12; color:white; padding:2px 6px; border-radius:4px; font-size:10px; margin-left:5px;">EM PREPARO</span>';
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
    
    const emPreparo = itens.filter(i => i.status === 'pendente' && i.enviar_cozinha);
    let apenasProntos = false;

    if (emPreparo.length > 0) {
      const confirmParcial = await mostrarConfirmacao(
        `Atenção: Existem ${emPreparo.length} item(ns) ainda EM PREPARO na cozinha. Deseja confirmar APENAS a entrega dos itens que já estão prontos?`,
        "Entrega Parcial",
        "Sim, apenas prontos",
        "Não, ver outras opções"
      );
      
      if (confirmParcial) {
        apenasProntos = true;
      } else {
        const confirmTudo = await mostrarConfirmacao(
          "Deseja confirmar a entrega de TODOS os itens do pedido, inclusive os que ainda estão em preparo na cozinha?",
          "Entregar Tudo",
          "Sim, entregar tudo",
          "Cancelar"
        );
        if (confirmTudo) {
          apenasProntos = false;
        } else {
          return; // Cancelou a operação
        }
      }
    } else {
      if (!await mostrarConfirmacao("Confirmar entrega dos itens pendentes?", "Entregar Itens")) return;
    }

    const res = await fetch(`/api/pedidos/${idPedido}/marcar-entregue`, { 
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apenasProntos })
    });
    
    if (res.ok) {
      const data = await res.json();
      if (data.entregueTudo) {
        await mostrarAlerta("Sucesso! Todos os itens foram entregues.", "Sucesso");
        document.getElementById('modal-resumo-mesa').style.display = 'none';
      } else {
        await mostrarAlerta("Itens prontos entregues! Os itens em preparo continuam aguardando na cozinha.", "Entrega Parcial");
        verItensDaMesa(); // Recarrega a lista para mostrar o que sobrou
      }
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
  pedidoAtual = [];
  window.pedidoObservacaoGeral = ''; // Reset observação geral
  exibirResumoPedido();
  exibirMenu('todas');
}

async function finalizarEDesocupar() {
  if (!mesaAtual || !pedidoAbertoNaMesa) return;

  try {
    const resItens = await fetch(`/api/pedidos/${pedidoAbertoNaMesa.id}/itens`);
    const itens = await resItens.json();
    const temPendentes = itens.some(i => i.status === 'pendente');

    if (temPendentes) {
      return await mostrarAlerta("Não é possível solicitar o fechamento! Existem itens pendentes de entrega nesta mesa. Marque-os como entregues primeiro.", "Aviso");
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
    const qtdBadge = itemNoPedido ? `<div class="badge-qtd">${itemNoPedido.quantidade}</div>` : '';

    // Lógica de estoque
    const estoqueNum = (item.estoque !== null && item.estoque !== undefined) ? parseInt(item.estoque) : -1;
    const temEstoqueDefinido = estoqueNum !== -1;
    const esgotado = estoqueNum === 0;

    return `
      <div class="item-menu ${esgotado ? 'esgotado' : ''}" data-id="${item.id}">
        ${qtdBadge}
        <img src="${item.imagem}" alt="${item.nome}">
        <h3>${item.nome}</h3>
        <p>R$ ${item.preco.toFixed(2)}</p>
        ${temEstoqueDefinido ? `
          <div class="info-estoque ${esgotado ? 'zero' : ''}" style="font-weight: bold; padding: 2px 5px; border-radius: 4px; display: inline-block; font-size: 0.75rem;">
            Estoque: ${estoqueNum}
          </div>
        ` : `
          <div class="info-estoque" style="opacity: 0.6; font-size: 0.7rem;">Estoque: Ilimitado</div>
        `}
      </div>
    `;
  }).join('');

  document.querySelectorAll('.item-menu').forEach(itemEl => {
    itemEl.addEventListener('click', async () => {
      const menuItem = menu.find(m => m.id == itemEl.dataset.id);
      if (menuItem.estoque === 0) return await mostrarAlerta("Este item está esgotado!", "Estoque");
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

  // Campo de Observação Geral do Pedido
  let containerObs = document.getElementById('container-obs-geral');
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
  const catAtiva = document.querySelector('.categoria.ativa').dataset.categoria;
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
    
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        mesa_id: mesa_id, 
        garcom_id: (garcomLogado && garcomLogado.nome) ? garcomLogado.nome : 'garcom-desconhecido', 
        itens: pedidoAtual,
        observacao: window.pedidoObservacaoGeral || ''
      })
    });
    
    if (res.ok) {
      await mostrarAlerta(pedidoAbertoNaMesa ? 'Itens adicionados!' : 'Pedido enviado!', "Sucesso");
      pedidoAtual = [];
      pedidoAbertoNaMesa = null;
      mesaAtual = null; // Limpa mesa atual
      document.getElementById('pedido').classList.add('hidden');
      document.getElementById('mesas').classList.remove('hidden');
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

function configurarEventos() {
  document.getElementById('enviar-pedido').addEventListener('click', enviarPedido);
  document.getElementById('voltar-mesas').addEventListener('click', () => {
    document.getElementById('pedido').classList.add('hidden');
    document.getElementById('mesas').classList.remove('hidden');
  });
  const categorias = ['todas', ...new Set(menu.map(item => item.categoria))];
  const container = document.getElementById('categorias');
  if (container) {
    container.innerHTML = categorias.map(cat => `<div class="categoria ${cat === 'todas' ? 'ativa' : ''}" data-categoria="${cat}">${cat === 'todas' ? 'Todos' : cat}</div>`).join('');
    document.querySelectorAll('.categoria').forEach(cat => {
      cat.addEventListener('click', () => {
        document.querySelectorAll('.categoria').forEach(c => c.classList.remove('ativa'));
        cat.classList.add('ativa');
        exibirMenu(cat.dataset.categoria);
      });
    });
  }
}
