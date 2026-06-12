window.onerror = function(msg, url, line) {
  console.log('🚀 Admin v1.2.0 Iniciado');
  const msgStr = String(msg || '');
  if (msgStr.includes('WebSocket') || msgStr.includes('Pusher') || msgStr.includes('connection')) {
    return true; // Suprime erros de rede poluindo o console
  }
    console.error("ERRO GLOBAL:", msg, "em", url, "linha:", line);
  };

  // Suprimir avisos e erros específicos do WebSocket/Pusher no console
  const originalWarn = console.warn;
  console.warn = function(...args) {
    const str = String(args[0] || '');
    if (str.includes('Pusher') || str.includes('WebSocket') || str.includes('desconectado')) return;
    originalWarn.apply(console, args);
  };

  const originalError = console.error;
  console.error = function(...args) {
    const str = String(args[0] || '');
    if (str.includes('Pusher') || str.includes('WebSocket') || str.includes('connection')) return;
    originalError.apply(console, args);
  };
  
  // Interceptador global para redirecionar ao login se a sessão expirar
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    // Adiciona token ao header Authorization se existir no localStorage
    const token = localStorage.getItem('admin_token');
    if (token) {
      if (!args[1]) args[1] = {};
      if (!args[1].headers) args[1].headers = {};
      args[1].headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await originalFetch(...args);
      
      // DEBUG: Loga erros 400+ para ajudar no diagnóstico
      if (!response.ok) {
        console.error(`❌ FETCH ERRO [${response.status}] na URL:`, args[0]);
      }

      // Ignora o redirecionamento se for uma tentativa de login
      if ((response.status === 401 || response.status === 403) && !args[0].includes('/api/admin/login')) {
        console.warn("⚠️ Sessão expirada ou acesso negado (401/403).");
        console.log("URL que falhou:", args[0]);
        
        localStorage.removeItem('admin_logado');
        localStorage.removeItem('admin_token');
        
        // Em vez de reload direto, avisa o usuário (isso pausa a execução e permite ver o console)
        window.location.reload(); 
        // console.log("🔄 Auto-reload cancelado para debug. Verifique os logs acima.");
      }
      return response;
    } catch (error) {
      console.error("❌ ERRO DE REDE/FETCH:", error, "URL:", args[0]);
      throw error;
    }
  };
  
  let cardapio = [];
let pedidos = [];
let historico = [];
let pedidosFiltradosHistoricoFinalizados = [];
let pedidosFiltradosHistoricoCancelados = [];
let paginaAtualFinalizados = 1;
let paginaAtualCancelados = 1;
const ITENS_POR_PAGINA_HISTORICO = 3;
let mesaAtual = null;
let pedidoEmEdicao = null;
let itensEmEdicao = [];
let categoriaEdicaoAtual = 'todas';
let abaAtiva = 'ativos';
let ultimoAlertaValidadeMostrado = 0; // Debounce para o alerta de produtos vencidos
let subAbaAtiva = 'garcom';
let adminLogado = null;
let configCozinhaCategorias = []; // Estado global das categorias da cozinha
let configCozinhaLoaded = false; // Flag para saber se já carregou do servidor
let mensagensNaoLidasWhatsapp = 0; // Controle local do badge do WhatsApp

// Helper para verificar se um item deve ir para a cozinha (Sincronizado com Backend)
function isItemParaCozinha(item) {
    if (!item) return false;
    const envCozinha = item.enviar_cozinha;
    const cat = (item.categoria || '').trim().toUpperCase();
    
    // 1. Override Manual: Se for explicitamente 0/false, NÃO VAI.
    if (envCozinha === 0 || envCozinha === false || envCozinha === '0' || envCozinha === 'false') {
        return false;
    }
    
    // 2. Override Manual: Se for explicitamente 1/true, VAI.
    if (envCozinha === 1 || envCozinha === true || envCozinha === '1' || envCozinha === 'true') {
        return true;
    }
    
    // 3. Se for NULL (Default), segue a regra das categorias
    // Se a config já foi carregada, seguimos a lista rigorosamente.
    if (configCozinhaLoaded) {
        return configCozinhaCategorias.includes(cat);
    }
    
    // 4. Fallback de segurança antes de carregar a config: Assume Sim
    return true;
}

// Busca as categorias configuradas para a cozinha e salva no estado global
async function carregarConfigCategoriasCozinha() {
  try {
    const resConfig = await fetch('/api/config/categorias-cozinha');
    if (resConfig.ok) {
      const configuradas = await resConfig.json();
      configCozinhaCategorias = (configuradas || []).map(c => String(c).trim().toUpperCase());
      configCozinhaLoaded = true; // SINALIZA QUE A CONFIG FOI CARREGADA
    }
  } catch (e) {
    console.error('Erro ao buscar config de cozinha:', e);
  }
}
let tipoDescontoAdmin = 'porcentagem'; // Ativado por padrão como porcentagem
let veioDoFechamento = false; 

function toggleTipoDesconto(isPorcentagem) {
  tipoDescontoAdmin = isPorcentagem ? 'porcentagem' : 'real';
  const label = document.getElementById('label-desconto-admin');
  const input = document.getElementById('fechamento-desconto-admin');
  const span = document.getElementById('span-tipo-desconto');
  
  if (tipoDescontoAdmin === 'real') {
    label.textContent = 'Desconto (R$):';
    if (span) span.textContent = 'R$';
    input.step = '0.50';
    input.placeholder = 'Valor em R$';
  } else {
    label.textContent = 'Desconto (%):';
    if (span) span.textContent = '%';
    input.step = '1';
    input.placeholder = 'Valor em %';
  }
  recalcularTotalFechamentoAdmin();
}

function switchSubTab(sub) {
  subAbaAtiva = sub;
  
  // Limpa o filtro de seleção ao trocar de aba para evitar estados inconsistentes
  filtroSelectMesa = '';
  const select = document.getElementById('select-mesas-ativas');
  if (select) select.value = '';

  // Limpa estados de todos os botões
  document.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.classList.remove('active');
    btn.style.background = 'transparent';
    btn.style.color = '#7f8c8d';
  });

  // Ativa o botão selecionado
  const activeBtn = document.getElementById(`tab-sub-${sub}`);
  if (activeBtn) {
    activeBtn.classList.add('active');
    if (sub === 'garcom') activeBtn.style.background = '#3498db';
    else if (sub === 'balcao') activeBtn.style.background = '#27ae60';
    else if (sub === 'delivery') activeBtn.style.background = '#e67e22';
    activeBtn.style.color = 'white';
  }

  // Alterna visibilidade do conteúdo
  document.querySelectorAll('.sub-tab-content').forEach(content => content.classList.add('hidden'));
  const targetGroup = document.getElementById(`group-${sub}`);
  if (targetGroup) targetGroup.classList.remove('hidden');

  // Atualiza o seletor de mesas para a nova aba
  atualizarSelectMesasAtivas();
  // Re-aplica filtros visuais
  aplicarFiltrosVisuais();
}
let caixaAtual = null;

const audioNotificacao = new Audio('/notificacao.mp3');
let audioDesbloqueado = false;

// Função para preparar áudio no primeiro clique do usuário
function desbloquearAudio() {
  if (audioDesbloqueado) return;
  
  // Tenta tocar e pausar imediatamente para ganhar permissão do navegador
  audioNotificacao.muted = true;
  audioNotificacao.play().then(() => {
    audioNotificacao.pause();
    audioNotificacao.currentTime = 0;
    
    // Agora que temos permissão, verificamos se o som deve estar ativo
    const somMP3 = localStorage.getItem('admin_som_mp3_ativo') !== 'false';
    audioNotificacao.muted = !somMP3;
    
    audioDesbloqueado = true;
    console.log('🔊 Áudio do Admin desbloqueado com sucesso!');
  }).catch(e => {
    console.warn('⚠️ Falha ao desbloquear áudio (clique necessário):', e);
  });
}

// Escuta qualquer clique na página para desbloquear o som
document.addEventListener('click', desbloquearAudio, { once: true });
document.addEventListener('touchstart', desbloquearAudio, { once: true });
let intervalPiscaTitulo = null;
const tituloOriginal = "Admin - GarçomExpress";

document.addEventListener('DOMContentLoaded', async () => {
  const salvo = localStorage.getItem('admin_logado');
  if (salvo) {
    adminLogado = JSON.parse(salvo);
    document.getElementById('tela-login-admin').classList.add('hidden');
    iniciarPainelAdmin();
  }
});

async function realizarLoginAdmin() {
  const usuario = document.getElementById('admin-usuario').value;
  const senha = document.getElementById('admin-senha').value;
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, senha })
  });
  if (res.ok) {
    const data = await res.json();
    adminLogado = data.admin;
    localStorage.setItem('admin_logado', JSON.stringify(adminLogado));
    if (data.token) localStorage.setItem('admin_token', data.token); // Salva token
    location.reload();
  } else await mostrarAlerta("Credenciais inválidas", "Erro de Login", "❌");
}

async function logoutAdmin() {
  await fetch('/api/logout', { method: 'POST' });
  localStorage.removeItem('admin_logado');
  localStorage.removeItem('admin_token');
  location.reload();
}

const PRINT_PAPER_KEY = 'admin_print_paper_mm';

function getPrintPaperMm() {
  const raw = localStorage.getItem(PRINT_PAPER_KEY);
  return raw === '80' ? '80' : '58';
}

function aplicarConfiguracaoImpressao() {
  const mm = getPrintPaperMm();
  document.documentElement.classList.toggle('paper-80', mm === '80');
}

function inicializarConfiguracaoImpressao() {
  aplicarConfiguracaoImpressao();
  const sel = document.getElementById('print-paper-select');
  if (!sel) return;
  sel.value = getPrintPaperMm();
  sel.onchange = () => {
    localStorage.setItem(PRINT_PAPER_KEY, sel.value === '80' ? '80' : '58');
    aplicarConfiguracaoImpressao();
  };
}

async function iniciarPainelAdmin() {
  inicializarConfiguracaoImpressao();
  inicializarConfiguracaoSom(); 
  solicitarPermissaoNotificacao();
  carregarNotificacoes();
  
  // Define o estado inicial padrão
  abaAtiva = 'ativos';
  subAbaAtiva = 'garcom';
  switchTab('ativos'); 
  switchSubTab('garcom');

  await carregarConfigCategoriasCozinha(); // Carrega config de cozinha imediatamente
  carregarPedidos();
  carregarCardapio();
  carregarStatusCaixa();
  carregarStatusDelivery();
  carregarDadosConfig(); 
  configurarPusher();
  window.addEventListener('focus', () => pararPiscarTitulo());
  
  // Listener para imprimir cupom parcial direto do modal de edição
  const btnImprimir = document.getElementById('btn-imprimir-edicao');
  if (btnImprimir) {
    btnImprimir.onclick = () => {
      if (pedidoEmEdicao && itensEmEdicao) {
        // Se houver itens selecionados, imprime apenas eles. Caso contrário, imprime tudo do modal.
        const selecionados = itensEmEdicao.filter(i => i.selecionado);
        const itensParaImprimir = selecionados.length > 0 ? selecionados : itensEmEdicao;
        
        if (selecionados.length > 0) {
            mostrarToast("🖨️ Imprimindo apenas itens selecionados...");
        }

        // Cria um mock para indicar que é uma impressão parcial de itens
        const pedidoMock = {
          ...pedidoEmEdicao,
          isImpressaoParcialItens: true
        };
        
        imprimirCupom(pedidoMock, itensParaImprimir);
      }
    };
  }

  // Listener para scroll horizontal nas categorias com o mouse
  const catScroll = document.getElementById('edit-menu-categorias');
  if (catScroll) {
    catScroll.addEventListener('wheel', (e) => {
      e.preventDefault();
      catScroll.scrollLeft += e.deltaY;
    });
  }

  setInterval(() => {
    atualizarCronometrosPedidos();
  }, 10000); // Atualiza a cada 10 segundos para maior precisão
}

async function mudarQtdItem(index, qtd) { 
  const novaQtd = parseInt(qtd);
  const itemNoPedido = itensEmEdicao[index];
  
  const itemNoMenu = cardapio.find(m => m.id === itemNoPedido.menu_id);

  if (novaQtd > itemNoPedido.quantidade && itemNoMenu && itemNoMenu.estoque !== -1) {
    if (novaQtd > itemNoMenu.estoque + itemNoPedido.quantidade) {
      await mostrarAlerta(`Estoque insuficiente! Você pode adicionar no máximo mais ${itemNoMenu.estoque} unidades deste item.`, "Estoque", "📦");
      renderizarItensEdicao();
      return;
    }
  }

  if (novaQtd > 0) {
    if (novaQtd > itemNoPedido.quantidade) {
        // Se o item já foi entregue ou está pronto, não alteramos este item diretamente.
        // Adicionamos a diferença como um novo item 'pendente'.
        if (itemNoPedido.status === 'entregue' || itemNoPedido.status === 'pronto') {
            const diferenca = novaQtd - itemNoPedido.quantidade;
            const existPendente = itensEmEdicao.find(i => 
                i.menu_id === itemNoPedido.menu_id && 
                i.status === 'pendente' && 
                (i.observacao || '') === (itemNoPedido.observacao || '')
            );
            if (existPendente) {
                existPendente.quantidade += diferenca;
            } else {
                itensEmEdicao.push({
                    ...itemNoPedido,
                    id: undefined,
                    quantidade: diferenca,
                    status: 'pendente',
                    selecionado: false
                });
            }
            // Não alteramos a quantidade do item original aqui, pois ele mantém o que já foi entregue
        } else {
            // Se já era pendente, apenas aumenta a quantidade
            itemNoPedido.quantidade = novaQtd;
        }
    } else {
        // Redução de quantidade: diminui o item atual
        itemNoPedido.quantidade = novaQtd;
    }
    renderizarItensEdicao(); 
    renderizarMenuEdicao(categoriaEdicaoAtual); // Re-renderiza cardápio para atualizar estoque disponível
  }
}

async function removerItemEdicao(index) { 
  const item = itensEmEdicao[index];
  
  itensEmEdicao.splice(index, 1); 
  renderizarItensEdicao(); 
  renderizarMenuEdicao(categoriaEdicaoAtual); // Re-renderiza cardápio para atualizar estoque disponível
}

function calcularMinutos(dataIso) {
  if (!dataIso) return 0;
  let d = dataIso;
  // Se for string no formato YYYY-MM-DD HH:MM:SS (padrão do backend)
  // Adicionamos 'Z' para que o navegador trate como UTC e converta para o fuso local
  if (typeof d === 'string' && d.includes('-') && d.includes(':') && !d.includes('Z') && !d.includes('+')) {
    d = d.replace(' ', 'T') + 'Z';
  }
  const data = new Date(d);
  const agora = new Date();
  const diffMs = agora - data;
  return Math.floor(diffMs / 60000);
}

// Controle para não tocar som de atraso repetidamente para o mesmo pedido
let pedidosAtrasadosNotificados = new Set();

function atualizarCronometrosPedidos() {
  // Busca todos os cronômetros presentes na página (independente do container)
  const spans = document.querySelectorAll('.pedido-cronometro');
  
  spans.forEach((span) => {
    const card = span.closest('.pedido-card');
    if (!card) return;

    const createdAt = span.dataset.createdAt;
    // Pega o ID do pedido para o controle de som
    const pedidoId = card.dataset.pedidoId || (card.id ? card.id.replace('pedido-card-', '') : null);
    
    // ATUALIZA se o card existir e o status for 'recebido' (verde) ou 'fechamento' (amarelo)
    const isRecebido = card.classList.contains('status-recebido');
    let isFechamento = card.classList.contains('alerta-fechamento');

    // Para delivery, "fechamento" significa "Entregue", não queremos cronômetro contando nessa fase
    if (card.dataset.mesa && card.dataset.mesa.includes('DELIVERY') && isFechamento) {
        isFechamento = false;
    }

    if ((!isRecebido && !isFechamento) || !createdAt) {
      span.style.display = 'none';
      card.classList.remove('alerta-borda-pisca');
      if (pedidoId) pedidosAtrasadosNotificados.delete(pedidoId);
      return;
    }

    const minutos = calcularMinutos(createdAt);
    span.textContent = `⏱️ ${minutos} min`;
    span.style.display = '';
    
    // ALERTA SE PASSAR DE 10 MINUTOS
    if (minutos >= 10) {
      card.classList.add('alerta-borda-pisca');
      
      // Toca som e mostra notificação apenas uma vez por pedido quando atinge o atraso
      if (pedidoId && !pedidosAtrasadosNotificados.has(pedidoId)) {
        console.log(`🚨 ALERTA: Pedido #${pedidoId} esperando há ${minutos} min!`);
        tocarNotificacao('windows'); // Som de alerta curto
        
        const mesaNome = card.dataset.mesa || `Pedido #${pedidoId}`;
        const motivo = isFechamento ? 'SOLICITOU CONTA' : 'PEDIDO PENDENTE';
        exibirNotificacaoNativa(`⚠️ ATRASO: ${mesaNome}`, `${motivo} há ${minutos} minutos!`, `atraso-${pedidoId}`);

        pedidosAtrasadosNotificados.add(pedidoId);
      }
    } else {
      card.classList.remove('alerta-borda-pisca');
      if (pedidoId) pedidosAtrasadosNotificados.delete(pedidoId);
    }
  });
}

function switchTab(tab) {
  // Salva a posição do scroll antes de trocar
  const scrollPos = window.scrollY;
  abaAtiva = tab;
  
  // BLOQUEIO DE SCROLL GLOBAL: Na aba de ativos, lançamento e whatsapp para manter o app fixo
  if (tab === 'lancar' || tab === 'ativos' || tab === 'whatsapp') {
      document.body.classList.add('modal-open');
      window.scrollTo({ top: 0, behavior: 'instant' }); 
      document.documentElement.style.overflow = 'hidden'; // Força trava extra no HTML
  } else {
      document.body.classList.remove('modal-open'); 
      document.documentElement.style.overflow = ''; // Libera para histórico/config
  }

  // Se entrou na aba do WhatsApp, zera a notificação local para obrigar nova contagem
  if (tab === 'whatsapp') {
      mensagensNaoLidasWhatsapp = 0;
      const badge = document.getElementById('badge-whatsapp-contador');
      const icon = document.getElementById('whatsapp-tab-icon');
      if (badge) {
          badge.innerText = '0';
          badge.classList.add('hidden');
      }
      if (icon) icon.classList.remove('hidden');
  }

  // Remove classe active de todos os botões
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

  // Notifica o iframe do WhatsApp se a aba está ativa ou não
  const zapIframe = document.getElementById('whatsapp-iframe');
  if (zapIframe && zapIframe.contentWindow) {
      zapIframe.contentWindow.postMessage({ type: 'tab_change', active: (tab === 'whatsapp') }, '*');
  }

  // Tenta encontrar o botão correspondente à aba e ativa-o
  const botoes = document.querySelectorAll('.tab-btn');
  const mapaAbas = {
    'ativos': 'Pedidos Ativos',
    'lancar': 'Lançar Pedido',
    'historico': 'Histórico',
    'caixa': 'Caixa',
    'whatsapp': 'WhatsApp',
    'configuracoes': 'Configurações'
  };
  
  botoes.forEach(btn => {
    if (btn.innerText.includes(mapaAbas[tab])) {
      btn.classList.add('active');
    }
  });

  const secoes = ['ativos', 'historico', 'configuracoes', 'caixa', 'lancar', 'whatsapp'];
  secoes.forEach(s => {
    const el = document.getElementById(`${s}-section`);
    if (el) el.classList.toggle('hidden', s !== tab);
  });

  // Restaura a posição do scroll para evitar pulos
  window.scrollTo(0, scrollPos);

  if (tab === 'ativos') carregarPedidos();
  else if (tab === 'historico') carregarHistorico();
  else if (tab === 'configuracoes') {
    carregarDadosConfig();
    switchConfigSubTab('mesas'); // Abre por padrão na sub-aba de Mesas
  }
  else if (tab === 'caixa') carregarStatusCaixa();
  else if (tab === 'lancar') prepararLancarPedido();
  else if (tab === 'whatsapp') carregarStatusWhatsApp();
}

/**
 * Alterna entre sub-abas dentro da aba de Configurações
 */
function switchConfigSubTab(subTab) {
  // Remove classe active de todos os botões da sidebar
  document.querySelectorAll('.config-nav-btn').forEach(btn => btn.classList.remove('active'));
  
  // Oculta todas as sub-seções
  document.querySelectorAll('.config-sub-section').forEach(sec => sec.classList.remove('active'));
  
  // Ativa o botão correspondente
  const btn = document.querySelector(`.config-nav-btn[onclick*="'${subTab}'"]`);
  if (btn) btn.classList.add('active');
  
  // Exibe a seção correspondente
  const section = document.getElementById(`config-sub-${subTab}`);
  if (section) section.classList.add('active');
}

async function carregarStatusWhatsApp() {
  const badge = document.getElementById('whatsapp-status-badge');
  const numberEl = document.getElementById('whatsapp-notify-number');
  const toggle = document.getElementById('toggle-whatsapp');
  if (!badge) return;

  try {
    const res = await fetch('/api/whatsapp-status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const status = await res.json();

    if (!status.configured) {
      badge.textContent = 'NÃO CONFIGURADO';
      badge.style.background = '#fee2e2';
      badge.style.color = '#ef4444';
    } else if (status.connected) {
      badge.textContent = 'CONECTADO';
      badge.style.background = '#dcfce7';
      badge.style.color = '#166534';
    } else {
      badge.textContent = 'DESCONECTADO';
      badge.style.background = '#fef9c3';
      badge.style.color = '#854d0e';
    }

    if (toggle) toggle.checked = status.enabled;
    if (numberEl) numberEl.textContent = status.number || 'Não configurado';

    // Atualiza o iframe dinamicamente para o bot configurado
    const iframe = document.getElementById('whatsapp-iframe');
    if (iframe && status.botUrl) {
      try {
        // Normaliza as URLs para comparação segura (protege contra URL inválida ou about:blank)
        const currentUrl = (iframe.src && iframe.src.startsWith('http')) ? new URL(iframe.src).origin : '';
        const targetUrl = new URL(status.botUrl).origin;
        if (currentUrl !== targetUrl) {
          console.log('🔄 Atualizando URL do robô WhatsApp:', targetUrl);
          iframe.src = status.botUrl;
        }
      } catch (urlErr) {
        console.warn('⚠️ Erro ao validar URL do robô:', urlErr.message);
      }
    }
  } catch (e) {
    console.error('❌ Erro no status do WhatsApp:', e);
    badge.textContent = 'FALHA NA REQUISIÇÃO';
    badge.style.background = '#fee2e2';
    badge.style.color = '#ef4444';
  }
}

async function alternarWhatsApp(ativo) {
  try {
    const res = await fetch('/api/whatsapp-toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: ativo })
    });
    if (res.ok) {
      mostrarToast(`🤖 Robô WhatsApp ${ativo ? 'ATIVADO' : 'DESATIVADO'}`);
    }
  } catch (e) {
    console.error('Erro ao alternar WhatsApp:', e);
    mostrarToast('❌ Erro ao alterar status do robô');
  }
}

function scrollCategoriasLancar(delta) {
  const container = document.getElementById('lancar-menu-categorias');
  if (container) {
    container.scrollBy({ left: delta, behavior: 'smooth' });
  }
}

function scrollCategoriasEdicao(delta) {
  const container = document.getElementById('edit-menu-categorias');
  if (container) {
    container.scrollBy({ left: delta, behavior: 'smooth' });
  }
}

let carrinhoLancar = [];

async function prepararLancarPedido() {
  carrinhoLancar = [];
  await carregarMesasLancar();
  exibirCategoriasLancar();
  exibirMenuLancar('todas');
  renderizarCarrinhoLancar();
}

async function carregarMesasLancar() {
  const res = await fetch('/api/mesas');
  const mesas = await res.json();
  const select = document.getElementById('lancar-mesa-select');
  if (!select) return;
  
  select.innerHTML = '<option value="">Selecione a Mesa</option>' + 
    '<option value="BALCAO" style="font-weight:bold; color:#27ae60;">🏪 BALCÃO / VENDA DIRETA</option>' +
    '<option value="DELIVERY" style="font-weight:bold; color:#e67e22;">🛵 DELIVERY</option>' +
    mesas.map(m => `<option value="${m.id}">Mesa ${m.numero} (${m.status.toUpperCase()})</option>`).join('');
}

function exibirCategoriasLancar() {
  const container = document.getElementById('lancar-menu-categorias');
  if (!container) return;

  if (!container.dataset.wheelAdded) {
    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      container.scrollLeft += e.deltaY;
    });
    container.dataset.wheelAdded = 'true';
  }

  const cardapioAtivo = cardapio.filter(i => i.visivel !== false && i.visivel !== 0);
  const categoriasUnicas = [...new Set(cardapioAtivo.map(item => item.categoria.trim().toLowerCase()))];
  const categorias = ['todas', ...categoriasUnicas];
  container.innerHTML = categorias.map(cat => {
    const nomeExibicao = cat === 'todas' ? 'Todos' : cat.charAt(0).toUpperCase() + cat.slice(1);
    return `<div class="cat-mini ${cat === 'todas' ? 'ativa' : ''}" id="cat-lancar-${cat}" onclick="selecionarCategoriaLancar('${cat}')">${nomeExibicao}</div>`;
  }).join('');
}

function selecionarCategoriaLancar(cat) {
  document.querySelectorAll('#lancar-menu-categorias .cat-mini').forEach(c => c.classList.remove('ativa'));
  const el = document.getElementById(`cat-lancar-${cat}`);
  if (el) el.classList.add('ativa');
  exibirMenuLancar(cat);
}

function exibirMenuLancar(categoria) {
  const container = document.getElementById('lancar-menu-grid');
  if (!container) return;
  
  const cardapioAtivo = cardapio.filter(i => i.visivel !== false && i.visivel !== 0);
  const itens = categoria === 'todas' ? cardapioAtivo : cardapioAtivo.filter(i => i.categoria.trim().toLowerCase() === categoria);
  container.innerHTML = itens.map(item => {
    let estoqueNum = -1;
    if (item.estoque !== null && item.estoque !== undefined && item.estoque !== '') {
      estoqueNum = parseInt(item.estoque);
    }
    if (isNaN(estoqueNum)) estoqueNum = -1;
    
    // CÁLCULO DE SINCRONIZAÇÃO: Subtrai o que já está no carrinho
    const noCarrinho = carrinhoLancar.filter(c => c.menu_id === item.id).reduce((s, i) => s + i.quantidade, 0);
    const disponivelReal = (estoqueNum !== -1) ? (estoqueNum - noCarrinho) : -1;
    
    const temEstoqueDefinido = estoqueNum !== -1;

    return `
    <div class="item-menu-mini" onclick="adicionarAoCarrinhoLancar(${item.id})" style="position: relative; display: flex; flex-direction: column; opacity: ${disponivelReal === 0 ? '0.6' : '1'}; min-height: 155px !important; height: auto !important; background: white; border-radius: 12px; overflow: hidden; border: 1px solid #eee; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
      <!-- Container de Info (TOPO DIREITO) -->
      <div style="position: absolute; top: 6px; right: 6px; z-index: 10; display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
        <!-- Preço -->
        <div style="background: #27ae60; color: white; padding: 4px 8px; border-radius: 6px; font-weight: 900; font-size: 1.0rem; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">R$ ${item.preco.toFixed(2)}</div>

        <!-- Info de ESTOQUE -->
        <div style="background: ${disponivelReal <= 0 ? '#e74c3c' : '#3498db'}; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 0.8rem; display: flex; align-items: center; gap: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
          ${temEstoqueDefinido ? `<span>📦</span> ${disponivelReal}` : '<span>♾️</span> Ilimitado'}
        </div>
        
        <!-- Promoção e Cozinha -->
        ${item.em_promocao ? `<div style="background: #f1c40f; color: #2c3e50; padding: 2px 6px; border-radius: 4px; font-weight: 900; font-size: 0.75rem; display: flex; align-items: center; gap: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">🔥 Promo ${item.preco_original ? `<span style="text-decoration: line-through; opacity: 0.75; font-weight: 600; margin-left: 2px;">R$ ${Number(item.preco_original).toFixed(2)}</span>` : ''}</div>` : ''}
        ${isItemParaCozinha(item) ? `<div style="background: #e74c3c; color: white; padding: 2px 6px; border-radius: 4px; font-weight: 900; font-size: 0.75rem; display: flex; align-items: center; gap: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">🍳 Cozinha</div>` : ''}
      </div>

      <img src="${item.imagem}" alt="${item.nome}" style="filter: ${disponivelReal === 0 ? 'grayscale(1)' : 'none'}; height: 110px !important; width: 100%; object-fit: cover; display: block; border-bottom: 1px solid #f0f0f0;">
      <div style="padding: 4px 8px !important; display: flex; flex-direction: column; flex-grow: 1; justify-content: flex-start;">
        <h4 style="margin: 0 !important; font-size: 0.85rem !important; color: #2c3e50 !important; line-height: 1.1 !important; font-weight: 700 !important; white-space: normal !important; text-align: left !important;">${item.nome}</h4>
      </div>
    </div>
    `}).join('');}

async function adicionarAoCarrinhoLancar(itemId) {
  const item = cardapio.find(m => m.id === itemId);
  if (!item) return;
  
  // Cálculo do que já está no carrinho para validar estoque antes de adicionar
  const noCarrinho = carrinhoLancar.filter(c => c.menu_id === itemId).reduce((s, i) => s + i.quantidade, 0);
  
  if (item.estoque !== -1 && (noCarrinho + 1) > item.estoque) {
    return await mostrarAlerta("Limite de estoque atingido!", "Estoque", "📦");
  }

  const exist = carrinhoLancar.find(c => c.menu_id === itemId);
  if (exist) {
    exist.quantidade++;
  } else {
    carrinhoLancar.push({ menu_id: item.id, nome: item.nome, preco: item.preco, quantidade: 1 });
  }
  
  renderizarCarrinhoLancar();
  // Força atualização do estoque no cardápio
  const catAtiva = document.querySelector('#lancar-menu-categorias .cat-mini.ativa');
  const catNome = catAtiva ? catAtiva.id.replace('cat-lancar-', '') : 'todas';
  exibirMenuLancar(catNome);
}

function renderizarCarrinhoLancar() {
  const container = document.getElementById('lancar-carrinho');
  if (!container) return;
  
  const cobrarTaxa = document.getElementById('lancar-taxa-toggle') ? document.getElementById('lancar-taxa-toggle').checked : true;

  if (carrinhoLancar.length === 0) {
    container.innerHTML = '<p style="text-align: center; margin-top: 2rem; opacity: 0.5;">Adicione itens do cardápio...</p>';
    const elTotal = document.getElementById('lancar-total');
    if (elTotal) elTotal.innerText = 'R$ 0,00';
    return;
  }
  
  let subtotal = 0;
  container.innerHTML = carrinhoLancar.map((item, index) => {
    subtotal += item.preco * item.quantidade;
    // Busca a imagem do item no cardápio global
    const itemMenu = cardapio.find(m => m.id === item.menu_id);
    const imagemUrl = itemMenu ? itemMenu.imagem : 'https://placehold.co/50';

    return `
      <div class="item-edicao" style="padding: 10px; margin-bottom: 10px; border-radius: 12px; background: #fff; border: 1px solid #e2e8f0; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
        
        <!-- LINHA 1: IMAGEM + NOME + REMOVER -->
        <div style="display: flex; align-items: center; gap: 10px;">
          <img src="${imagemUrl}" style="width: 45px; height: 45px; border-radius: 8px; object-fit: cover; background: #f8fafc; border: 1px solid #eee;">
          
          <div style="flex: 1; min-width: 0; text-align: left;">
            <strong style="font-size: 0.9rem; color: #1e293b; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.nome}</strong>
            <span style="font-size: 0.8rem; color: #64748b; font-weight: bold;">R$ ${item.preco.toFixed(2)} un.</span>
          </div>

          <button onclick="removerDoCarrinhoLancar(${index})" style="width: 28px; height: 28px; border-radius: 6px; border: none; background: #fef2f2; color: #ef4444; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; transition: all 0.2s ease; flex-shrink: 0;" onmouseover="this.style.background='#fee2e2'" onmouseout="this.style.background='#fef2f2'">✕</button>
        </div>
        
        <!-- OBSERVAÇÃO -->
        <div style="margin: 2px 0;">
          <input type="text" 
                 placeholder="📝 Observação..." 
                 value="${item.observacao || ''}" 
                 oninput="carrinhoLancar[${index}].observacao = this.value"
                 style="width: 100%; padding: 6px 10px; border-radius: 6px; border: 1px solid #edf2f7; font-size: 0.8rem; background: #fdfdfd;">
        </div>

        <!-- LINHA 2: CONTROLES + SUBTOTAL DA LINHA -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 5px; border-top: 1px solid #f1f5f9;">
          <div style="display: flex; align-items: center; border: 1.5px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #fff; height: 32px;">
            <button onclick="alterarQtdCarrinhoLancar(${index}, ${item.quantidade - 1})" 
                    style="width: 32px; height: 100%; border: none; background: #fff; color: #ef4444; font-weight: bold; cursor: pointer; border-right: 1.5px solid #e2e8f0;">-</button>
            <span style="min-width: 35px; text-align: center; font-weight: 800; font-size: 0.9rem; color: #1e293b;">${item.quantidade}</span>
            <button onclick="alterarQtdCarrinhoLancar(${index}, ${item.quantidade + 1})" 
                    style="width: 32px; height: 100%; border: none; background: #fff; color: #22c55e; font-weight: bold; cursor: pointer; border-left: 1.5px solid #e2e8f0;">+</button>
          </div>
          <strong style="color: #166534; font-size: 1rem; font-weight: 800;">R$ ${(item.preco * item.quantidade).toFixed(2)}</strong>
        </div>
      </div>`;
  }).join('');
  
  const total = cobrarTaxa ? subtotal * 1.10 : subtotal;
  const elTotal = document.getElementById('lancar-total');
  if (elTotal) elTotal.innerText = `R$ ${total.toFixed(2)}`;
}

async function limparCarrinhoLancar() {
  if (carrinhoLancar.length === 0) return;
  if (await mostrarConfirmacao("Deseja esvaziar todo o carrinho?", "Limpar Tudo", "Confirmar", "Cancelar", "🗑️")) {
    carrinhoLancar = [];
    renderizarCarrinhoLancar();
    // Força atualização do estoque no cardápio
    const catAtiva = document.querySelector('#lancar-menu-categorias .cat-mini.ativa');
    const catNome = catAtiva ? catAtiva.id.replace('cat-lancar-', '') : 'todas';
    exibirMenuLancar(catNome);
    mostrarToast("🗑️ Carrinho esvaziado");
  }
}

async function alterarQtdCarrinhoLancar(index, qtd) {
  const novaQtd = parseInt(qtd);
  if (novaQtd <= 0) return; // Se for 0, usa o botão de remover

  const itemMenu = cardapio.find(m => m.id === carrinhoLancar[index].menu_id);
  if (itemMenu && itemMenu.estoque !== -1 && novaQtd > itemMenu.estoque) {
    await mostrarAlerta("Estoque insuficiente!", "Estoque", "📦");
    return;
  }
  
  carrinhoLancar[index].quantidade = novaQtd; 
  renderizarCarrinhoLancar(); 
  
  // Força atualização do estoque no cardápio
  const catAtiva = document.querySelector('#lancar-menu-categorias .cat-mini.ativa');
  const catNome = catAtiva ? catAtiva.id.replace('cat-lancar-', '') : 'todas';
  exibirMenuLancar(catNome);
}

function removerDoCarrinhoLancar(index) { 
  carrinhoLancar.splice(index, 1); 
  renderizarCarrinhoLancar(); 
  
  // Força atualização do estoque no cardápio
  const catAtiva = document.querySelector('#lancar-menu-categorias .cat-mini.ativa');
  const catNome = catAtiva ? catAtiva.id.replace('cat-lancar-', '') : 'todas';
  exibirMenuLancar(catNome);
}

let enviandoPedidoLote = false;

async function enviarPedidoLoteAdmin() {
  if (enviandoPedidoLote) return;

  let mesaId = document.getElementById('lancar-mesa-select').value;
  if (!mesaId) return await mostrarAlerta("Selecione a mesa, BALCÃO ou DELIVERY!", "Aviso", "⚠️");
  if (carrinhoLancar.length === 0) return await mostrarAlerta("Carrinho vazio!", "Aviso", "⚠️");

  const isDelivery = (mesaId === 'DELIVERY');
  const garcomId = isDelivery ? 'DELIVERY' : 'ADMIN';

  const cobrarTaxa = document.getElementById('lancar-taxa-toggle').checked;
  const subtotal = carrinhoLancar.reduce((s,i) => s + (i.preco * i.quantidade), 0);

  if (!await mostrarConfirmacao(`Confirmar lançamento de R$ ${(cobrarTaxa ? subtotal * 1.10 : subtotal).toFixed(2)}?`, "Novo Pedido", "Confirmar", "Cancelar", "🚀")) return;

  enviandoPedidoLote = true;
  const btn = document.querySelector("button[onclick='enviarPedidoLoteAdmin()']");
  if (btn) { btn.disabled = true; btn.innerText = "⏳ ENVIANDO..."; }

  let pedidoExistente = null;
  if (mesaId !== 'BALCAO' && mesaId !== 'DELIVERY') {
    const resMesa = await fetch(`/api/pedidos/mesa/${mesaId}`);
    pedidoExistente = await resMesa.json();
  } else {
    mesaId = null;
  }

  const url = pedidoExistente ? `/api/pedidos/${pedidoExistente.id}/adicionar` : '/api/pedidos';
  const method = pedidoExistente ? 'PUT' : 'POST';
  const body = pedidoExistente
    ? { itens: carrinhoLancar, cobrar_taxa: cobrarTaxa }
    : { mesa_id: mesaId, garcom_id: garcomId, itens: carrinhoLancar, cobrar_taxa: cobrarTaxa };

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (res.ok) {
      const data = await res.json();
      const novoPedidoId = data.id || (pedidoExistente ? pedidoExistente.id : null);

      // Salva a escolha da taxa para este pedido
      pedidosStatusTaxa[novoPedidoId] = cobrarTaxa;

      const sel = document.getElementById('lancar-mesa-select');
      const nomeMesa = sel.options[sel.selectedIndex].text.replace('Mesa ', '').split(' ')[0];

      carrinhoLancar = [];
      renderizarCarrinhoLancar();
      
      // MOSTRA MODAL DE DECISÃO
      const modalDecisao = document.getElementById('modal-decisao-pos-lancar');
      modalDecisao.style.display = 'flex';
      document.body.classList.add('modal-open');

      document.getElementById('btn-decisao-fechar').onclick = async () => {
        modalDecisao.style.display = 'none';
        document.body.classList.remove('modal-open');
        aprovarFechamento(novoPedidoId, mesaId, nomeMesa);
      };
      document.getElementById('btn-decisao-manter').onclick = () => {
        modalDecisao.style.display = 'none';
        document.body.classList.remove('modal-open');
        mostrarToast("⏳ Pedido mantido nos Ativos!");
        switchTab('ativos');
      };
    } else {
      const err = await res.json();
      await mostrarAlerta("Erro: " + err.error, "Erro", "❌");
    }
  } catch (e) {
    await mostrarAlerta("Erro de conexão", "Erro", "❌");
  } finally {
    enviandoPedidoLote = false;
    if (btn) { btn.disabled = false; btn.innerText = "🚀 LANÇAR PEDIDO"; }
  }
}
async function carregarStatusCaixa() {
  try {
    const res = await fetch('/api/caixa/status');
    if (!res.ok) return; // Proteção se falhar
    
    caixaAtual = await res.json();
    // Verifica se veio um objeto válido (pode vir null se não tiver caixa aberto, mas não erro)
  } catch (e) {
    console.error("Erro ao carregar caixa:", e);
    return;
  }
  
  const badge = document.getElementById('caixa-status-badge-admin');
  if (badge) {
    badge.style.display = 'inline-block';
    if (caixaAtual) {
      badge.textContent = 'CAIXA ABERTO';
      badge.className = 'badge-caixa aberto';
    } else {
      badge.textContent = 'CAIXA FECHADO';
      badge.className = 'badge-caixa fechado';
    }
  }

  const fechadoView = document.getElementById('caixa-fechado-view');
  const abertoView = document.getElementById('caixa-aberto-view');
  
  if (caixaAtual) {
    fechadoView.classList.add('hidden');
    abertoView.classList.remove('hidden');
    
    // Verifica se os campos existem antes de acessar .toFixed
    document.getElementById('resumo-caixa-inicial').innerText = `R$ ${(caixaAtual.valor_inicial || 0).toFixed(2)}`;
    document.getElementById('resumo-caixa-vendas').innerText = `R$ ${(caixaAtual.total_vendas || 0).toFixed(2)}`;
    document.getElementById('resumo-caixa-dinheiro').innerText = `R$ ${((caixaAtual.valor_inicial || 0) + (caixaAtual.total_dinheiro || 0)).toFixed(2)}`;
    
    document.getElementById('detalhe-caixa-dinheiro').innerText = `R$ ${(caixaAtual.total_dinheiro || 0).toFixed(2)}`;
    document.getElementById('detalhe-caixa-pix').innerText = `R$ ${(caixaAtual.total_pix || 0).toFixed(2)}`;
    document.getElementById('detalhe-caixa-cartao').innerText = `R$ ${(caixaAtual.total_cartao || 0).toFixed(2)}`;
  } else {
    fechadoView.classList.remove('hidden');
    abertoView.classList.add('hidden');
  }
}

async function abrirCaixa() {
  const inputValor = document.getElementById('caixa-valor-inicial');
  const valor = parseFloat(inputValor.value) || 0;

  if (valor <= 0) {
    return await mostrarAlerta("O valor inicial do caixa deve ser maior que zero (Fundo de troco).", "Aviso", "⚠️");
  }

  const res = await fetch('/api/caixa/abrir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ valor_inicial: valor })
  });
  if (res.ok) {
    mostrarToast("Caixa aberto com sucesso!", "success");
    carregarStatusCaixa();
  }
}

async function confirmarFechamentoCaixa() {
  if (!await mostrarConfirmacao("Tem certeza que deseja FECHAR O CAIXA e encerrar o expediente?", "Fechar Caixa", "Confirmar", "Cancelar", "💰")) return;
  
  // Guardamos uma cópia dos dados do caixa antes de fechar para o relatório
  const dadosCaixaParaRelatorio = { ...caixaAtual };
  const valorFinal = caixaAtual.valor_inicial + caixaAtual.total_dinheiro + caixaAtual.total_pix + caixaAtual.total_cartao;
  
  const res = await fetch('/api/caixa/fechar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: caixaAtual.id, valor_final: valorFinal })
  });
  
  if (res.ok) {
    await mostrarAlerta(`Caixa fechado com sucesso!\n\nTotal de Vendas: R$ ${dadosCaixaParaRelatorio.total_vendas.toFixed(2)}\nDinheiro em Caixa: R$ ${(dadosCaixaParaRelatorio.valor_inicial + dadosCaixaParaRelatorio.total_dinheiro).toFixed(2)}`, "Sucesso", "✅");
    
    // Zera os indicadores de faturamento e vendas no topo imediatamente
    const elFat = document.getElementById('faturamento-resumo');
    const elVendas = document.getElementById('vendas-dia-resumo');
    if (elFat) elFat.innerText = `R$ 0,00`;
    if (elVendas) elVendas.innerText = `R$ 0,00`;
    
    // Pergunta se deseja imprimir o resumo (PDF)
    // Forçamos a variável global temporariamente para o imprimirResumoDiario usar os dados corretos
    const caixaOriginal = caixaAtual;
    caixaAtual = dadosCaixaParaRelatorio;
    
    await carregarHistorico(); // Garante que o histórico está carregado
    
    if (await mostrarConfirmacao("Deseja imprimir o resumo diário (PDF) do histórico de vendas?", "Imprimir Resumo", "Sim, Imprimir", "Não agora", "💰")) {
        await imprimirResumoDiario();
    }

    // Pergunta se deseja limpar o histórico
    if (await mostrarConfirmacao("Deseja LIMPAR o histórico de pedidos entregues e cancelados agora?", "Limpar Histórico", "Sim, Limpar", "Não", "🗑️")) {
        await limparHistoricoTotal();
    }

    // Restaura e atualiza o status real
    caixaAtual = caixaOriginal;
    carregarStatusCaixa();
  } else {
    const err = await res.json();
    await mostrarAlerta("⚠️ Erro ao fechar caixa: " + (err.error || "Erro desconhecido"), "Erro", "❌");
  }
}

async function carregarDadosConfig() {
  await Promise.all([exibirMesasConfig(), exibirGarconsConfig(), exibirMenuConfig(), exibirConfigCategoriasCozinha(), exibirConfigOrdemCategorias()]);
}

// ORDEM DAS CATEGORIAS
let estadoOrdemCategorias = [];

async function exibirConfigOrdemCategorias() {
  const container = document.getElementById('config-ordem-categorias-lista');
  if (!container) return;

  try {
    const resMenu = await fetch('/api/menu');
    const menu = await resMenu.json();
    const categoriasExistentes = [...new Set(menu.map(item => item.categoria.trim()))];
    
    // Tenta carregar a ordem salva do banco
    const resOrdem = await fetch('/api/config/categorias-cozinha'); // Reusando o objeto de config geral se necessário, ou pegando do menu que já vem ordenado
    // Como o /api/menu agora já retorna ordenado pelo server, as categoriasExistentes virão na ordem correta se o server estiver ok.
    // Mas para garantir a manipulação, vamos usar o estadoOrdemCategorias
    estadoOrdemCategorias = categoriasExistentes;

    renderizarListaOrdemCategorias();
  } catch (e) {
    console.error('Erro ao carregar ordem das categorias:', e);
  }
}

function renderizarListaOrdemCategorias() {
  const container = document.getElementById('config-ordem-categorias-lista');
  if (!container) return;

  if (estadoOrdemCategorias.length === 0) {
    container.innerHTML = '<p style="text-align:center; opacity:0.5; padding: 20px;">Nenhuma categoria encontrada no cardápio.</p>';
    return;
  }

  container.innerHTML = estadoOrdemCategorias.map((cat, index) => `
    <div style="display: flex; align-items: center; justify-content: space-between; background: white; padding: 10px 15px; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="background: #edf2f7; color: #4a5568; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 0.75rem; font-weight: bold;">${index + 1}</span>
        <strong style="color: #2c3e50; font-size: 0.9rem;">${cat}</strong>
      </div>
      <div style="display: flex; gap: 5px;">
        <button onclick="moverCategoria(${index}, -1)" ${index === 0 ? 'disabled style="opacity:0.3; cursor:default;"' : 'style="cursor:pointer;"'} title="Mover para cima" style="background: #f1f5f9; border: 1px solid #cbd5e0; padding: 5px 10px; border-radius: 4px; color: #2c3e50; font-weight: bold;">▲</button>
        <button onclick="moverCategoria(${index}, 1)" ${index === estadoOrdemCategorias.length - 1 ? 'disabled style="opacity:0.3; cursor:default;"' : 'style="cursor:pointer;"'} title="Mover para baixo" style="background: #f1f5f9; border: 1px solid #cbd5e0; padding: 5px 10px; border-radius: 4px; color: #2c3e50; font-weight: bold;">▼</button>
      </div>
    </div>
  `).join('');
}

function moverCategoria(index, direcao) {
  const novoIndex = index + direcao;
  if (novoIndex < 0 || novoIndex >= estadoOrdemCategorias.length) return;

  const temp = estadoOrdemCategorias[index];
  estadoOrdemCategorias[index] = estadoOrdemCategorias[novoIndex];
  estadoOrdemCategorias[novoIndex] = temp;

  renderizarListaOrdemCategorias();
}

async function salvarOrdemCategorias() {
  try {
    const res = await fetch('/api/config/ordem-categorias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ordem: estadoOrdemCategorias })
    });

    if (res.ok) {
      await mostrarAlerta("✅ Ordem das categorias salva com sucesso!", "Sucesso", "✅");
      // Recarrega o menu globalmente
      if (typeof carregarMenu === 'function') await carregarMenu();
    } else {
      await mostrarAlerta("❌ Erro ao salvar ordem das categorias.", "Erro", "❌");
    }
  } catch (e) {
    console.error('Erro ao salvar ordem:', e);
    await mostrarAlerta("❌ Erro de conexão ao salvar.", "Erro", "❌");
  }
}

// CONFIGURAÇÃO DE CATEGORIAS DA COZINHA
async function exibirConfigCategoriasCozinha() {
  const container = document.getElementById('lista-categorias-cozinha-config');
  if (!container) return;

  try {
    // Busca todas as categorias existentes no menu
    const resMenu = await fetch('/api/menu');
    const menu = await resMenu.json();
    const categorias = [...new Set(menu.map(item => item.categoria.trim().toUpperCase()))].sort();

    // Busca as categorias configuradas para a cozinha
    await carregarConfigCategoriasCozinha();
    const configuradas = configCozinhaCategorias;

    if (categorias.length === 0) {
      container.innerHTML = '<p style="text-align:center; opacity:0.5; padding:10px;">Nenhuma categoria encontrada no cardápio.</p>';
      return;
    }

    container.innerHTML = categorias.map(cat => `
      <div style="display: flex; align-items: center; gap: 10px; background: white; padding: 10px; border-radius: 8px; border: 1px solid #e2e8f0;">
        <input type="checkbox" id="check-cat-cozinha-${cat}" class="check-cat-cozinha" value="${cat}" ${configuradas.includes(cat) ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
        <label for="check-cat-cozinha-${cat}" style="margin: 0; font-weight: bold; color: #2c3e50; cursor: pointer; flex: 1;">${cat}</label>
        <button onclick="editarCategoria('${cat}')" style="background: none; border: none; cursor: pointer; font-size: 1.1rem; padding: 5px;" title="Editar Nome da Categoria">✏️</button>
      </div>
    `).join('');
  } catch (e) {
    console.error('Erro ao carregar config de cozinha:', e);
    container.innerHTML = '<p style="color:red; padding:10px;">Erro ao carregar configurações.</p>';
  }
}

async function salvarConfigCategoriasCozinha() {
  const checks = document.querySelectorAll('.check-cat-cozinha:checked');
  const categorias = Array.from(checks).map(c => c.value.trim().toUpperCase());

  try {
    const res = await fetch('/api/config/categorias-cozinha', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categorias })
    });

    if (res.ok) {
      configCozinhaCategorias = categorias; // Atualiza localmente
      await carregarCardapio(); // RECARREGA O CARDÁPIO PARA SINCRONIZAR OS ITENS
      await mostrarAlerta("✅ Configuração de cozinha salva com sucesso! Todos os itens do cardápio foram sincronizados automaticamente.", "Sucesso", "✅");
    } else {
      throw new Error('Falha ao salvar');
    }
  } catch (e) {
    console.error(e);
    await mostrarAlerta("❌ Erro ao salvar configuração.", "Erro", "❌");
  }
}

// MESAS
async function exibirMesasConfig() {
  const res = await fetch('/api/mesas');
  if (!res.ok) return; // Proteção contra 401
  const mesas = await res.json();
  if (!Array.isArray(mesas)) return; // Garante que é array antes de mapear
  
  const container = document.getElementById('lista-mesas-config');
  if (!container) return;
  container.innerHTML = mesas.map(m => `<div class="item-config"><span>Mesa ${m.numero}</span><button class="btn-excluir" onclick="excluirMesa(${m.id})">Excluir</button></div>`).join('');
}

async function adicionarMesa() {
  const num = document.getElementById('nova-mesa-num').value;
  if (!num) return;
  await fetch('/api/mesas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ numero: num }) });
  document.getElementById('nova-mesa-num').value = '';
  exibirMesasConfig();
}

async function excluirMesa(id) {
  if (await mostrarConfirmacao("Remover mesa?", "Configuração", "Confirmar", "Cancelar", "🗑️")) { await fetch(`/api/mesas/${id}`, { method: 'DELETE' }); exibirMesasConfig(); }
}

// GARÇONS
let idGarcomEdicao = null;

async function exibirGarconsConfig() {
  const res = await fetch('/api/garcons');
  if (!res.ok) return;
  const garcons = await res.json();
  const container = document.getElementById('lista-garcons-config');
  if (!container) return;
  
  window.listaGarconsAtual = garcons; // Salva globalmente para acesso fácil

  container.innerHTML = garcons.map((g, index) => {
    const isOnline = !!g.is_online;
    const statusLabel = isOnline ? '🟢 DISPONÍVEL' : '🔴 PAUSADO';
    const statusColor = isOnline ? '#27ae60' : '#e74c3c';

    return `
    <div class="item-config">
      <div>
        <div style="display:flex; align-items:center; gap:8px;">
          <strong>${g.nome}</strong> 
          <span style="font-size: 0.65rem; padding: 2px 6px; border-radius: 10px; background: ${statusColor}22; color: ${statusColor}; font-weight: bold; border: 1px solid ${statusColor}44; cursor: pointer;" 
                onclick="toggleStatusGarcom(${g.id}, ${isOnline})" title="Clique para forçar alteração">
            ${statusLabel}
          </span>
        </div>
        <small style="color:#7f8c8d;">@${g.usuario}</small>
        ${g.telefone ? `<br><small style="color:#25D366; cursor:pointer;" onclick="window.open('https://wa.me/${g.telefone.replace(/\D/g, '')}', '_blank')">📱 WhatsApp: ${g.telefone}</small>` : ''}
        <br><small style="color:#64748b; font-weight: bold;">💰 Comissão: ${g.comissao !== undefined ? g.comissao : 0}%</small>
      </div>
      <div style="display:flex; gap:0.5rem">
        <button style="background:#3498db; padding:4px 8px; font-size:0.8rem; width:auto;" onclick="prepararEdicaoGarcomByIndex(${index})">✏️</button>
        <button class="btn-excluir" style="width:auto;" onclick="excluirGarcom(${g.id})">X</button>
      </div>
    </div>`;
  }).join('');
}

async function toggleStatusGarcom(id, currentStatus) {
  const acao = currentStatus ? "PAUSAR" : "ATIVAR";
  const confirm = await mostrarConfirmacao(`Deseja realmente ${acao} este garçom na fila de atendimento?`, "Controle de Fila", "Confirmar", "Cancelar", "⚙️");
  if (!confirm) return;

  try {
    const res = await fetch(`/api/admin/garcons/${id}/toggle-status`, { method: 'POST' });
    if (res.ok) {
      const garcom = window.listaGarconsAtual ? window.listaGarconsAtual.find(g => g.id === id) : null;
      const nomeGarcom = garcom ? garcom.nome : "Garçom";
      const statusFinal = currentStatus ? "PAUSADO" : "ATIVADO";
      
      mostrarToast(`Garçom ${nomeGarcom} foi ${statusFinal}!`, currentStatus ? 'warning' : 'success', '⚙️ STATUS');
      adicionarNotificacao(`⚙️ STATUS GARÇOM`, `O garçom ${nomeGarcom} foi ${statusFinal} na fila de atendimento.`, "⚙️");
      
      exibirGarconsConfig(); // Recarrega a lista
    } else {
      mostrarAlerta("Erro ao alterar status do garçom.", "Erro", "❌");
    }
  } catch (e) {
    mostrarAlerta("Erro de conexão.", "Erro", "❌");
  }
}

function prepararEdicaoGarcomByIndex(index) {
  const g = window.listaGarconsAtual[index];
  if (!g) return;
  prepararEdicaoGarcom(g);
}

function prepararEdicaoGarcom(g) {
  idGarcomEdicao = g.id;
  document.getElementById('garcom-nome').value = g.nome;
  document.getElementById('garcom-usuario').value = g.usuario;
  document.getElementById('garcom-telefone').value = g.telefone || '';
  document.getElementById('garcom-comissao').value = g.comissao || 0;
  document.getElementById('garcom-senha').value = '';
  document.getElementById('garcom-senha').placeholder = 'Deixe em branco para manter';
  const btn = document.getElementById('btn-acao-garcom');
  if (btn) {
      btn.textContent = "💾 Salvar Alterações";
      btn.style.background = "#e67e22";
  }
  const btnCan = document.getElementById('btn-cancelar-garcom');
  if (btnCan) btnCan.classList.remove('hidden');
}

function cancelarEdicaoGarcom() {
  idGarcomEdicao = null;
  ['garcom-nome', 'garcom-usuario', 'garcom-telefone', 'garcom-comissao', 'garcom-senha'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.placeholder = ''; }
  });
  const btn = document.getElementById('btn-acao-garcom');
  if (btn) {
      btn.textContent = "Cadastrar";
      btn.style.background = "#27ae60";
  }
  const btnCan = document.getElementById('btn-cancelar-garcom');
  if (btnCan) btnCan.classList.add('hidden');
}

async function processarAcaoGarcom() {
  const nome = document.getElementById('garcom-nome').value;
  const usuario = document.getElementById('garcom-usuario').value;
  const telefone = document.getElementById('garcom-telefone').value;
  const comissao = parseFloat(document.getElementById('garcom-comissao').value) || 0;
  const senha = document.getElementById('garcom-senha').value;

  if (!nome || !usuario) return await mostrarAlerta("Nome e usuário são obrigatórios", "Aviso", "⚠️");

  const payload = { nome, usuario, telefone, comissao, senha };
  const url = idGarcomEdicao ? `/api/garcons/${idGarcomEdicao}` : '/api/garcons';
  const method = idGarcomEdicao ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    const msg = idGarcomEdicao ? "Garçom atualizado!" : "Garçom cadastrado!";
    mostrarToast(msg);
    adicionarNotificacao(idGarcomEdicao ? "👤 GARÇOM ATUALIZADO" : "👤 NOVO GARÇOM", `${nome} foi ${idGarcomEdicao ? 'atualizado' : 'cadastrado'} no sistema.`, "👤");
    cancelarEdicaoGarcom();
    exibirGarconsConfig();
  }
}
async function excluirGarcom(id) {
  // Busca o nome do garçom antes de excluir para a notificação
  const garcom = window.listaGarconsAtual ? window.listaGarconsAtual.find(g => g.id === id) : null;
  const nomeGarcom = garcom ? garcom.nome : "Garçom";

  if (await mostrarConfirmacao("Excluir este garçom?", "Configuração", "Confirmar", "Cancelar", "🗑️")) {
    const res = await fetch(`/api/garcons/${id}`, { method: 'DELETE' });
    if (res.ok) {
      mostrarToast(`Garçom ${nomeGarcom} removido.`, "info", "🗑️ CONFIG");
      adicionarNotificacao("🗑️ GARÇOM REMOVIDO", `O garçom ${nomeGarcom} foi excluído do sistema.`, "🗑️");
      exibirGarconsConfig();
    }
  }
}

// MENU
let idItemEdicaoMenu = null;

function alternarNovaCategoria(valor) {
  const inputNovo = document.getElementById('menu-cat-novo');
  const checkCozinha = document.getElementById('menu-enviar-cozinha');
  
  const valNorm = (valor || "").trim().toUpperCase();
  console.log("🔍 [AUTO-CHECK] Selecionado:", valNorm);
  console.log("📋 [AUTO-CHECK] Categorias da Cozinha:", configCozinhaCategorias);

  if (valor === 'NOVA_CATEGORIA') {
    inputNovo.classList.remove('hidden');
    inputNovo.focus();
    if (checkCozinha) checkCozinha.checked = false; // Reset para nova categoria
  } else {
    inputNovo.classList.add('hidden');
    
    // AUTO-CHECK: Se a categoria selecionada estiver na lista da cozinha, marca o checkbox
    if (checkCozinha && valor) {
        if (configCozinhaCategorias.includes(valNorm)) {
            console.log("✅ [AUTO-CHECK] Match encontrado! Marcando...");
            checkCozinha.checked = true;
        } else {
            console.log("ℹ️ [AUTO-CHECK] Sem match.");
            checkCozinha.checked = false;
        }
    }
  }
}
window.alternarNovaCategoria = alternarNovaCategoria;

// Listener para o input de nova categoria também
document.addEventListener('DOMContentLoaded', () => {
    const inputNovo = document.getElementById('menu-cat-novo');
    if (inputNovo) {
        inputNovo.addEventListener('input', (e) => {
            const valor = e.target.value.trim().toUpperCase();
            const checkCozinha = document.getElementById('menu-enviar-cozinha');
            if (checkCozinha && valor && configCozinhaCategorias.includes(valor)) {
                checkCozinha.checked = true;
            }
        });
    }
});

async function abrirModalItemMenu(item = null) {
  idItemEdicaoMenu = item ? item.id : null;
  const modal = document.getElementById('modal-item-menu');
  const titulo = document.getElementById('modal-item-titulo');
  const btn = document.getElementById('btn-acao-menu');
  const selectCat = document.getElementById('menu-cat-select');
  const inputNovo = document.getElementById('menu-cat-novo');

  // Popula o Select de categorias com as categorias existentes no cardápio
  if (selectCat) {
    const categoriasExistentes = [...new Set(cardapio.map(i => i.categoria.trim().toUpperCase()))].sort();
    let html = '<option value="">Selecione uma categoria...</option>';
    categoriasExistentes.forEach(cat => {
      html += `<option value="${cat}">${cat}</option>`;
    });
    html += '<option value="NOVA_CATEGORIA" style="font-weight: bold; color: #27ae60;">➕ CRIAR NOVA CATEGORIA...</option>';
    selectCat.innerHTML = html;
  }
  
  inputNovo.classList.add('hidden');
  inputNovo.value = '';

  if (item) {
    titulo.innerText = "✏️ Editar Item";
    btn.innerText = "💾 SALVAR ALTERAÇÕES";
    btn.style.background = "#e67e22";
    
    const btnExcluir = document.getElementById('btn-excluir-item-menu');
    if (btnExcluir) btnExcluir.classList.remove('hidden');

    if (document.getElementById('menu-nome')) document.getElementById('menu-nome').value = item.nome;
    if (document.getElementById('menu-descricao')) document.getElementById('menu-descricao').value = item.descricao || '';
    if (document.getElementById('menu-preco-original')) document.getElementById('menu-preco-original').value = item.preco_original || '';
    if (document.getElementById('menu-preco')) document.getElementById('menu-preco').value = item.preco;
    if (document.getElementById('menu-estoque')) document.getElementById('menu-estoque').value = item.estoque;
    if (document.getElementById('menu-validade')) document.getElementById('menu-validade').value = item.validade || '';
    if (document.getElementById('menu-img')) document.getElementById('menu-img').value = item.imagem;
    if (document.getElementById('menu-enviar-cozinha')) {
        document.getElementById('menu-enviar-cozinha').checked = isItemParaCozinha(item);
    }
    if (document.getElementById('menu-visivel')) document.getElementById('menu-visivel').checked = (item.visivel === true || item.visivel === 1 || item.visivel === null || item.visivel === undefined);
    if (document.getElementById('menu-promocao')) document.getElementById('menu-promocao').checked = (item.em_promocao === true || item.em_promocao === 1);

    // Tenta selecionar no dropdown
    const catUpper = item.categoria.trim().toUpperCase();
    if (selectCat.querySelector(`option[value="${catUpper}"]`)) {
        selectCat.value = catUpper;
    } else {
        // Se a categoria por algum motivo não estiver na lista (ex: todos os itens dela foram deletados)
        selectCat.value = 'NOVA_CATEGORIA';
        inputNovo.classList.remove('hidden');
        inputNovo.value = item.categoria;
    }
  } else {
    titulo.innerText = "➕ Novo Item no Menu";
    btn.innerText = "🚀 CADASTRAR NO CARDÁPIO";
    btn.style.background = "#27ae60";
    
    const btnExcluir = document.getElementById('btn-excluir-item-menu');
    if (btnExcluir) btnExcluir.classList.add('hidden');
    
    ['menu-nome', 'menu-descricao', 'menu-preco-original', 'menu-preco', 'menu-img', 'menu-validade'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    if (document.getElementById('menu-estoque')) document.getElementById('menu-estoque').value = '-1';
    if (selectCat) selectCat.value = '';
  }

  modal.style.display = 'flex';
  document.body.classList.add('modal-open');
}

async function excluirDoMenuAtual() {
    if (!idItemEdicaoMenu) return;
    if (await mostrarConfirmacao("Deseja realmente excluir este item do cardápio permanentemente?", "Excluir Item", "Confirmar", "Cancelar", "🗑️")) {
        try {
            const res = await fetch(`/api/menu/${idItemEdicaoMenu}`, { method: 'DELETE' });
            if (res.ok) {
                mostrarToast("✅ Item removido do cardápio!");
                fecharModalItemMenu();
                carregarCardapio();
            } else {
                const err = await res.json();
                mostrarAlerta("Erro ao excluir: " + (err.error || "Erro desconhecido"), "Erro", "❌");
            }
        } catch (e) {
            mostrarAlerta("Erro de conexão ao excluir item.", "Erro", "❌");
        }
    }
}

function fecharModalItemMenu() {
  document.getElementById('modal-item-menu').style.display = 'none';
  idItemEdicaoMenu = null;
  // Apenas remove se não estiver nas abas que exigem dashboard fixo
  if (abaAtiva !== 'lancar' && abaAtiva !== 'ativos') {
    document.body.classList.remove('modal-open');
  }
}

async function processarAcaoMenu() {
  const nome = document.getElementById('menu-nome').value;
  const descricao = document.getElementById('menu-descricao') ? document.getElementById('menu-descricao').value : '';
  const selectCat = document.getElementById('menu-cat-select').value;
  const inputNovo = document.getElementById('menu-cat-novo').value;

  // Define a categoria final
  let categoria = selectCat;
  if (selectCat === 'NOVA_CATEGORIA') {
    categoria = inputNovo.trim();
  }

  const preco = parseFloat(document.getElementById('menu-preco').value);
  const preco_original = parseFloat(document.getElementById('menu-preco-original').value) || null;
  const estoque = parseInt(document.getElementById('menu-estoque').value);
  const validade = document.getElementById('menu-validade').value;
  const imagem = document.getElementById('menu-img').value || 'https://placehold.co/100';
  const enviar_cozinha = document.getElementById('menu-enviar-cozinha').checked;
  const visivel = document.getElementById('menu-visivel').checked;
  const em_promocao = document.getElementById('menu-promocao').checked;

  if (!nome || !categoria || isNaN(preco) || isNaN(estoque)) {
    return await mostrarAlerta("Por favor, preencha o nome, categoria e preço corretamente.", "Aviso", "⚠️");
  }

  const payload = { nome, descricao, categoria: categoria.toUpperCase(), preco, preco_original, imagem, estoque, validade, enviar_cozinha, visivel, em_promocao };
  const method = idItemEdicaoMenu ? 'PUT' : 'POST';
  const url = idItemEdicaoMenu ? `/api/menu/${idItemEdicaoMenu}` : '/api/menu';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    mostrarToast(idItemEdicaoMenu ? "Item atualizado com sucesso!" : "Item cadastrado com sucesso!");
    fecharModalItemMenu();
    carregarCardapio();
  } else {
    const err = await res.json();
    mostrarAlerta("Erro ao salvar: " + (err.error || "Desconhecido"), "Erro", "❌");
  }
}

function prepararEdicaoMenu(item) {
  abrirModalItemMenu(item);
}

async function exibirMenuConfig() {
  const container = document.getElementById('lista-menu-config');
  const selectFiltroCat = document.getElementById('filtro-menu-categoria');
  const inputBusca = document.getElementById('filtro-menu-busca');
  
  if (!container) return;

  try {
    const res = await fetch('/api/menu?admin=true');
    if (!res.ok) return;
    cardapio = await res.json(); // Atualiza variável global
    
    // 1. POPULA O SELECT DE CATEGORIAS (Se estiver apenas com a opção padrão)
    if (selectFiltroCat && selectFiltroCat.options.length <= 1) {
      const categoriasUnicas = [...new Set(cardapio.map(item => item.categoria.trim().toUpperCase()))].sort();
      categoriasUnicas.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.innerText = cat;
        selectFiltroCat.appendChild(opt);
      });
    }

    const hoje = new Date();
    hoje.setHours(0,0,0,0);
    let vencidosCount = 0;
    let proxVencimentoCount = 0;

    // 2. APLICA OS FILTROS (BUSCA E CATEGORIA)
    const termoBusca = inputBusca ? inputBusca.value.toLowerCase().trim() : '';
    const catSelecionada = selectFiltroCat ? selectFiltroCat.value.toUpperCase() : '';

    const cardapioFiltrado = cardapio.filter(m => {
      const matchBusca = m.nome.toLowerCase().includes(termoBusca) || (m.descricao && m.descricao.toLowerCase().includes(termoBusca));
      const matchCat = catSelecionada === '' || m.categoria.trim().toUpperCase() === catSelecionada;
      return matchBusca && matchCat;
    });

    if (cardapioFiltrado.length === 0) {
      container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 4rem; opacity: 0.5;">
        <p style="font-size: 1.5rem;">🔍 Nenhum item encontrado.</p>
        <p>Tente mudar o filtro de categoria ou a busca.</p>
      </div>`;
      return;
    }

    // 3. AGRUPAR ITENS FILTRADOS POR CATEGORIA PARA RENDERIZAÇÃO
    const categoriasNoFiltro = [...new Set(cardapioFiltrado.map(item => item.categoria.trim().toUpperCase()))].sort();
    
    let htmlFinal = '';

    categoriasNoFiltro.forEach(cat => {
      const itensDaCat = cardapioFiltrado.filter(i => i.categoria.trim().toUpperCase() === cat);
      
      htmlFinal += `
        <div class="categoria-config-section" style="width: 100%; grid-column: 1 / -1; margin-top: 2rem;">
          <h2 style="background: #2c3e50; color: white; padding: 10px 20px; border-radius: 8px; font-size: 1.1rem; display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span>📂 ${cat}</span>
              <button onclick="editarCategoria('${cat}')" style="background: #3498db; border: none; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer; display: flex; align-items: center; gap: 3px;">
                ✏️ Editar
              </button>
              <small style="font-size: 0.8rem; opacity: 0.8;">${itensDaCat.length} itens</small>
            </div>
            <button onclick="excluirCategoria('${cat}')" style="background: #e74c3c; border: none; color: white; padding: 6px 12px; border-radius: 6px; font-size: 0.85rem; cursor: pointer; font-weight: bold; transition: 0.2s; display: flex; align-items: center; gap: 5px;" onmouseover="this.style.background='#c0392b'" onmouseout="this.style.background='#e74c3c'">
              🗑️ Excluir Categoria
            </button>
          </h2>
          <div class="menu-config-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; margin-top: 1rem;">
            ${itensDaCat.map(m => {
              let validadeHtml = '';
              let classeValidade = '';
              
              if (m.validade) {
                const dataVal = new Date(m.validade);
                dataVal.setHours(0,0,0,0);
                const diffDias = Math.ceil((dataVal - hoje) / (1000 * 60 * 60 * 24));
                const dataFormatada = dataVal.toLocaleDateString('pt-BR');
                
                if (diffDias < 0) {
                  classeValidade = 'vencido';
                  validadeHtml = `<span style="color:#e74c3c; font-weight:bold;">❌ VENCIDO EM ${dataFormatada}</span>`;
                  vencidosCount++;
                } else if (diffDias <= 7) {
                  classeValidade = 'alerta-validade';
                  validadeHtml = `<span style="color:#f39c12; font-weight:bold;">⚠️ VENCE EM ${dataFormatada} (${diffDias} dias)</span>`;
                  proxVencimentoCount++;
                } else {
                  validadeHtml = `Validade: ${dataFormatada}`;
                }
              }

              const hasStatus = m.em_promocao || isItemParaCozinha(m) || (m.visivel === false || m.visivel === 0);
              const statusHeader = hasStatus ? `
                <div style="display: flex; width: 100%; height: 22px;">
                  ${m.em_promocao ? '<div style="flex: 1; background: #f1c40f; color: #2c3e50; font-size: 0.65rem; font-weight: 900; display: flex; align-items: center; justify-content: center; letter-spacing: 0.5px;">🔥 PROMOÇÃO</div>' : ''}
                  ${isItemParaCozinha(m) ? '<div style="flex: 1; background: #3498db; color: white; font-size: 0.65rem; font-weight: 900; display: flex; align-items: center; justify-content: center; letter-spacing: 0.5px;">🍳 COZINHA</div>' : ''}
                  ${(m.visivel === false || m.visivel === 0) ? '<div style="flex: 1; background: #e74c3c; color: white; font-size: 0.65rem; font-weight: 900; display: flex; align-items: center; justify-content: center; letter-spacing: 0.5px;">🚫 OCULTO</div>' : ''}
                </div>` : '';

              return `
              <div class="menu-item-config ${classeValidade}" id="item-menu-${m.id}" style="border-left: 5px solid ${classeValidade === 'vencido' ? '#e74c3c' : (classeValidade === 'alerta-validade' ? '#f39c12' : 'transparent')}; position: relative; overflow: hidden; display: flex; flex-direction: column; align-items: stretch; padding: 0;">
                
                <!-- Tarjas de Status (Topo) -->
                ${statusHeader}

                <div style="display: flex; gap: 1.2rem; align-items: center; padding: 1.2rem;">
                  <img src="${m.imagem}" alt="${m.nome}" style="filter: ${(m.visivel === false || m.visivel === 0) ? 'grayscale(1) opacity(0.6)' : 'none'}">
                  <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 2px;">
                    <strong style="${(m.visivel === false || m.visivel === 0) ? 'color: #95a5a6;' : ''}">${m.nome}</strong>
                    <small>${m.categoria} - ${m.preco_original ? `<span style="text-decoration: line-through; opacity: 0.6; font-size: 0.8rem;">R$ ${m.preco_original.toFixed(2)}</span> ` : ''}<span style="${m.em_promocao ? 'color: #e74c3c; font-weight: bold;' : ''}">R$ ${m.preco.toFixed(2)}</span></small>
                    <small style="color: ${m.estoque === 0 ? '#e74c3c' : '#27ae60'}; font-weight: bold;">
                      Estoque: ${m.estoque === -1 ? 'Ilimitado' : m.estoque}
                    </small>
                    <small>${validadeHtml}</small>
                  </div>
                  <div style="display:flex; flex-direction:column; gap:0.2rem">
                    <button style="background:#3498db; padding:4px 8px; font-size:0.8rem" onclick="prepararEdicaoMenuById(${m.id})">✏️ Editar</button>
                    <button class="btn-excluir" onclick="excluirDoMenu(${m.id})">Excluir</button>
                  </div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      `;
    });

    container.innerHTML = htmlFinal || '<p style="text-align:center; padding: 2rem; opacity: 0.5;">Nenhum item cadastrado no cardápio.</p>';

    if (vencidosCount > 0 || proxVencimentoCount > 0) {
      const agora_ms = Date.now();
      if (agora_ms - ultimoAlertaValidadeMostrado > 30000) {
        mostrarToast(`🚨 ALERTA: ${vencidosCount} produtos vencidos e ${proxVencimentoCount} próximos da validade!`);
        ultimoAlertaValidadeMostrado = agora_ms;
      }
    }
  } catch (e) {
    console.error("Erro ao carregar cardápio admin:", e);
  }
}

function prepararEdicaoMenuById(id) {
  const item = cardapio.find(m => m.id === id);
  if (item) prepararEdicaoMenu(item);
}

async function excluirDoMenu(id) {
  if (await mostrarConfirmacao("Excluir item do cardápio?", "Configuração", "Confirmar", "Cancelar", "🗑️")) { await fetch(`/api/menu/${id}`, { method: 'DELETE' }); carregarCardapio(); }
}

async function excluirCategoria(categoria) {
  if (await mostrarConfirmacao(`⚠️ ATENÇÃO: Deseja realmente EXCLUIR TODOS os itens da categoria "${categoria}"?\n\nEsta ação não pode ser desfeita.`, "Excluir Categoria", "Confirmar", "Cancelar", "🗑️")) {
    const res = await fetch(`/api/menu/categoria/${encodeURIComponent(categoria)}`, { method: 'DELETE' });
    if (res.ok) {
      mostrarToast(`✅ Categoria "${categoria}" e seus itens foram removidos.`);
      carregarCardapio();
    } else {
      const err = await res.json();
      mostrarAlerta("Erro ao excluir categoria: " + (err.error || "Erro desconhecido"), "Erro", "❌");
    }
  }
}

async function editarCategoria(categoriaAntiga) {
  const modal = document.getElementById('modal-renomear-categoria');
  const inputNovo = document.getElementById('input-novo-nome-categoria');
  const inputAntiga = document.getElementById('input-categoria-antiga');

  if (modal && inputNovo && inputAntiga) {
    inputAntiga.value = categoriaAntiga;
    inputNovo.value = categoriaAntiga;
    modal.style.display = 'flex';
    inputNovo.focus();
    inputNovo.select();
  }
}

function fecharModalRenomearCategoria() {
  const modal = document.getElementById('modal-renomear-categoria');
  if (modal) modal.style.display = 'none';
}

async function confirmarRenomearCategoria() {
  const categoriaAntiga = document.getElementById('input-categoria-antiga').value;
  const novoNome = document.getElementById('input-novo-nome-categoria').value;

  if (!novoNome || novoNome.trim() === "" || novoNome.toUpperCase() === categoriaAntiga.toUpperCase()) {
    fecharModalRenomearCategoria();
    return;
  }

  try {
    const res = await fetch(`/api/menu/categoria/${encodeURIComponent(categoriaAntiga)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ novoNome: novoNome.trim() })
    });

    if (res.ok) {
      mostrarToast("✅ Categoria renomeada com sucesso!");
      fecharModalRenomearCategoria();
      carregarCardapio();
    } else {
      const err = await res.json();
      mostrarAlerta("❌ Erro ao renomear: " + (err.error || "Desconhecido"), "Erro", "❌");
    }
  } catch (e) {
    console.error(e);
    mostrarAlerta("❌ Erro de conexão", "Erro", "❌");
  }
}

async function carregarHistorico() {
  const res = await fetch('/api/pedidos/historico-detalhado');
  if (!res.ok) return;
  historico = await res.json();
  exibirHistorico();
}

async function exibirHistorico() {
  const containerFinalizados = document.getElementById('lista-finalizados');
  const containerCancelados = document.getElementById('lista-cancelados');
  if (!containerFinalizados || !containerCancelados) return;

  // 1. Filtrar Dados (Select Inteligente + Busca Texto)
  const selectFiltro = document.getElementById('filtro-historico-select');
  const filtroMesa = selectFiltro?.value || '';
  const buscaTexto = document.getElementById('filtro-historico-busca')?.value.toLowerCase().trim() || '';
  
  let pedidosFiltrados = historico;
  
  if (filtroMesa || buscaTexto) {
    pedidosFiltrados = historico.filter(p => {
      const mesaIdentificador = p.garcom_id === 'DELIVERY' ? 'DELIVERY' : (p.mesa_numero ? `Mesa ${p.mesa_numero}` : `BALCÃO`);
      const garcom = (p.garcom_nome || '').toLowerCase();
      const idPedido = String(p.id);
      
      const matchesItens = !buscaTexto || (p.itens && p.itens.some(item => (item.nome || '').toLowerCase().includes(buscaTexto)));
      const matchesSelect = !filtroMesa || (mesaIdentificador === filtroMesa || p.garcom_nome === filtroMesa);
      const matchesBusca = !buscaTexto || (
        idPedido.includes(buscaTexto) || 
        mesaIdentificador.toLowerCase().includes(buscaTexto) || 
        garcom.includes(buscaTexto) ||
        matchesItens
      );
      
      return matchesSelect && matchesBusca;
    });
  }

  pedidosFiltradosHistoricoFinalizados = pedidosFiltrados.filter(p => p.status === 'entregue');
  pedidosFiltradosHistoricoCancelados = pedidosFiltrados.filter(p => p.status === 'cancelado');

  // 2. Faturamento e População do Select
  let faturamentoTotal = 0;
  const opcoesFiltro = new Set();
  
  historico.forEach(p => {
    const valorConsolidado = (p.total || 0) + (p.pago_parcial || 0);
    if (p.status === 'entregue') faturamentoTotal += valorConsolidado;
    
    if (p.garcom_id === 'DELIVERY') {
      opcoesFiltro.add('DELIVERY');
    } else if (p.mesa_numero) {
      opcoesFiltro.add(`Mesa ${p.mesa_numero}`);
    } else {
      opcoesFiltro.add(`BALCÃO`);
    }
    if (p.garcom_nome) opcoesFiltro.add(p.garcom_nome);
  });
  
  const fatEl = document.getElementById('faturamento-total-dia');
  if (fatEl) fatEl.innerText = `R$ ${faturamentoTotal.toFixed(2)}`;
  
  const dataEl = document.getElementById('data-historico');
  if (dataEl) dataEl.innerText = new Date().toLocaleDateString('pt-BR');

  if (selectFiltro) {
    const valAnterior = selectFiltro.value;
    const currentOptions = Array.from(selectFiltro.options).map(o => o.value).filter(v => v !== "");
    const newOptionsList = Array.from(opcoesFiltro).sort((a,b) => a.localeCompare(b, undefined, {numeric:true}));
    
    if (JSON.stringify(currentOptions) !== JSON.stringify(newOptionsList)) {
      selectFiltro.innerHTML = '<option value="">Todos</option>';
      newOptionsList.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.innerText = opt;
        selectFiltro.appendChild(o);
      });
      if (newOptionsList.includes(valAnterior)) {
        selectFiltro.value = valAnterior;
      }
    }
  }

  // 3. Renderizar Colunas
  renderizarColunaHistorico('finalizados', pedidosFiltradosHistoricoFinalizados, paginaAtualFinalizados, containerFinalizados);
  renderizarColunaHistorico('cancelados', pedidosFiltradosHistoricoCancelados, paginaAtualCancelados, containerCancelados);

  // 4. Atualizar UI de Paginação
  atualizarPaginacaoHistorico();
}

function renderizarColunaHistorico(tipo, lista, pagina, container) {
  container.innerHTML = '';
  const inicio = (pagina - 1) * ITENS_POR_PAGINA_HISTORICO;
  const fim = inicio + ITENS_POR_PAGINA_HISTORICO;
  const itensPagina = lista.slice(inicio, fim);

  if (itensPagina.length === 0) {
    container.innerHTML = `<p style="text-align:center; padding: 2rem; opacity: 0.5; font-size: 0.8rem;">Nenhum pedido ${tipo}.</p>`;
    return;
  }

  itensPagina.forEach(p => {
    const card = document.createElement('div');
    card.className = `pedido-card status-${p.status}`;
    card.style.cursor = 'pointer';
    card.style.margin = '0 0 6px 0';
    card.style.padding = '8px 12px';
    card.style.borderRadius = '8px';
    card.style.borderLeft = `4px solid ${p.status === 'cancelado' ? '#e74c3c' : '#27ae60'}`;
    card.style.background = '#fff';
    card.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.justifyContent = 'center';
    card.style.minHeight = '65px';
    
    const mesaNome = p.garcom_id === 'DELIVERY' ? '🚚 DELIVERY' : (p.mesa_numero ? `🪑 MESA ${p.mesa_numero}` : `🛍️ BALCÃO #${p.id}`);
    const valor = (p.total || 0) + (p.pago_parcial || 0);

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <div style="line-height: 1.1;">
          <h4 style="margin: 0; font-size: 0.95rem; color: #2c3e50; font-weight: 800;">${mesaNome}</h4>
          <small style="color: #94a3b8; font-size: 0.7rem;">ID #${p.id}</small>
        </div>
        <div style="text-align: right; line-height: 1.1;">
          <div style="font-weight: 900; color: #2c3e50; font-size: 1.05rem;">R$ ${valor.toFixed(2)}</div>
          <small style="color: #94a3b8; font-size: 0.65rem;">${new Date(p.created_at).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}</small>
        </div>
      </div>
      <div style="margin-top: 4px; border-top: 1px solid #f1f5f9; padding-top: 3px; display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <span style="font-size: 0.7rem; font-weight: 800; color: #94a3b8;">👤 ${p.garcom_nome || 'Admin'}</span>
        <span style="font-size: 0.65rem; color: #3498db; font-weight: 900; text-transform: uppercase;">DETALHES</span>
      </div>
    `;

    card.addEventListener('click', () => abrirModalDetalheHistorico(p));
    container.appendChild(card);
  });
}

function mudarPaginaHistorico(tipo, direcao) {
  if (tipo === 'finalizados') {
    paginaAtualFinalizados += direcao;
  } else {
    paginaAtualCancelados += direcao;
  }
  // Garantir que a página não seja menor que 1
  if (paginaAtualFinalizados < 1) paginaAtualFinalizados = 1;
  if (paginaAtualCancelados < 1) paginaAtualCancelados = 1;
  exibirHistorico();
}

function atualizarPaginacaoHistorico() {
  const totalFinalizados = (pedidosFiltradosHistoricoFinalizados || []).length;
  const totalCancelados = (pedidosFiltradosHistoricoCancelados || []).length;
  
  const totalPaginasFinalizados = Math.ceil(totalFinalizados / ITENS_POR_PAGINA_HISTORICO);
  const totalPaginasCancelados = Math.ceil(totalCancelados / ITENS_POR_PAGINA_HISTORICO);

  // Ajuste de segurança para a página atual
  if (totalFinalizados === 0) {
    paginaAtualFinalizados = 0;
  } else if (paginaAtualFinalizados < 1) {
    paginaAtualFinalizados = 1;
  } else if (paginaAtualFinalizados > totalPaginasFinalizados) {
    paginaAtualFinalizados = totalPaginasFinalizados;
  }

  if (totalCancelados === 0) {
    paginaAtualCancelados = 0;
  } else if (paginaAtualCancelados < 1) {
    paginaAtualCancelados = 1;
  } else if (paginaAtualCancelados > totalPaginasCancelados) {
    paginaAtualCancelados = totalPaginasCancelados;
  }

  // Badges
  const bFin = document.getElementById('count-historico-finalizados');
  const bCan = document.getElementById('count-historico-cancelados');
  if (bFin) bFin.innerText = totalFinalizados;
  if (bCan) bCan.innerText = totalCancelados;

  const pagFinEl = document.getElementById('paginacao-finalizados');
  const pagCanEl = document.getElementById('paginacao-cancelados');
  const txtFin = document.getElementById('texto-pag-finalizados');
  const txtCan = document.getElementById('texto-pag-cancelados');
  const btnAntFin = document.getElementById('btn-ant-finalizados');
  const btnProxFin = document.getElementById('btn-prox-finalizados');
  const btnAntCan = document.getElementById('btn-ant-cancelados');
  const btnProxCan = document.getElementById('btn-prox-cancelados');

  if (pagFinEl) {
    pagFinEl.style.display = 'flex';
    if (txtFin) {
      txtFin.textContent = totalFinalizados === 0 ? '0/0' : `${paginaAtualFinalizados}/${totalPaginasFinalizados}`;
    }
    
    if (btnAntFin) {
      const podeVoltar = paginaAtualFinalizados > 1;
      btnAntFin.disabled = !podeVoltar;
      btnAntFin.style.opacity = podeVoltar ? '1' : '0.15';
      btnAntFin.style.cursor = podeVoltar ? 'pointer' : 'default';
    }
    if (btnProxFin) {
      const podeAvancar = paginaAtualFinalizados > 0 && paginaAtualFinalizados < totalPaginasFinalizados;
      btnProxFin.disabled = !podeAvancar;
      btnProxFin.style.opacity = podeAvancar ? '1' : '0.15';
      btnProxFin.style.cursor = podeAvancar ? 'pointer' : 'default';
    }
  }

  if (pagCanEl) {
    pagCanEl.style.display = 'flex';
    if (txtCan) {
      txtCan.textContent = totalCancelados === 0 ? '0/0' : `${paginaAtualCancelados}/${totalPaginasCancelados}`;
    }
    
    if (btnAntCan) {
      const podeVoltar = paginaAtualCancelados > 1;
      btnAntCan.disabled = !podeVoltar;
      btnAntCan.style.opacity = podeVoltar ? '1' : '0.15';
      btnAntCan.style.cursor = podeVoltar ? 'pointer' : 'default';
    }
    if (btnProxCan) {
      const podeAvancar = paginaAtualCancelados > 0 && paginaAtualCancelados < totalPaginasCancelados;
      btnProxCan.disabled = !podeAvancar;
      btnProxCan.style.opacity = podeAvancar ? '1' : '0.15';
      btnProxCan.style.cursor = podeAvancar ? 'pointer' : 'default';
    }
  }
}

function filtrarHistorico(valor) {
  exibirHistorico();
}

// --- FUNÇÕES DO MODAL DE DETALHES DO HISTÓRICO ---
function abrirModalDetalheHistorico(p) {
  const modal = document.getElementById('modal-detalhe-historico');
  if (!modal) return;

  const header = document.getElementById('modal-historico-header');
  const titulo = document.getElementById('modal-historico-titulo');
  const info = document.getElementById('modal-historico-info');
  const horarios = document.getElementById('modal-historico-horarios');
  const responsavel = document.getElementById('modal-historico-responsavel');
  const itensLista = document.getElementById('modal-historico-itens-lista');
  const financeiro = document.getElementById('modal-historico-financeiro');
  const btnReimprimir = document.getElementById('btn-reimprimir-historico');

  if (header) header.style.background = p.status === 'cancelado' ? '#e74c3c' : '#27ae60';
  if (titulo) titulo.innerText = `Pedido #${p.id || '---'}`;
  if (info) info.innerText = `${(p.tipo || 'Pedido').toUpperCase()} - ${(p.mesa_numero ? 'MESA ' + p.mesa_numero : (p.garcom_id === 'DELIVERY' ? 'DELIVERY' : 'BALCÃO'))}`;
  
  // Horários Inteligentes
  let encerramentoRaw = p.data_hora_fechamento;
  if (!encerramentoRaw && p.status === 'entregue' && p.pagamentos && p.pagamentos.length > 0) {
    const ultimoPagamento = p.pagamentos[p.pagamentos.length - 1];
    if (ultimoPagamento.data) encerramentoRaw = ultimoPagamento.data;
  }

  const aberturaFormatada = p.created_at ? formatarData(p.created_at).split(' ')[1] : '--:--';
  let encerramentoFormatado = '--:--';
  if (encerramentoRaw) encerramentoFormatado = formatarData(encerramentoRaw).split(' ')[1];
  else if (p.status === 'cancelado') encerramentoFormatado = 'Cancelado';

  if (horarios) {
    horarios.style.display = 'flex';
    horarios.style.gap = '10px';
    horarios.style.background = '#f1f5f9';
    horarios.style.padding = '12px';
    horarios.style.borderRadius = '10px';
    horarios.style.justifyContent = 'space-around';
    horarios.style.border = '1px dashed #cbd5e1';
    
    horarios.innerHTML = `
      <div style="text-align: center;">
        <div style="font-size: 0.65rem; text-transform: uppercase; color: #64748b; font-weight: 800; letter-spacing: 0.5px; margin-bottom: 2px;">🕒 Abertura</div>
        <div style="font-size: 1.1rem; font-weight: 900; color: #1e293b;">${aberturaFormatada}</div>
      </div>
      <div style="width: 1px; background: #cbd5e1; height: 30px; align-self: center;"></div>
      <div style="text-align: center;">
        <div style="font-size: 0.65rem; text-transform: uppercase; color: #64748b; font-weight: 800; letter-spacing: 0.5px; margin-bottom: 2px;">✅ Finalizado</div>
        <div style="font-size: 1.1rem; font-weight: 900; color: ${p.status === 'cancelado' ? '#e74c3c' : '#1e293b'};">${encerramentoFormatado}</div>
      </div>
    `;
  }
  if (responsavel) responsavel.innerText = p.garcom_nome || p.garcom_id || 'Administrador';

  // --- SEÇÃO DE ITENS E OBSERVAÇÕES ---
  if (itensLista) {
    let htmlContent = '';
    
    // Observação (se houver)
    if (p.observacao) {
      htmlContent += `
        <div style="margin-bottom: 12px; padding: 10px; background: #fff9db; border-radius: 8px; border: 1px solid #fab005; font-size: 0.85rem; color: #856404; line-height: 1.4;">
          <b style="display: block; margin-bottom: 2px;">📝 OBSERVAÇÃO:</b>
          ${p.observacao}
        </div>`;
    }

    // Divisão (se houver)
    const numPessoas = p.num_pessoas || (p.pagamentos ? p.pagamentos.length : 1);
    if (numPessoas > 1) {
      let htmlDivisao = `
        <div style="margin-bottom: 12px; padding: 10px; background: #e7f5ff; border-radius: 8px; border: 1px solid #a5d8ff; font-size: 0.85rem; color: #1971c2;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px; border-bottom: 1px solid rgba(25, 113, 194, 0.2); padding-bottom: 4px;">
            <span style="font-size: 1.1rem;">👥</span>
            <span><b>DIVISÃO:</b> Pedido entre <b>${numPessoas} pessoas</b></span>
          </div>`;
      
      if (p.pagamentos && p.pagamentos.length > 0) {
        p.pagamentos.forEach((pag, idx) => {
          htmlDivisao += `
            <div style="display: flex; justify-content: space-between; font-size: 0.75rem; margin-top: 2px; opacity: 0.9;">
              <span>Pessoa ${idx + 1} (${pag.forma_pagamento || 'N/A'}):</span>
              <span style="font-weight: bold;">R$ ${(pag.valor || 0).toFixed(2)}</span>
            </div>`;
        });
      }
      
      htmlDivisao += `</div>`;
      htmlContent += htmlDivisao;
    }

    // Título da Lista de Itens
    htmlContent += `<div style="font-size: 0.75rem; color: #64748b; font-weight: bold; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;">Itens do Pedido</div>`;

    // Itens
    const itensHTML = (p.itens && p.itens.length > 0) ? p.itens.map(item => `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; font-size: 0.9rem; padding: 6px 0; border-bottom: 1px solid #f1f5f9;">
        <span style="color: #334155;"><b style="color: #0f172a;">${item.quantidade}x</b> ${item.nome}</span>
        <span style="font-weight: 600; color: #475569; white-space: nowrap; margin-left: 10px;">R$ ${(item.preco * item.quantidade).toFixed(2)}</span>
      </div>`).join('') : '<p style="text-align: center; opacity: 0.5; font-size: 0.85rem; padding: 10px 0;">Nenhum item registrado.</p>';
    
    itensLista.innerHTML = htmlContent + itensHTML;
  }

  // --- SEÇÃO FINANCEIRA ---
  if (financeiro) {
    const totalPedido = (p.total || 0) + (p.pago_parcial || 0);
    const subtotal = p.subtotal || totalPedido;
    const taxa = p.taxa_servico || 0;
    const isCancelado = p.status === 'cancelado';
    
    let htmlFin = '<div style="display: flex; flex-direction: column; gap: 6px;">';
    
    // Subtotal e Taxa
    if (taxa > 0 || subtotal !== totalPedido) {
      htmlFin += `
        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; opacity: 0.8;">
          <span>Subtotal:</span><span>R$ ${subtotal.toFixed(2)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; opacity: 0.8;">
          <span>Taxa de Serviço:</span><span>R$ ${taxa.toFixed(2)}</span>
        </div>`;
    }

    // Listagem de Pagamentos (se houver múltiplos e não for cancelado)
    if (!isCancelado && p.pagamentos && p.pagamentos.length > 1) {
      htmlFin += `<div style="margin: 8px 0; padding: 8px 0; border-top: 1px solid rgba(255,255,255,0.1); border-bottom: 1px solid rgba(255,255,255,0.1);">`;
      p.pagamentos.forEach((pag, idx) => {
        htmlFin += `
          <div style="display: flex; justify-content: space-between; font-size: 0.75rem; margin-bottom: 2px;">
            <span style="opacity: 0.7;">P${idx + 1}: ${pag.forma_pagamento}</span>
            <span style="font-weight: bold;">R$ ${(pag.valor || 0).toFixed(2)}</span>
          </div>`;
      });
      htmlFin += `</div>`;
    } else {
       htmlFin += `<div style="margin-top: 5px;"></div>`;
    }

    // Total Final - Muda rótulo se for cancelado
    const labelTotal = isCancelado ? 'TOTAL DO PEDIDO:' : 'TOTAL PAGO:';
    
    htmlFin += `
      <div style="display: flex; justify-content: space-between; font-weight: 900; font-size: 1.4rem; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">
        <span>${labelTotal}</span><span>R$ ${totalPedido.toFixed(2)}</span>
      </div>`;

    if (!isCancelado) {
      htmlFin += `
        <div style="font-size: 0.8rem; margin-top: 5px; opacity: 0.9; text-align: right; font-style: italic;">
          💳 Forma Principal: ${p.forma_pagamento || 'N/A'}
        </div>`;
    } else {
      htmlFin += `
        <div style="font-size: 0.85rem; margin-top: 5px; color: #ffeb3b; text-align: right; font-weight: bold; text-transform: uppercase;">
          ⚠️ Pedido Cancelado
        </div>`;
    }
    
    htmlFin += '</div>';
    financeiro.innerHTML = htmlFin;
  }

  if (btnReimprimir) btnReimprimir.onclick = () => reimprimirCupomById(p.id);

  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

function fecharModalDetalheHistorico() {
  const modal = document.getElementById('modal-detalhe-historico');
  if (modal) modal.style.display = 'none';
}

async function limparHistoricoTotal() {
  if (historico.length === 0) return await mostrarAlerta("O histórico já está vazio!", "Aviso", "⚠️");

  if (await mostrarConfirmacao("⚠️ ATENÇÃO: Isso apagará TODO o histórico de pedidos entregues e cancelados. Deseja continuar?", "Limpar Histórico", "Confirmar", "Cancelar", "🗑️")) {
    const res = await fetch('/api/pedidos/limpar', { method: 'DELETE' });
    if (res.ok) { mostrarToast("Histórico limpo!"); carregarHistorico(); }
  }
}

async function imprimirResumoDiario() {
  if (historico.length === 0) return await mostrarAlerta('Nenhum pedido no histórico para imprimir.', "Aviso", "⚠️");

  const container = document.getElementById('cupom-impressao');
  if (!container) return;
  aplicarConfiguracaoImpressao();

  const dataHoje = new Date().toLocaleDateString('pt-BR');
  
  // Se o caixa estiver aberto, usamos os totais REAIS do banco (que consideram divisões)
  // Caso contrário, usamos o cálculo manual do histórico
  let totalDinheiro = (caixaAtual && caixaAtual.total_dinheiro) || 0;
  let totalPix = (caixaAtual && caixaAtual.total_pix) || 0;
  let totalCartao = (caixaAtual && caixaAtual.total_cartao) || 0;
  let totalGeral = (caixaAtual && caixaAtual.total_vendas) || 0;
  let totalCancelado = 0;
  let qtdPedidos = 0;

  // Busca dados dos garçons para calcular comissões
  let garconsLista = [];
  try {
    const resG = await fetch('/api/garcons');
    if (resG.ok) {
      garconsLista = await resG.json();
    } else {
      console.warn('⚠️ Não foi possível carregar a lista de garçons para o relatório.');
    }
  } catch (err) {
    console.error('❌ Erro ao buscar garçons:', err);
  }

  const performanceGarcons = {};

  if (!Array.isArray(garconsLista)) {
    console.warn('⚠️ Lista de garçons não é um array válido.', garconsLista);
    garconsLista = [];
  }

  historico.forEach(p => {
    const valorTotalPedido = (p.total || 0) + (p.pago_parcial || 0);
    const garcomId = p.garcom_id || 'SISTEMA';
    const garcomNome = p.garcom_nome || p.garcom_id || 'Administrador';

    if (p.status === 'entregue') {
      qtdPedidos++;
      // Se não temos caixaAtual (caixa fechado), fazemos o cálculo manual aproximado
      if (!caixaAtual) {
          totalGeral += valorTotalPedido;
          if (p.forma_pagamento === 'Dinheiro') totalDinheiro += valorTotalPedido;
          else if (p.forma_pagamento === 'Pix') totalPix += valorTotalPedido;
          else if (p.forma_pagamento === 'Cartão') totalCartao += valorTotalPedido;
      }

      // Calcula performance do garçom
      if (!performanceGarcons[garcomId]) {
        const infoG = garconsLista.find(g => g && g.usuario === garcomId) || { comissao: 0 };
        performanceGarcons[garcomId] = {
          nome: garcomNome,
          vendas: 0,
          atendimentos: 0,
          percComissao: infoG.comissao || 0
        };
      }
      performanceGarcons[garcomId].vendas += valorTotalPedido;
      performanceGarcons[garcomId].atendimentos++;
    } else if (p.status === 'cancelado') {
      totalCancelado += valorTotalPedido;
    }
  });

  const htmlPerformance = Object.values(performanceGarcons).map(g => {
    const vComissao = g.vendas * (g.percComissao / 100);
    return `
      <div style="border-bottom: 1px dotted #ccc; padding: 5px 0;">
        <div style="display:flex; justify-content:space-between; font-weight: bold;">
          <span>👤 ${g.nome.toUpperCase()}</span>
          <span>${g.atendimentos} atend.</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size: 9pt; opacity: 0.8;">
          <span>Total Vendido:</span>
          <span>R$ ${g.vendas.toFixed(2)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size: 9pt; color: #27ae60; font-weight: bold;">
          <span>Comissão (${g.percComissao}%):</span>
          <span>R$ ${vComissao.toFixed(2)}</span>
        </div>
      </div>
    `;
  }).join('');

  const html = `
    <div style="width: 100%; font-size: 10pt; line-height: 1.3; color: #000; background: #fff; padding: 0; font-weight: 600;">
      <div style="text-align: center; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
        <h1 style="margin: 0; font-size: 12pt; font-weight: 900;">GuGA Bebidas</h1>
        <p style="margin: 2px 0; font-weight: bold;">*** RESUMO DE VENDAS ***</p>
        <p style="margin: 2px 0;">DATA: ${dataHoje}</p>
        ${caixaAtual ? `<p style="margin: 2px 0; font-size: 8pt;">(DADOS SINCRONIZADOS COM O CAIXA)</p>` : ''}
      </div>
      
      <div style="margin-bottom: 10px;">
        <p><strong>PEDIDOS CONCLUÍDOS:</strong> ${qtdPedidos}</p>
      </div>

      <div style="border-top: 1px solid #000; padding-top: 5px; margin-bottom: 10px;">
        <p style="font-weight: bold; border-bottom: 1px solid #000; margin-bottom: 5px;">FATURAMENTO POR MÉTODO:</p>
        <div style="display:flex; justify-content:space-between;">
          <span>💵 DINHEIRO:</span>
          <span>R$ ${totalDinheiro.toFixed(2)}</span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span>📱 PIX:</span>
          <span>R$ ${totalPix.toFixed(2)}</span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span>💳 CARTÃO:</span>
          <span>R$ ${totalCartao.toFixed(2)}</span>
        </div>
      </div>

      <div style="border-top: 1px solid #000; padding-top: 8px; margin-bottom: 10px;">
        <p style="font-weight: bold; border-bottom: 1px solid #000; margin-bottom: 5px;">DESEMPENHO POR GARÇOM:</p>
        ${htmlPerformance || '<p style="text-align:center; opacity:0.5;">Sem atendimentos registrados.</p>'}
      </div>

      <div style="border-top: 1px dashed #000; padding-top: 8px; margin-top: 10px;">
        <div style="display:flex; justify-content:space-between; font-size: 1.1rem; font-weight: bold; background: #eee; padding: 4px;">
          <span>TOTAL GERAL:</span>
          <span>R$ ${totalGeral.toFixed(2)}</span>
        </div>
      </div>

      ${totalCancelado > 0 ? `
      <div style="margin-top: 10px; color: #777; font-size: 8pt; border-top: 1px solid #ddd; padding-top: 5px;">
        <span>(Cancelados no período: R$ ${totalCancelado.toFixed(2)})</span>
      </div>` : ''}

      <div style="text-align: center; margin-top: 30px; border-top: 1px solid #000; padding-top: 10px;">
        <p style="font-size: 8pt;">Relatório Gerado em:</p>
        <p style="font-size: 8pt;">${new Date().toLocaleString('pt-BR')}</p>
        <br><br>.
      </div>
    </div>
  `;

  container.innerHTML = html;
  setTimeout(() => { window.print(); }, 250);
}

async function carregarPedidos() {
  try {
    const res = await fetch('/api/pedidos/ativos-detalhado');
    if (!res.ok) return;
    pedidos = await res.json();
    
    // Atualiza o select de mesas com os dados recém carregados
    atualizarSelectMesasAtivas();
    
    // Atualiza os indicadores do topo sempre que carregar os pedidos
    await atualizarIndicadoresTopo();
    atualizarContadorAtivos();
    
    exibirPedidos();
  } catch (error) { console.error(error); }
}

function atualizarContadorAtivos() {
  const badge = document.getElementById('badge-ativos-contador');
  const icon = document.getElementById('ativos-tab-icon');
  if (!badge) return;

  const totalAtivos = pedidos.length;
  if (totalAtivos > 0) {
    badge.textContent = totalAtivos;
    badge.classList.remove('hidden');
    if (icon) icon.classList.add('hidden');
  } else {
    badge.classList.add('hidden');
    if (icon) icon.classList.remove('hidden');
  }
}

async function atualizarIndicadoresTopo() {
  const elFat = document.getElementById('faturamento-resumo');
  const elVendas = document.getElementById('vendas-dia-resumo');

  // 1. Busca o status do caixa (Apenas 1 chamada necessária)
  const resCaixa = await fetch('/api/caixa/status');
  caixaAtual = await resCaixa.json();

  if (!caixaAtual) {
    if (elFat) elFat.innerText = `R$ 0,00`;
    if (elVendas) elVendas.innerText = `R$ 0,00`;
    return;
  }

  // 2. Calcula o faturamento ativo usando os dados que já temos no array 'pedidos'
  // O endpoint /ativos-detalhado já traz os itens embutidos, então não precisamos de fetch extras!
  let faturamentoRealAtivo = 0;
  for (const p of pedidos) {
    if (p.itens && Array.isArray(p.itens)) {
      faturamentoRealAtivo += p.itens
        .filter(i => i.status === 'entregue')
        .reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
    }
  }

  if (elFat) elFat.innerText = `R$ ${Number(faturamentoRealAtivo || 0).toFixed(2)}`;
  if (elVendas) elVendas.innerText = `R$ ${Number((caixaAtual && caixaAtual.total_vendas) || 0).toFixed(2)}`;
}

let pedidosStatusTaxa = {}; // Armazena se cada pedido cobra taxa ou não {pedidoId: true/false}

// Função para impressão rápida da parcial direto do card
async function imprimirParcialMesaRapido(idPedido) {
  const pedido = pedidos.find(p => p.id === idPedido);
  if (!pedido) return;
  
  mostrarToast("🖨️ Gerando Nota Parcial...");
  try {
    const res = await fetch(`/api/pedidos/${idPedido}/itens`);
    const itens = await res.json();
    imprimirCupom({ ...pedido, isImpressaoParcialMesa: true }, itens);
  } catch (e) {
    console.error("Erro na impressão rápida:", e);
    mostrarAlerta("Erro ao gerar impressão.", "Erro", "❌");
  }
}

let isRenderingPedidos = false;
let expandedPedidoIds = new Set();
let filtroBuscaMesa = '';
let filtroSelectMesa = '';

// ESTADO DE PAGINAÇÃO PARA COLUNAS
let paginaAtualAtivos = {
  garcom: { pendentes: 1, servidos: 1, fechamento: 1 },
  balcao: { pendentes: 1, servidos: 1, fechamento: 1 },
  delivery: { pendentes: 1, servidos: 1, fechamento: 1 }
};
const ITENS_POR_PAGINA_ATIVOS = 4;

function mudarPagina(coluna, grupo, direcao) {
  paginaAtualAtivos[grupo][coluna] += direcao;
  if (paginaAtualAtivos[grupo][coluna] < 1) paginaAtualAtivos[grupo][coluna] = 1;
  aplicarFiltrosVisuais();
}

function filtrarMesasAtivas(valor) {
  filtroBuscaMesa = valor.toLowerCase().trim();
  aplicarFiltrosVisuais();
}

function filtrarPorSelect(valor) {
  filtroSelectMesa = valor;
  aplicarFiltrosVisuais();
}

function aplicarFiltrosVisuais() {
  const cards = document.querySelectorAll('.pedido-card');

  // Listas auxiliares para aplicar a paginação por coluna e grupo
  const itensFiltrados = {
    garcom: { pendentes: [], servidos: [], fechamento: [] },
    balcao: { pendentes: [], servidos: [], fechamento: [] },
    delivery: { pendentes: [], servidos: [], fechamento: [] }
  };

  cards.forEach(card => {
    const mesaNome = (card.dataset.mesa || '').trim().toLowerCase();
    const matchesBusca = !filtroBuscaMesa || mesaNome.includes(filtroBuscaMesa);
    const matchesSelect = !filtroSelectMesa || mesaNome === filtroSelectMesa.toLowerCase();

    const listId = card.parentElement ? card.parentElement.id : '';
    let group = 'garcom';
    if (listId.includes('balcao')) group = 'balcao';
    else if (listId.includes('delivery')) group = 'delivery';

    let col = '';
    if (listId.includes('-pendentes-')) col = 'pendentes';
    else if (listId.includes('-servidos-')) col = 'servidos';
    else if (listId.includes('-fechamento-')) col = 'fechamento';

    if (!col) return;

    const isVisibleByFilter = (matchesBusca && matchesSelect);

    if (isVisibleByFilter) {
      itensFiltrados[group][col].push(card);
    } else {
      card.style.display = 'none';
      card.style.opacity = '0';
      card.style.transform = 'scale(0.95)';
    }
  });

  // APLICAÇÃO DA PAGINAÇÃO EM TODAS AS COLUNAS
  Object.keys(itensFiltrados).forEach(group => {
    Object.keys(itensFiltrados[group]).forEach(col => {
      const list = itensFiltrados[group][col];
      const totalItens = list.length;
      const totalPaginas = Math.ceil(totalItens / ITENS_POR_PAGINA_ATIVOS);

      // Garante que a página atual seja válida
      if (paginaAtualAtivos[group][col] > totalPaginas) paginaAtualAtivos[group][col] = Math.max(1, totalPaginas);
      
      const inicio = (paginaAtualAtivos[group][col] - 1) * ITENS_POR_PAGINA_ATIVOS;
      const fim = inicio + ITENS_POR_PAGINA_ATIVOS;

      list.forEach((card, index) => {
        const isNaPagina = index >= inicio && index < fim;
        if (isNaPagina) {
          card.style.display = 'block';
          card.style.opacity = '1';
          card.style.transform = 'scale(1)';
        } else {
          card.style.display = 'none';
        }
      });

      // ATUALIZA CONTROLES DE NAVEGAÇÃO
      const nav = document.getElementById(`nav-${col}-${group}`);
      const info = document.getElementById(`page-info-${col}-${group}`);
      
      if (nav && info) {
        // SEMPRE VISÍVEL em todas as colunas de pedidos ativos (pedido do usuário)
        const sempreVisivel = (col === 'pendentes' || col === 'servidos' || col === 'fechamento');
        
        if (sempreVisivel || totalItens > ITENS_POR_PAGINA_ATIVOS) {
          nav.style.display = 'flex';
          
          const pagExibicao = totalPaginas === 0 ? 0 : paginaAtualAtivos[group][col];
          info.textContent = `${pagExibicao} / ${totalPaginas}`;
          
          // Desativa botões se não houver para onde navegar
          const buttons = nav.querySelectorAll('button');
          if (buttons.length >= 2) {
            const btnPrev = buttons[0];
            const btnNext = buttons[1];
            
            const podeVoltar = paginaAtualAtivos[group][col] > 1;
            const podeAvancar = paginaAtualAtivos[group][col] < totalPaginas;
            
            btnPrev.disabled = !podeVoltar;
            btnNext.disabled = !podeAvancar;
            btnPrev.style.opacity = podeVoltar ? '1' : '0.2';
            btnNext.style.opacity = podeAvancar ? '1' : '0.2';
            btnPrev.style.cursor = podeVoltar ? 'pointer' : 'default';
            btnNext.style.cursor = podeAvancar ? 'pointer' : 'default';
            btnPrev.style.pointerEvents = podeVoltar ? 'auto' : 'none';
            btnNext.style.pointerEvents = podeAvancar ? 'auto' : 'none';
          }
        } else {
          nav.style.display = 'none';
        }
      }
      
      // ATUALIZA O BADGE DO TÍTULO COM O TOTAL REAL
      const badge = document.getElementById(`count-${col}-${group}`);
      if (badge) badge.textContent = totalItens;
    });
  });
}

function atualizarSelectMesasAtivas() {
  const select = document.getElementById('select-mesas-ativas');
  if (!select) return;

  const valorAtual = select.value;

  // Filtra os pedidos baseado na aba ativa (Garçom, Balcão ou Delivery)
  const pedidosFiltrados = pedidos.filter(p => {
    const isDelivery = (p.garcom_id === 'DELIVERY');
    const isBalcao = (p.garcom_id === 'ADMIN' && !isDelivery);

    if (subAbaAtiva === 'delivery') return isDelivery;
    if (subAbaAtiva === 'balcao') return isBalcao;
    return !isBalcao && !isDelivery; // Garçom
  });

  const nomesMesas = [...new Set(pedidosFiltrados.map(p => {
    if (p.garcom_id === 'DELIVERY') return `🛵 DELIVERY #${p.id}`;
    return p.mesa_numero ? `Mesa ${p.mesa_numero}` : `Pedido #${p.id}`;
  }))].sort((a, b) => {
    if (a.startsWith('Pedido')) return -1;
    if (b.startsWith('Pedido')) return 1;
    return a.localeCompare(b, undefined, {numeric: true});
  });

  let html = '<option value="">Todas</option>';
  nomesMesas.forEach(nome => {
    html += `<option value="${nome}">${nome}</option>`;
  });

  select.innerHTML = html;
  // Restaura a seleção se a mesa ainda estiver ativa na lista filtrada
  if (nomesMesas.includes(valorAtual)) {
    select.value = valorAtual;
  } else {
    filtroSelectMesa = '';
  }
}

async function exibirPedidos() {
  if (isRenderingPedidos || abaAtiva !== 'ativos') return;
  
  // Seleciona todos os containers de lista
  const lists = {
    garcom: {
      pendentes: document.getElementById('list-pendentes-garcom'),
      servidos: document.getElementById('list-servidos-garcom'),
      fechamento: document.getElementById('list-fechamento-garcom')
    },
    balcao: {
      pendentes: document.getElementById('list-pendentes-balcao'),
      servidos: document.getElementById('list-servidos-balcao')
    },
    delivery: {
      pendentes: document.getElementById('list-pendentes-delivery'),
      servidos: document.getElementById('list-servidos-delivery'),
      fechamento: document.getElementById('list-fechamento-delivery')
    }
  };

  if (!lists.garcom.pendentes || !lists.balcao.pendentes || !lists.delivery.pendentes) return;
  
  isRenderingPedidos = true;

  // Limpa todas as listas
  Object.values(lists).forEach(group => {
    Object.values(group).forEach(list => list.innerHTML = '');
  });

  const counts = {
    garcom: { pendentes: 0, servidos: 0, fechamento: 0 },
    balcao: { pendentes: 0, servidos: 0 },
    delivery: { pendentes: 0, servidos: 0, fechamento: 0 }
  };

  // ORDENAÇÃO: Mais antigos primeiro, priorizando quem já pediu a conta (aguardando_fechamento)
  const pedidosOrdenados = [...pedidos].sort((a, b) => {
    if (a.status === 'aguardando_fechamento' && b.status !== 'aguardando_fechamento') return -1;
    if (a.status !== 'aguardando_fechamento' && b.status === 'aguardando_fechamento') return 1;
    return new Date(a.created_at) - new Date(b.created_at);
  });

  try {
    for (const pedido of pedidosOrdenados) {
      const isDelivery = (pedido.garcom_id === 'DELIVERY');
      const mesaNomeExibicao = isDelivery ? `🛵 DELIVERY #${pedido.id}` : (pedido.mesa_numero ? `Mesa ${pedido.mesa_numero}` : `Pedido #${pedido.id}`);
      
      if (pedidosStatusTaxa[pedido.id] === undefined) {
        pedidosStatusTaxa[pedido.id] = (pedido.cobrar_taxa !== undefined) ? pedido.cobrar_taxa : true;
      }
      const cobrarTaxaNoPedido = pedidosStatusTaxa[pedido.id];

      // USAR ITENS QUE JÁ VEM NO OBJETO PEDIDO (ECONOMIZA N FETCHS)
      const itens = pedido.itens || [];
      const itensPendentes = itens.filter(i => i.status === 'pendente');
      const itensProntos = itens.filter(i => i.status === 'pronto');
      const itensEntregues = itens.filter(i => i.status === 'entregue');
      
      const hasPend = (itensPendentes.length > 0 || itensProntos.length > 0);
      const statusGeral = hasPend ? 'recebido' : 'servido';
      const isAguardando = pedido.status === 'aguardando_fechamento';

      let minutosCronometro = null;
      let classeAlertaAtraso = '';

      // ALERTA DE ATRASO: Para pedidos recebidos ou mesas aguardando fechamento (pendências)
      if ((statusGeral === 'recebido' || (isAguardando && !isDelivery)) && pedido.created_at) {
        minutosCronometro = calcularMinutos(pedido.created_at);
        if (minutosCronometro >= 10) classeAlertaAtraso = 'alerta-borda-pisca';
      }

      const subtotal = itens.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
      const taxaServico = cobrarTaxaNoPedido ? (isDelivery ? 3.00 : (subtotal * 0.10)) : 0;
      const pagoParcial = pedido.pago_parcial || 0;
      const totalConsumo = (subtotal + taxaServico);
      const totalExibicao = ((isAguardando && !isDelivery) ? pedido.total : (totalConsumo - pagoParcial)) || 0;
      
      // INFORMAÇÕES DE PAGAMENTO (DELIVERY OU SOLICITAÇÃO DE CONTA)
      let htmlPagamento = '';
      if (pedido.forma_pagamento) {
          const fp = String(pedido.forma_pagamento).trim();
          const isDinheiro = fp.toLowerCase() === 'dinheiro';
          
          htmlPagamento = `
            <div class="info-pagamento-destaque" style="background:#fff3cd; padding:12px; border-radius:12px; margin:15px 0; font-size:1rem; border:3px solid #ffc107; box-shadow: 0 4px 6px rgba(0,0,0,0.1); color: #856404; animation: pulse-yellow 2s infinite;">
              <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid rgba(133, 100, 4, 0.2); padding-bottom: 8px; margin-bottom: 8px;">
                <strong style="color: #d35400; font-size: 1.1rem;">💰 ${isDelivery ? 'PAGAMENTO DELIVERY' : 'SOLICITAÇÃO DE CONTA'}</strong>
                <span style="background:#d35400; color:#fff; padding:4px 12px; border-radius:8px; font-size:0.85rem; font-weight:900; text-transform: uppercase;">${fp}</span>
              </div>
              <div style="line-height: 1.6;">
                <strong>Forma Escolhida:</strong> <span style="font-weight: 800;">${fp}</span><br>
                ${isDinheiro ? `<strong>Valor Recebido:</strong> R$ ${(pedido.valor_recebido || 0).toFixed(2)}<br><strong style="font-size: 1.2rem; color: #c0392b;">Troco: R$ ${(pedido.troco || 0).toFixed(2)}</strong>` : ''}
                ${(pedido.desconto > 0) ? `<br><span style="color:#e74c3c;"><strong>Desconto:</strong> - R$ ${pedido.desconto.toFixed(2)}</span>` : ''}
                ${(pedido.acrescimo > 0) ? `<br><span style="color:#27ae60;"><strong>Acréscimo:</strong> + R$ ${pedido.acrescimo.toFixed(2)}</span>` : ''}
              </div>
            </div>
            <style>
              @keyframes pulse-yellow {
                0% { box-shadow: 0 0 0 0 rgba(255, 193, 7, 0.4); }
                70% { box-shadow: 0 0 0 10px rgba(255, 193, 7, 0); }
                100% { box-shadow: 0 0 0 0 rgba(255, 193, 7, 0); }
              }
            </style>`;
      }

      const card = document.createElement('div');
      card.id = `pedido-card-${pedido.id}`;
      const isPronto = pedido.status === 'pronto';
      const pedidoIdStr = String(pedido.id);
      const isExpanded = expandedPedidoIds.has(pedidoIdStr);

      let statusBadgeLabel = statusGeral === 'servido' ? 'EM ANDAMENTO' : 'PENDENTE';
      if (isDelivery) {
        if (isAguardando) statusBadgeLabel = 'ENTREGUE';
        else if (statusGeral === 'servido') statusBadgeLabel = 'A CAMINHO';
      }

      card.className = `pedido-card ${isExpanded ? '' : 'minimized'} status-${statusGeral} ${pedido.id === pedidoAtualizadoId ? 'destaque-atualizacao' : ''} ${classeAlertaAtraso} ${isAguardando ? 'alerta-fechamento' : ''} ${isPronto ? 'pedido-pronto-admin' : ''}`;
      card.dataset.pedidoId = pedido.id;
      card.dataset.mesa = mesaNomeExibicao;

      // Abrir modal de opções ao clicar em qualquer lugar do card (exceto botões/inputs)
      card.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select') || e.target.closest('label') || e.target.closest('.slider')) {
          return;
        }

        abrirModalOpcoes(pedido.id);
      });
      card.innerHTML = `
        <div class="pedido-header">
          <div>
            <h3 style="display:flex; align-items:center; gap:8px;">
              ${mesaNomeExibicao}
              <span class="pedido-cronometro" data-created-at="${pedido.created_at || ''}" style="font-size:0.8rem; background:#2c3e50; padding:2px 8px; border-radius:12px; color:#fff; ${minutosCronometro === null ? 'display:none;' : ''}">
                ⏱️ ${minutosCronometro === null ? '' : `${minutosCronometro} min`}
              </span>
            </h3>
            <span class="status-badge ${statusGeral}">${statusBadgeLabel}</span>
            <small style="display:block; margin-top:4px; opacity:0.6;">📅 ${formatarData(pedido.created_at)}</small>
            <small style="display:block; font-weight:bold; color: #34495e; margin-top:2px;">👤 Garçom: ${pedido.garcom_id || 'Admin'}</small>
          </div>
          <div style="text-align:right">
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
              <button class="btn-imprimir-parcial-rapido" data-role="btn-total" onclick="imprimirParcialMesaRapido(${pedido.id})" title="Imprimir Nota Parcial" style="background:#3498db; color:white; border-radius:8px; padding:6px 12px; font-weight:bold; font-size:0.9rem; border:none; cursor:pointer; box-shadow:0 3px 0 #2980b9;">
                🖨️ R$ ${totalExibicao.toFixed(2)}
              </button>
              
              <button style="background: #34495e; color: white; border: none; padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 0.75rem; font-weight: bold; width: 100%; display: flex; align-items: center; justify-content: center; gap: 5px; box-shadow: 0 2px 0 #2c3e50;" 
                      onclick="abrirModalEdicaoById(${pedido.id})">
                ✏️ EDITAR ITENS
              </button>

              <div class="toggle-container">
                <span style="font-size:0.7rem;">${isDelivery ? 'R$ 3.00 ENTREGA' : '10% TAXA'}</span>
                <label class="switch" style="${pagoParcial > 0 ? 'opacity: 0.5; cursor: not-allowed;' : ''}">
                  <input type="checkbox" ${cobrarTaxaNoPedido ? 'checked' : ''} ${pagoParcial > 0 ? 'disabled' : ''} onchange="alternarTaxaPedido(${pedido.id}, this)">
                  <span class="slider"></span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div class="pedido-itens" style="margin-top:12px;">
          ${itensPendentes.length > 0 ? `
            <div style="margin-bottom: 12px;">
              <small style="color: #e74c3c; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; display:block; margin-bottom:5px;">🔥 PARA ENTREGAR:</small>
              ${itensPendentes.map(item => `
                <div class="pedido-item" style="border-left:4px solid #e74c3c; background:#fff5f5; border-radius:6px; padding:6px 10px; margin-bottom:5px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong style="font-size:0.95rem;">${item.quantidade}x ${item.nome} <span class="item-valor" data-base-valor="${(item.preco * item.quantidade).toFixed(2)}" style="font-size:0.75rem; color:#7f8c8d; font-weight:normal;">(R$ ${(item.preco * item.quantidade * (cobrarTaxaNoPedido && !isDelivery ? 1.1 : 1)).toFixed(2)})</span></strong>
                    <span style="font-size:0.65rem; font-weight:bold; background:#e74c3c; color:white; padding:2px 6px; border-radius:4px;">⏳ PENDENTE</span>
                  </div>
                  ${item.observacao ? `<small style="color:#d35400; display:block; margin-top:2px; font-weight:bold;">📝 Obs: ${item.observacao}</small>` : ''}
                </div>
              `).join('')}
            </div>
          ` : ''}

          ${itensEntregues.length > 0 ? `
            <div style="opacity: 0.7;">
              <small style="color: #27ae60; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; display:block; margin-bottom:5px;">${isDelivery ? (isAguardando ? '✅ JÁ ENTREGUE:' : '🛵 A CAMINHO:') : '✅ JÁ NA MESA:'}</small>
              ${itensEntregues.map(item => `
                <div class="pedido-item" style="border-left:4px solid #27ae60; background:#f0fff4; border-radius:6px; padding:4px 10px; margin-bottom:4px; text-decoration: line-through;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:0.85rem;">${item.quantidade}x ${item.nome} <span class="item-valor" data-base-valor="${(item.preco * item.quantidade).toFixed(2)}" style="font-size:0.7rem; color:#7f8c8d;">(R$ ${(item.preco * item.quantidade * (cobrarTaxaNoPedido && !isDelivery ? 1.1 : 1)).toFixed(2)})</span></span>
                    <span style="font-size:0.6rem; color:#27ae60; font-weight:bold; text-decoration:none !important;">✓</span>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
        
        <div class="pedido-footer">
          <div class="pedido-actions" style="width: 100%; margin-top: 8px;">
            ${pedido.status === 'aguardando_fechamento' ? 
              `<button style="background:#27ae60; font-size:1.1rem; border:none; padding: 1.2rem; width: 100%; border-radius:12px; box-shadow:0 5px 0 #219150; cursor:pointer;" onclick="aprovarFechamento(${pedido.id}, ${pedido.mesa_id})">${isDelivery ? '💰 FINALIZAR DELIVERY' : '💰 CONFIRMAR PAGAMENTO E LIBERAR'}</button>` : 
              (hasPend ? 
                `<button style="background:#e67e22; width: 100%; padding:12px; font-weight:bold; border-radius:10px; box-shadow:0 4px 0 #d35400; border:none; color:white; cursor:pointer;" onclick="marcarPedidoEntregue(${pedido.id})">${isDelivery ? '🛵 ENVIAR PARA ENTREGA' : '🚚 ENTREGAR TUDO AGORA'}</button>` :
                (isDelivery ?
                  `<button style="background:#3498db; width: 100%; padding:12px; font-weight:bold; border-radius:10px; box-shadow:0 4px 0 #2980b9; border:none; color:white; cursor:pointer;" onclick="confirmarEntregaDelivery(${pedido.id})">✅ CONFIRMAR ENTREGA</button>` :
                  `<button style="background:#27ae60; width: 100%; padding:12px; font-weight:bold; border-radius:10px; box-shadow:0 4px 0 #219150; border:none; color:white; cursor:pointer;" onclick="liberarMesa(${pedido.id}, ${pedido.mesa_id}, false)">🔓 LIBERAR MESA</button>`
                )
              )
            }
          </div>
        </div>`;
      
      const group = isDelivery ? 'delivery' : (pedido.garcom_id === 'ADMIN' ? 'balcao' : 'garcom');
      let targetCol = 'pendentes';
      if (isAguardando) targetCol = 'fechamento';
      else if (statusGeral === 'servido') targetCol = 'servidos';

      // SE FOR BALCÃO E ESTIVER EM FECHAMENTO, MOVE PARA SERVIDOS (JÁ QUE NÃO TEM COLUNA DE FECHAMENTO NO BALCÃO)
      if (group === 'balcao' && targetCol === 'fechamento') targetCol = 'servidos';

      lists[group][targetCol].appendChild(card);
      counts[group][targetCol]++;
    }

    // Atualiza contadores dos títulos das colunas
    Object.keys(counts).forEach(group => {
      Object.keys(counts[group]).forEach(col => {
        const badge = document.getElementById(`count-${col}-${group}`);
        if (badge) badge.textContent = counts[group][col];
      });
    });

    // Atualiza contadores das sub-tabs
    const bGarcom = document.getElementById('badge-sub-garcom');
    const bBalcao = document.getElementById('badge-sub-balcao');
    const bDelivery = document.getElementById('badge-sub-delivery');
    if (bGarcom) bGarcom.textContent = counts.garcom.pendentes + counts.garcom.servidos + counts.garcom.fechamento;
    if (bBalcao) bBalcao.textContent = counts.balcao.pendentes + counts.balcao.servidos;
    if (bDelivery) bDelivery.textContent = counts.delivery.pendentes + counts.delivery.servidos + counts.delivery.fechamento;

    // Estados vazios por coluna se necessário
    const checkEmpty = (group, col, icon, text) => {
      if (counts[group][col] === 0) {
        lists[group][col].innerHTML = `
          <div style="text-align:center; padding: 20px; opacity: 0.3; font-size: 0.8rem;">
            <div style="font-size: 2rem;">${icon}</div>
            <div>${text}</div>
          </div>
        `;
      }
    };

    checkEmpty('garcom', 'pendentes', '🔥', 'Sem pedidos pendentes');
    checkEmpty('garcom', 'servidos', '🍽️', 'Ninguém consumindo');
    checkEmpty('garcom', 'fechamento', '💰', 'Sem fechamentos');
    checkEmpty('balcao', 'pendentes', '🔥', 'Sem pedidos pendentes');
    checkEmpty('balcao', 'servidos', '🍽️', 'Ninguém consumindo');
    checkEmpty('delivery', 'pendentes', '🔥', 'Sem pedidos pendentes');
    checkEmpty('delivery', 'servidos', '🛵', 'Nada a caminho');
    checkEmpty('delivery', 'fechamento', '✅', 'Sem entregues');

    // RE-APLICA OS FILTROS APÓS RENDERIZAR TUDO
    aplicarFiltrosVisuais();

  } catch (e) { console.error('Erro ao renderizar pedidos:', e); }
  
  isRenderingPedidos = false;
  if (pedidoAtualizadoId) setTimeout(() => { pedidoAtualizadoId = null; }, 5000);
}

async function atualizarPessoasPedido(id, numPessoas) {
  const n = parseInt(numPessoas) || 1;
  try {
    const res = await fetch(`/api/pedidos/${id}/pessoas`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ num_pessoas: n })
    });
    
    if (res.ok) {
      mostrarToast(`👥 Mesa ${id}: Divisão para ${n} pessoas salva.`);
      // Atualiza o dado local para refletir no subtotal sem precisar de reload completo
      const pedido = pedidos.find(p => p.id === id);
      if (pedido) pedido.num_pessoas = n;
      
      // Pequeno delay para o usuário ver a mudança e então recarrega para atualizar os cálculos
      setTimeout(() => carregarPedidos(), 500);
    }
  } catch (e) {
    console.error("Erro ao atualizar pessoas:", e);
  }
}

async function alternarTaxaPedido(id, checkboxEl) {
  const estadoAnterior = !!pedidosStatusTaxa[id];
  const novoEstado = !estadoAnterior;
  if (checkboxEl) checkboxEl.disabled = true;
  
  try {
    const res = await fetch(`/api/pedidos/${id}/taxa`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cobrar_taxa: novoEstado })
    });
    
    if (res.ok) {
      pedidosStatusTaxa[id] = novoEstado;
      const pedidoRef = pedidos.find(p => p.id === id);
      if (pedidoRef) pedidoRef.cobrar_taxa = novoEstado;
      const pedido = pedidos.find(p => p.id === id);
      if (!pedido || pedido.status === 'aguardando_fechamento') {
        await carregarPedidos();
        return;
      }

      const card = document.querySelector(`.pedido-card[data-pedido-id="${id}"]`);
      if (!card) {
        await carregarPedidos();
        return;
      }

      const resItens = await fetch(`/api/pedidos/${id}/itens`);
      if (!resItens.ok) {
        await carregarPedidos();
        return;
      }
      const itens = await resItens.json();

      const totalEnt = itens.filter(i => i.status === 'entregue').reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
      const totalPend = itens.filter(i => i.status === 'pendente').reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
      const subtotal = totalEnt + totalPend;
      const taxaServico = novoEstado ? (subtotal * 0.10) : 0;
      const totalExibicao = subtotal + taxaServico;

      const elTotal = card.querySelector('[data-role="pedido-total"]');
      if (elTotal) elTotal.textContent = `Total: R$ ${totalExibicao.toFixed(2)}`;

      const elSub = card.querySelector('[data-role="pedido-subtotais"]');
      if (elSub) elSub.textContent = `Sub: R$ ${subtotal.toFixed(2)} + 10%: R$ ${taxaServico.toFixed(2)}`;

      // Atualiza o botão de impressão rápida
      const elBtnTotal = card.querySelector('[data-role="btn-total"]');
      if (elBtnTotal) elBtnTotal.textContent = `🖨️ R$ ${totalExibicao.toFixed(2)}`;

      // Atualiza os valores individuais dos itens no card
      const itemValores = card.querySelectorAll('.item-valor');
      itemValores.forEach(el => {
        const base = parseFloat(el.dataset.baseValor);
        const novoValor = novoEstado ? base * 1.1 : base;
        el.textContent = `(R$ ${novoValor.toFixed(2)})`;
      });
    } else {
      pedidosStatusTaxa[id] = estadoAnterior;
      if (checkboxEl) checkboxEl.checked = estadoAnterior;
    }
  } catch (e) {
    console.error("Erro ao alternar taxa:", e);
    pedidosStatusTaxa[id] = estadoAnterior;
    if (checkboxEl) checkboxEl.checked = estadoAnterior;
  } finally {
    if (checkboxEl) checkboxEl.disabled = false;
  }
}

// Bloco de funções duplicadas removido. Usando definições em L1530+

// Funções de edição de itens consolidadas na parte inferior do arquivo (L1530+)

function alternarSelecaoItem(index) {
  itensEmEdicao[index].selecionado = !itensEmEdicao[index].selecionado;
}

function selecionarTodosItens(selecionar) {
  itensEmEdicao.forEach(i => i.selecionado = selecionar);
  renderizarItensEdicao();
}

async function removerItensSelecionados() {
  const selecionados = itensEmEdicao.filter(i => i.selecionado);
  if (selecionados.length === 0) return await mostrarAlerta("Selecione pelo menos um item!", "Aviso", "⚠️");
  
  if (await mostrarConfirmacao(`Deseja remover os ${selecionados.length} itens selecionados?`, "Remover Itens", "Confirmar", "Cancelar", "🗑️")) {
    itensEmEdicao = itensEmEdicao.filter(i => !i.selecionado);
    renderizarItensEdicao();
    mostrarToast("✅ Itens selecionados removidos!");
  }
}

// Funções de edição de itens consolidadas na parte inferior do arquivo

async function excluirPedido(id) {
  if (await mostrarConfirmacao("⚠️ EXCLUIR PERMANENTEMENTE?\n\nIsso removerá o pedido do banco de dados e do histórico. Esta ação não pode ser desfeita.", "Excluir Registro", "Confirmar", "Cancelar", "🗑️")) {
    const res = await fetch(`/api/pedidos/${id}`, { method: 'DELETE' });
    if (res.ok) {
      mostrarToast("🗑️ Pedido excluído!");
      if (abaAtiva === 'ativos') carregarPedidos();
      else carregarHistorico();
    }
  }
}

async function atualizarStatus(id, status) {
  if (status === 'cancelado' && !await mostrarConfirmacao("Deseja realmente CANCELAR este pedido? A mesa será liberada.", "Cancelar Pedido", "Confirmar", "Cancelar", "🗑️")) return;
  
  const res = await fetch(`/api/pedidos/${id}/status`, { 
    method: 'PUT', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ status }) 
  });
  
  if (res.ok) {
    mostrarToast(status === 'cancelado' ? "❌ Pedido Cancelado" : "Atualizado!");
    carregarPedidos();
  } else {
    const err = await res.json();
    await mostrarAlerta("Erro: " + err.error, "Erro", "❌");
  }
}

async function confirmarEntregaDelivery(id) {
  if (await mostrarConfirmacao("Confirmar que o pedido foi ENTREGUE pelo motoboy?", "Confirmação de Entrega", "Sim, Entregue", "Não", "🛵")) {
    try {
      // Move para aguardando_fechamento, que no Delivery chamamos de "ENTREGUE"
      const res = await fetch(`/api/pedidos/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'aguardando_fechamento' })
      });
      if (res.ok) {
        mostrarToast("✅ Pedido marcado como ENTREGUE!");
        carregarPedidos();
      }
    } catch (e) {
      console.error("Erro ao confirmar entrega:", e);
      mostrarAlerta("Erro ao confirmar entrega.");
    }
  }
}

async function marcarPedidoEntregue(id) {
  try {
    const resItens = await fetch(`/api/pedidos/${id}/itens`);
    const itens = await resItens.json();

    // Itens que ainda estão em produção (Pendente + Cozinha)
    const emPreparo = itens.filter(i => i.status === 'pendente' && isItemParaCozinha(i));
    // Itens que podem ser entregues agora (Prontos ou Bebidas pendentes)
    const prontosOuForaCozinha = itens.filter(i => i.status === 'pronto' || (i.status === 'pendente' && !isItemParaCozinha(i)));

    // CASO 1: Existem itens na cozinha sendo feitos
    if (emPreparo.length > 0) {
      if (prontosOuForaCozinha.length > 0) {
        // PERGUNTA SE QUER ENTREGA PARCIAL (Bebidas/Prontos)
        const confirm = await mostrarConfirmacao(
          `<div style="text-align: center;">
            <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🚚</div>
            <p style="font-weight: bold; color: #e67e22; font-size: 1.1rem;">ENTREGA PARCIAL</p>
            <p style="color: #2c3e50; margin-bottom: 10px;">Existem <strong>${emPreparo.length} itens</strong> na cozinha. Deseja entregar apenas as bebidas e itens prontos?</p>
            <p style="font-size: 0.8rem; color: #7f8c8d;">A mesa continuará ativa para os itens que ficarem.</p>
          </div>`,
          "Cozinha em Andamento",
          "Sim, Entregar Prontos",
          "Não, Cancelar"
        );

        if (!confirm) return;

        const res = await fetch(`/api/pedidos/${id}/marcar-entregue`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apenasProntos: true })
        });

        if (res.ok) {
          mostrarToast("✅ Itens prontos entregues!");
          carregarPedidos();
        }
      } else {
        // BLOQUEIO TOTAL (SÓ TEM COZINHA PENDENTE)
        const listaHtml = emPreparo.map(i => `• ${i.quantidade}x ${i.nome}`).join('<br>');
        await mostrarAlerta(`
          <div style="text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 1rem;">🍳</div>
            <p style="font-weight: bold; color: #e74c3c; font-size: 1.1rem; margin-bottom: 10px;">PEDIDO EM PREPARO NA COZINHA!</p>
            <p style="color: #2c3e50; margin-bottom: 15px;">Este pedido não pode ser marcado como entregue enquanto a cozinha não finalizar os seguintes itens:</p>
            <div style="background: #fff5f5; padding: 10px; border-radius: 8px; border: 1px solid #feb2b2; text-align: left; font-size: 0.9rem; max-height: 100px; overflow-y: auto;">
              ${listaHtml}
            </div>
            <p style="font-size: 0.8rem; color: #666; margin-top: 15px;">Aguarde a cozinha finalizar para confirmar a entrega.</p>
          </div>
        `, "Cozinha Ativa", "🍳");
      }
      return;
    }

    // CASO 2: Não há nada na cozinha em preparo, mas pode haver itens 'prontos' ou 'bebidas'
    if (await mostrarConfirmacao("Confirmar a entrega de todos os itens deste pedido?", "Entregar Tudo", "Confirmar", "Cancelar", "🚚")) {
      const res = await fetch(`/api/pedidos/${id}/marcar-entregue`, { 
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apenasProntos: false })
      });
      if (res.ok) {
        mostrarToast("✅ Pedido entregue!");
        carregarPedidos();
      }
    }
  } catch (e) {
    console.error("Erro ao marcar entregue:", e);
    await mostrarAlerta("Erro ao processar entrega.", "Erro", "❌");
  }
}

async function liberarMesa(idPedido, idMesa, temPendentes = false) {
  let msg = "Liberar mesa agora?";
  if (temPendentes) {
    msg = "⚠️ ATENÇÃO: Esta mesa possui itens PENDENTES de entrega! Tem certeza que deseja LIBERAR a mesa e encerrar o pedido sem entregar tudo?";
  }
  if (await mostrarConfirmacao(msg, "Liberar Mesa", "Confirmar", "Cancelar", "🔓")) {
    // Agora chama o modal de fechamento para conferência antes de liberar
    aprovarFechamento(idPedido, idMesa);
  }
}

async function irParaEdicaoDestePedido() {
  if (!pedidoParaFecharAdmin) return;
  const idPedido = pedidoParaFecharAdmin.id;

  // NOVA LÓGICA: Se estiver na aba de lançamento, "devolve" os itens para o carrinho principal
  if (abaAtiva === 'lancar') {
    try {
      const resItens = await fetch(`/api/pedidos/${idPedido}/itens`);
      const itens = await resItens.json();
      
      // 1. Coloca os itens de volta no carrinho de lançamento
      carrinhoLancar = itens.map(i => ({
        menu_id: i.menu_id,
        nome: i.nome,
        preco: i.preco,
        quantidade: i.quantidade
      }));

      // 2. Exclui esse pedido que acabou de ser gerado (pois vamos lançar um novo corrigido)
      await fetch(`/api/pedidos/${idPedido}`, { method: 'DELETE' });

      // 3. Fecha o modal e atualiza a tela de lançamento
      fecharModalFechamentoAdmin();
      renderizarCarrinhoLancar();
      exibirMenuLancar('todas');
      mostrarToast("🔄 Itens retornados ao carrinho!");
    } catch (e) {
      console.error("Erro ao retornar itens:", e);
      mostrarAlerta("Erro ao recuperar itens do pedido.");
    }
    return;
  }

  // Comportamento padrão para as outras abas (abre o modal de edição)
  veioDoFechamento = true; // Flag para saber que deve voltar ao fechamento
  fecharModalFechamentoAdmin();
  fetch(`/api/pedidos/${idPedido}/itens`).then(res => res.json()).then(itens => abrirModalEdicao(pedidoParaFecharAdmin, itens, "🔔"));
}

function abrirModalEdicao(pedido, itens) {
  pedidoEmEdicao = pedido;
  itensEmEdicao = itens.map(i => ({ ...i, selecionado: false }));
  categoriaEdicaoAtual = 'todas';
  document.getElementById('modal-titulo').innerText = `Editar Pedido: ${pedido.mesa_numero ? 'Mesa ' + pedido.mesa_numero : 'Balcão'}`;
  renderizarItensEdicao();
  renderizarMenuEdicao(categoriaEdicaoAtual);
  document.getElementById('modal-edicao').style.display = 'flex';
  
  // TRAVA DE SCROLL: Congela o fundo
  document.body.classList.add('modal-open');
}

function fecharModal() {
  document.getElementById('modal-edicao').style.display = 'none';
  pedidoEmEdicao = null;
  itensEmEdicao = [];
  
  // LIBERA O SCROLL APENAS se não estiver nas abas que exigem trava
  if (abaAtiva !== 'lancar' && abaAtiva !== 'ativos') {
      document.body.classList.remove('modal-open');
  }
}

function renderizarItensEdicao() {
  const container = document.getElementById('itens-atuais');
  if (!container) return;
  container.innerHTML = itensEmEdicao.map((item, index) => {
    const isEntregue = item.status === 'entregue';
    const infoMenu = cardapio.find(m => m.id === item.menu_id) || {};
    const urlImagem = infoMenu.imagem || 'https://placehold.co/50';

    return `
    <div class="item-edicao" style="${isEntregue ? 'background: #f0fff4; border-left: 3px solid #27ae60;' : (item.status === 'pronto' ? 'background: #e8f8f5; border-left: 3px solid #2ecc71;' : 'border-left: 3px solid #e67e22;')} padding: 6px 10px; margin-bottom: 6px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); border: 1px solid #edf2f7; display: flex; flex-direction: column; gap: 4px;">

      <!-- LINHA 1: CHECKBOX + IMAGEM + NOME + STATUS -->
      <div style="display: flex; align-items: flex-start; gap: 8px;">
        <input type="checkbox" ${item.selecionado ? 'checked' : ''} onchange="alternarSelecaoItemEdicao(${index})" style="width: 18px; height: 18px; cursor: pointer; flex-shrink: 0; margin-top: 2px;">

        <!-- ÍCONE DA IMAGEM -->
        <img src="${urlImagem}" alt="${item.nome}" style="width: 40px; height: 40px; border-radius: 6px; object-fit: cover; border: 1px solid #eee; flex-shrink: 0;">

        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 4px;">
            <div style="font-size: 0.9rem; color: #1e293b; font-weight: 800; line-height: 1.1; margin-bottom: 1px;">${item.nome}</div>
            <!-- BOTÃO REMOVER -->
            <button onclick="removerItemEdicao(${index})" 
                    style="background: #fef2f2; color: #ef4444; border: none; width: 22px; height: 22px; border-radius: 5px; cursor: pointer; font-weight: bold; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 0.7rem;">✕</button>
          </div>
          <span style="display: inline-block; padding: 0px 5px; border-radius: 3px; font-size: 0.6rem; font-weight: 900; text-transform: uppercase; background: ${isEntregue ? '#dcfce7' : (item.status === 'pronto' ? '#e8f8f5' : '#fef3c7')}; color: ${isEntregue ? '#166534' : (item.status === 'pronto' ? '#27ae60' : '#92400e')};">
            ${isEntregue ? '✅ Entregue' : (item.status === 'pronto' ? '🔥 Pronto' : '⏳ Pendente')}
          </span>
        </div>
      </div>
      <!-- OBSERVAÇÃO -->
      <div style="margin: 0;">
        <input type="text" 
               placeholder="📝 Obs..." 
               value="${item.observacao || ''}" 
               oninput="itensEmEdicao[${index}].observacao = this.value"
               style="width: 100%; padding: 4px 8px; border-radius: 6px; border: 1px solid #edf2f7; font-size: 0.75rem; background: #f8fafc;">
      </div>

      <!-- LINHA 2: CONTROLES + PREÇO TOTAL -->
      <div style="display: flex; align-items: center; justify-content: space-between; padding-top: 4px; border-top: 1px solid #f1f5f9;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <!-- SELETOR DE QTD -->
          <div style="display: flex; align-items: center; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #fff; height: 28px;">
            <button onclick="mudarQtdItem(${index}, ${item.quantidade - 1})" 
                    style="width: 28px; height: 100%; border: none; background: #fff; color: #ef4444; font-size: 1.1rem; font-weight: bold; cursor: pointer; border-right: 1px solid #e2e8f0;">-</button>
            
            <span style="min-width: 25px; text-align: center; font-weight: 900; font-size: 0.9rem; color: #0f172a;">${item.quantidade}</span>
            
            <button onclick="mudarQtdItem(${index}, ${item.quantidade + 1})" 
                    style="width: 28px; height: 100%; border: none; background: #fff; color: #22c55e; font-size: 1.1rem; font-weight: bold; cursor: pointer; border-left: 1px solid #e2e8f0;">+</button>
          </div>
        </div>

        <!-- PREÇO TOTAL DO ITEM -->
        <div style="text-align: right;">
          <small style="display: block; font-size: 0.6rem; color: #64748b; font-weight: bold; margin-bottom: -4px;">TOTAL</small>
          <strong style="color: #166534; font-size: 1.0rem; font-weight: 900;">R$ ${(item.preco * item.quantidade).toFixed(2)}</strong>
        </div>
      </div>

    </div>`;
  }).join('');
  
  const subtotal = itensEmEdicao.reduce((s, i) => s + (i.preco * i.quantidade), 0);
  document.getElementById('modal-total').textContent = `Total: R$ ${subtotal.toFixed(2)}`;
}

function alternarSelecaoItemEdicao(index) {
  itensEmEdicao[index].selecionado = !itensEmEdicao[index].selecionado;
  renderizarItensEdicao();
}

function selecionarTodosItens(sel) {
  itensEmEdicao.forEach(i => i.selecionado = sel);
  renderizarItensEdicao();
}

function removerItensSelecionados() {
  const selecionados = itensEmEdicao.filter(i => i.selecionado);
  if (selecionados.length === 0) return mostrarAlerta("Selecione itens para remover");
  
  itensEmEdicao = itensEmEdicao.filter(i => !i.selecionado);
  renderizarItensEdicao();
}

async function renderizarMenuEdicao(categoria = 'todas') {
  categoriaEdicaoAtual = categoria;
  const container = document.getElementById('edit-menu-grid');
  const catContainer = document.getElementById('edit-menu-categorias');
  if (!container || !catContainer) return;

  if (!catContainer.dataset.wheelAdded) {
    catContainer.addEventListener('wheel', (e) => {
      e.preventDefault();
      catContainer.scrollLeft += e.deltaY;
    });
    catContainer.dataset.wheelAdded = 'true';
  }

  const cardapioAtivo = cardapio.filter(i => i.visivel !== false && i.visivel !== 0);
  const categoriasUnicas = [...new Set(cardapioAtivo.map(i => i.categoria.trim().toLowerCase()))];
  const categorias = ['todas', ...categoriasUnicas];
  
  catContainer.innerHTML = categorias.map(cat => {
    const nomeExibicao = cat === 'todas' ? 'Todos' : cat.charAt(0).toUpperCase() + cat.slice(1);
    const isAtiva = cat.trim().toLowerCase() === categoriaEdicaoAtual.trim().toLowerCase();
    return `
      <div class="cat-mini ${isAtiva ? 'ativa' : ''}" 
           onclick="renderizarMenuEdicao('${cat}')">
        ${nomeExibicao}
      </div>
    `;
  }).join('');

  const itens = categoriaEdicaoAtual === 'todas' ? cardapioAtivo : cardapioAtivo.filter(i => i.categoria.trim().toLowerCase() === categoriaEdicaoAtual.trim().toLowerCase());
  container.innerHTML = itens.map(item => {
    let estoqueNum = -1;
    if (item.estoque !== null && item.estoque !== undefined && item.estoque !== '') {
      estoqueNum = parseInt(item.estoque);
    }
    if (isNaN(estoqueNum)) estoqueNum = -1;
    
    // NOVO: Calcula quanto desse item já está na "mesa" (na lista de edição atual)
    const qtdNaEdicao = itensEmEdicao
      .filter(i => i.menu_id === item.id)
      .reduce((sum, i) => sum + i.quantidade, 0);
    
    const estoqueDisponivel = (estoqueNum !== -1) ? (estoqueNum - qtdNaEdicao) : -1;
    const temEstoqueDefinido = estoqueNum !== -1;
    
    return `
    <div class="item-menu-mini" onclick="adicionarItemNaEdicao(${item.id})" style="position: relative; display: flex; flex-direction: column; opacity: ${estoqueDisponivel === 0 ? '0.6' : '1'}; min-height: 155px !important; height: auto !important; background: white; border-radius: 12px; overflow: hidden; border: 1px solid #eee; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
      <!-- Container de Info (TOPO DIREITO) -->
      <div style="position: absolute; top: 6px; right: 6px; z-index: 10; display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
        <!-- Preço -->
        <div style="background: #27ae60; color: white; padding: 4px 8px; border-radius: 6px; font-weight: 900; font-size: 1.0rem; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">R$ ${item.preco.toFixed(2)}</div>
        
        <!-- Info de ESTOQUE -->
        <div style="background: ${estoqueDisponivel <= 0 ? '#e74c3c' : '#3498db'}; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 0.8rem; display: flex; align-items: center; gap: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
          ${temEstoqueDefinido ? `<span>📦</span> ${estoqueDisponivel}` : '<span>♾️</span> Ilimitado'}
        </div>

        <!-- Promoção e Cozinha -->
        ${item.em_promocao ? `<div style="background: #f1c40f; color: #2c3e50; padding: 2px 6px; border-radius: 4px; font-weight: 900; font-size: 0.75rem; display: flex; align-items: center; gap: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">🔥 Promo ${item.preco_original ? `<span style="text-decoration: line-through; opacity: 0.75; font-weight: 600; margin-left: 2px;">R$ ${Number(item.preco_original).toFixed(2)}</span>` : ''}</div>` : ''}
        ${isItemParaCozinha(item) ? `<div style="background: #e74c3c; color: white; padding: 2px 6px; border-radius: 4px; font-weight: 900; font-size: 0.75rem; display: flex; align-items: center; gap: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">🍳 Cozinha</div>` : ''}
      </div>

      <img src="${item.imagem}" alt="${item.nome}" style="filter: ${estoqueDisponivel === 0 ? 'grayscale(1)' : 'none'}; height: 110px !important; width: 100%; object-fit: cover; display: block; border-bottom: 1px solid #f0f0f0;">
      <div style="padding: 4px 8px !important; display: flex; flex-direction: column; flex-grow: 1; justify-content: flex-start;">
        <h4 style="margin: 0 !important; font-size: 0.85rem !important; color: #2c3e50 !important; line-height: 1.1 !important; font-weight: 700 !important; white-space: normal !important; text-align: left !important;">${item.nome}</h4>
      </div>
    </div>
  `}).join('');
}

async function adicionarItemNaEdicao(itemId) {
  const menuItem = cardapio.find(m => m.id === itemId);
  if (!menuItem) return;

  // Verifica se existem itens selecionados para substituição
  const selecionadosIndices = itensEmEdicao.map((item, index) => item.selecionado ? index : -1).filter(index => index !== -1);

  if (selecionadosIndices.length > 0) {
    if (await mostrarConfirmacao(`Deseja substituir os ${selecionadosIndices.length} itens selecionados por ${menuItem.nome}?`, "Substituir Itens", "Confirmar", "Cancelar", "🔄")) {
      selecionadosIndices.forEach(index => {
        const itemOriginal = itensEmEdicao[index];
        if (menuItem.estoque !== -1 && itemOriginal.quantidade > menuItem.estoque) {
           mostrarToast(`⚠️ Estoque insuficiente de ${menuItem.nome}!`);
           return;
        }
        itensEmEdicao[index] = {
          ...itemOriginal,
          menu_id: menuItem.id,
          nome: menuItem.nome,
          preco: menuItem.preco,
          status: 'pendente',
          selecionado: false
        };
      });
      renderizarItensEdicao();
      renderizarMenuEdicao(categoriaEdicaoAtual);
      mostrarToast("🔄 Itens substituídos com sucesso!");
      return;
    }
  }

  const exist = itensEmEdicao.find(i => i.menu_id === itemId && i.status === 'pendente');
  const qtdAtual = exist ? exist.quantidade : 0;
  
  if (menuItem.estoque !== -1 && (qtdAtual + 1) > menuItem.estoque) {
    return await mostrarAlerta(`Estoque insuficiente! Restam apenas ${menuItem.estoque} unidades.`, "Estoque", "📦");
  }

  if (exist) {
    exist.quantidade++;
  } else {
    itensEmEdicao.push({ 
      menu_id: menuItem.id, 
      nome: menuItem.nome, 
      preco: menuItem.preco, 
      quantidade: 1, 
      status: 'pendente',
      selecionado: false 
    });
  }
  renderizarItensEdicao();
  renderizarMenuEdicao(categoriaEdicaoAtual); // ATUALIZAÇÃO EM TEMPO REAL DO ESTOQUE NO CARDÁPIO
}

async function salvarAlteracoes() {
  if (!pedidoEmEdicao) return;
  try {
    const res = await fetch(`/api/pedidos/${pedidoEmEdicao.id}/atualizar-itens`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itens: itensEmEdicao })
    });
    if (res.ok) {
      mostrarToast("✅ Pedido atualizado!");
      const idPed = pedidoEmEdicao.id;
      const idMesa = pedidoEmEdicao.mesa_id;
      
      fecharModal();
      await carregarPedidos(); // Atualiza a lista global de pedidos

      if (veioDoFechamento) {
        veioDoFechamento = false;
        // Reabre o modal de fechamento com os dados atualizados
        setTimeout(() => {
          aprovarFechamento(idPed, idMesa);
        }, 100);
      }
    } else {
      mostrarAlerta("Erro ao salvar alterações");
    }
  } catch (e) {
    mostrarAlerta("Erro de rede");
  }
}

async function confirmarCancelamento() {
  if (!pedidoEmEdicao) return;
  if (await mostrarConfirmacao("Deseja realmente CANCELAR este pedido inteiro?", "Atenção", "SIM, CANCELAR", "NÃO")) {
    const res = await fetch(`/api/pedidos/${pedidoEmEdicao.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelado' })
    });
    if (res.ok) {
      fecharModal();
      carregarPedidos();
    }
  }
}

// LOGICA DE FECHAMENTO NO ADMIN (NOVO)
let pedidoParaFecharAdmin = null;
let subtotalConsumoAdmin = 0;
let itensFechamentoAdmin = [];

async function aprovarFechamento(idPedido, idMesa, mesaNomeForcado = null) {
  pedidoParaFecharAdmin = pedidos.find(p => p.id === idPedido) || { 
    id: idPedido, 
    mesa_id: idMesa, 
    mesa_numero: mesaNomeForcado || 'BALCÃO' 
  };

  // USAR ITENS QUE JÁ TEMOS SE POSSÍVEL
  if (pedidoParaFecharAdmin && pedidoParaFecharAdmin.itens) {
    itensFechamentoAdmin = pedidoParaFecharAdmin.itens;
  } else {
    const resItens = await fetch(`/api/pedidos/${idPedido}/itens`);
    itensFechamentoAdmin = await resItens.json();
  }

  // --- TRAVA DE COZINHA INTELIGENTE ---
  // Filtra itens pendentes (EM PREPARO) que SÃO da cozinha
  const itensCozinhaEmPreparo = itensFechamentoAdmin.filter(i => i.status === 'pendente' && isItemParaCozinha(i));
  // Filtra itens PRONTOS que ainda não foram marcados como entregues
  const itensProntosNaoEntregues = itensFechamentoAdmin.filter(i => i.status === 'pronto');
  // Filtra itens pendentes que NÃO são da cozinha (bebidas, etc)
  const itensForaCozinhaPend = itensFechamentoAdmin.filter(i => i.status === 'pendente' && !isItemParaCozinha(i));

  if (itensCozinhaEmPreparo.length > 0) {
    // MODAL ESPECÍFICO PARA COZINHA (BLOQUEIO VISUAL MELHORADO)
    const listaHtml = itensCozinhaEmPreparo.map(i => `
      <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(231, 76, 60, 0.1);">
        <span style="font-weight: 600; color: #2c3e50;">• ${i.nome}</span>
        <span style="background: #e74c3c; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold;">${i.quantidade}x</span>
      </div>
    `).join('');

    const msgHtml = `
      <div style="text-align: center; padding: 10px;">
        <div style="background: #fff5f5; width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px;">
          <span style="font-size: 2.5rem;">🍳</span>
        </div>
        <h3 style="color: #e74c3c; margin: 0 0 10px 0; font-size: 1.2rem;">COZINHA EM ANDAMENTO</h3>
        <p style="color: #636e72; font-size: 0.95rem; margin-bottom: 20px;">
          Existem <strong>${itensCozinhaEmPreparo.length} itens</strong> sendo preparados agora. <br>
          Deseja fechar a conta mesmo assim?
        </p>
        <div style="background: #f8f9fa; padding: 15px; border-radius: 12px; border-left: 4px solid #e74c3c; text-align: left; margin-bottom: 20px; max-height: 150px; overflow-y: auto;">
          <p style="font-size: 0.8rem; font-weight: bold; color: #e74c3c; margin-bottom: 8px; text-transform: uppercase;">Pendentes:</p>
          ${listaHtml}
        </div>
      </div>
    `;

    if (!await mostrarConfirmacao(msgHtml, "Atenção: Pedido Incompleto", "Sim, Fechar Conta", "Não, Esperar Cozinha")) {
      return;
    }
  } else if (itensProntosNaoEntregues.length > 0 || itensForaCozinhaPend.length > 0) {
    // Caso de itens prontos ou bebidas que não passaram pela cozinha mas não foram marcados como entregues
    const total = itensProntosNaoEntregues.length + itensForaCozinhaPend.length;
    if (!await mostrarConfirmacao(`✅ A COZINHA já finalizou tudo! No entanto, ainda há ${total} itens que não foram marcados como ENTREGUES. Deseja prosseguir com o fechamento?`, "Itens Pendentes", "Sim, Prosseguir", "Não, Cancelar")) {
      return;
    }
  }
  // ------------------------------------
  
  // Busca pagamentos já realizados para esta mesa
  try {
    const resPagos = await fetch(`/api/pedidos/${idPedido}/pagamentos`);
    const pagamentos = await resPagos.json();
    const containerPagos = document.getElementById('fechamento-historico-pagamentos-container');
    const listaPagos = document.getElementById('fechamento-lista-pagamentos-admin');
    const totalPagoExib = document.getElementById('fechamento-total-ja-pago');

    if (pagamentos && pagamentos.length > 0) {
      containerPagos.style.display = 'block';
      const totalJaPago = pagamentos.reduce((s, p) => s + p.valor, 0);
      totalPagoExib.textContent = `R$ ${totalJaPago.toFixed(2)}`;
      listaPagos.innerHTML = pagamentos.map((p, i) => `
        <div style="display:flex; justify-content:space-between; padding:2px 0; border-bottom:1px dashed #eee; color:#27ae60;">
          <span>${i+1}ª Parte (${p.forma_pagamento})</span>
          <span style="font-weight:bold;">R$ ${p.valor.toFixed(2)}</span>
        </div>
      `).join('');
    } else {
      containerPagos.style.display = 'none';
    }
  } catch (e) { console.error("Erro ao carregar pagamentos:", e); }

  // Marca todos como selecionados por padrão
  itensFechamentoAdmin.forEach(i => i.selecionadoFechamento = true);
  
  renderizarListaItensFechamento();

  const isDelivery = (pedidoParaFecharAdmin.garcom_id === 'DELIVERY');
  const mesaLabel = isDelivery ? `DELIVERY #${pedidoParaFecharAdmin.id}` : (pedidoParaFecharAdmin.mesa_numero ? `Mesa ${pedidoParaFecharAdmin.mesa_numero}` : 'BALCÃO');
  document.getElementById('fechamento-mesa-admin').textContent = mesaLabel;

  const lblTaxaFechamento = document.getElementById('lbl-fechamento-taxa');
  if (lblTaxaFechamento) {
    lblTaxaFechamento.textContent = isDelivery ? "Taxa de Entrega (R$ 3,00):" : "Taxa de Serviço (10%):";
  }
  
  let cobrarTaxaNoPedido = true;
  if (pedidoParaFecharAdmin.cobrar_taxa !== undefined) {
    cobrarTaxaNoPedido = pedidoParaFecharAdmin.cobrar_taxa;
  } else if (pedidosStatusTaxa[idPedido] !== undefined) {
    cobrarTaxaNoPedido = pedidosStatusTaxa[idPedido];
  }
  
  document.getElementById('fechamento-taxa-admin').checked = cobrarTaxaNoPedido;
  document.getElementById('fechamento-acrescimo-admin').value = pedidoParaFecharAdmin.acrescimo || 0;
  document.getElementById('fechamento-desconto-admin').value = pedidoParaFecharAdmin.desconto || 0;
  
  // MAPEA A FORMA DE PAGAMENTO PARA O SELECT DO ADMIN (Garante que Cartão/Cartao/Pix/Dinheiro fiquem pré-selecionados)
  const fpRaw = (pedidoParaFecharAdmin.forma_pagamento || pedidoParaFecharAdmin.metodo_pagamento || 'Dinheiro').trim();
  let fpFinal = 'Dinheiro';
  if (fpRaw.toLowerCase().includes('pix')) fpFinal = 'Pix';
  else if (fpRaw.toLowerCase().includes('cart')) fpFinal = 'Cartão';
  else if (fpRaw.toLowerCase().includes('múltiplas') || fpRaw.toLowerCase().includes('multiplas')) fpFinal = 'Múltiplas';
  else if (fpRaw.toLowerCase().includes('dinh')) fpFinal = 'Dinheiro';

  const num_pessoas_ini = pedidoParaFecharAdmin.num_pessoas || 1;
  const selectForma = document.getElementById('fechamento-forma-admin');
  
  if (selectForma) {
    // SE VEIO DIVIDIDO DO GARÇOM
    if (fpFinal === 'Múltiplas' || (pedidoParaFecharAdmin.pagamentos_detalhados && num_pessoas_ini > 1)) {
        selectForma.value = 'Múltiplas';
        selectForma.disabled = true; // Trava pois é obrigatório usar o modal
    } 
    // SE É APENAS 1 PESSOA NO MOMENTO DE ABRIR
    else if (num_pessoas_ini === 1) {
        selectForma.value = (fpFinal === 'Múltiplas') ? 'Dinheiro' : fpFinal; // Previne erro lógico
        selectForma.disabled = false;
        
        // Remove 'Múltiplas' da tela temporariamente se num_pessoas = 1
        const optMulti = selectForma.querySelector('option[value="Múltiplas"]');
        if (optMulti) optMulti.disabled = true; 
    } 
    // SE O ADMIN JÁ TINHA COLOCADO > 1 PESSOA ANTES
    else {
        selectForma.value = fpFinal;
        selectForma.disabled = false;
        const optMulti = selectForma.querySelector('option[value="Múltiplas"]');
        if (optMulti) optMulti.disabled = false;
    }
  }
  
  document.getElementById('fechamento-recebido-admin').value = pedidoParaFecharAdmin.valor_recebido || '';
  document.getElementById('fechamento-divisao-pessoas').value = pedidoParaFecharAdmin.num_pessoas || 1;
  
  // Reseta tipo de desconto para porcentagem ao abrir (Ativado por padrão)
  tipoDescontoAdmin = 'porcentagem';
  const checkTipo = document.getElementById('check-tipo-desconto');
  if (checkTipo) checkTipo.checked = true;
  const spanTipo = document.getElementById('span-tipo-desconto');
  if (spanTipo) spanTipo.textContent = '%';
  const labelDesconto = document.getElementById('label-desconto-admin');
  if (labelDesconto) labelDesconto.textContent = 'Desconto (%):';
  const inputDesconto = document.getElementById('fechamento-desconto-admin');
  if (inputDesconto) {
    inputDesconto.step = '1';
    inputDesconto.placeholder = 'Valor em %';
  }

  const pagoParcial = pedidoParaFecharAdmin.pago_parcial || 0;
  const elPagoContainer = document.getElementById('fechamento-pago-parcial-container');
  const elPagoValor = document.getElementById('fechamento-pago-parcial-admin');
  if (elPagoContainer && elPagoValor) {
    if (pagoParcial > 0) {
      elPagoValor.textContent = pagoParcial.toFixed(2);
      elPagoContainer.style.display = 'block';
    } else {
      elPagoContainer.style.display = 'none';
    }
  }

  recalcularTotalFechamentoAdmin();
  
  // RESET DA SELEÇÃO AO ABRIR (Sempre seleciona a próxima pessoa que falta pagar)
  pessoaSelecionadaFechamento = null; 

  renderizarAssentosFechamento();
  document.getElementById('modal-fechamento-admin').style.display = 'flex';
  document.body.classList.add('modal-open');
}

function renderizarListaItensFechamento() {
  const container = document.getElementById('fechamento-itens-lista-admin');
  if (!container) return;
  
  container.innerHTML = itensFechamentoAdmin.map((item, index) => `
    <div style="display: flex; align-items: center; gap: 10px; padding: 8px; border-bottom: 1px solid #f0f0f0; font-size: 0.85rem; ${item.status === 'entregue' ? 'background: #f0fff4;' : ''}">
      <input type="checkbox" ${item.selecionadoFechamento ? 'checked' : ''} onchange="alternarItemFechamento(${index})" style="width:18px; height:18px; cursor: pointer;">
      <img src="${item.imagem || 'https://placehold.co/50'}" style="width: 35px; height: 35px; border-radius: 6px; object-fit: cover; border: 1px solid #eee; flex-shrink: 0;">
      <div style="flex-grow: 1; display: flex; flex-direction: column;">
        <span style="font-weight: 600; color: #1e293b;">${item.quantidade}x ${item.nome}</span>
        ${item.observacao ? `<small style="color: #d35400; font-weight: bold; font-size: 0.7rem;">📝 ${item.observacao}</small>` : ''}
      </div>
      <span style="font-weight: 800; color: #2c3e50; white-space: nowrap;">R$ ${(item.preco * item.quantidade).toFixed(2)}</span>
    </div>
  `).join('');
}

function alternarItemFechamento(index) {
  itensFechamentoAdmin[index].selecionadoFechamento = !itensFechamentoAdmin[index].selecionadoFechamento;
  recalcularTotalFechamentoAdmin();
}

function selecionarTodosItensFechamento(selecionar) {
  itensFechamentoAdmin.forEach(i => i.selecionadoFechamento = selecionar);
  renderizarListaItensFechamento();
  recalcularTotalFechamentoAdmin();
}

function mudarPessoasFechamento(delta) {
  const input = document.getElementById('fechamento-divisao-pessoas');
  if (!input) return;

  // TRAVA DE SEGURANÇA: Não permite mudar pessoas se houver pagamento parcial
  const pagoParcial = (pedidoParaFecharAdmin && pedidoParaFecharAdmin.pago_parcial) ? pedidoParaFecharAdmin.pago_parcial : 0;
  if (pagoParcial > 0) {
    mostrarAlerta("⚠️ Esta mesa já possui pagamentos parciais registrados. Para alterar o número de pessoas, é necessário concluir o fechamento atual.", "Ação Bloqueada");
    return;
  }

  let val = parseInt(input.value) || 1;
  val += delta;
  if (val < 1) val = 1;
  input.value = val;

  // SALVA O NÚMERO DE PESSOAS NO BANCO IMEDIATAMENTE (Sticky)
  if (pedidoParaFecharAdmin) {
    atualizarPessoasPedido(pedidoParaFecharAdmin.id, val);
  }

  // Lógica Dinâmica: Ativa/Desativa a opção "Múltiplas" baseado no número de pessoas
  const selectForma = document.getElementById('fechamento-forma-admin');
  if (selectForma) {
    const optMulti = selectForma.querySelector('option[value="Múltiplas"]');
    
    if (val > 1) {
      if (optMulti) optMulti.disabled = false;
      // Seleciona automaticamente para facilitar, mas deixa livre para mudar
      if (selectForma.value !== 'Múltiplas') {
          selectForma.value = 'Múltiplas';
      }
      selectForma.disabled = false; 
    } else {
      if (selectForma.value === 'Múltiplas') {
        selectForma.value = 'Dinheiro';
      }
      selectForma.disabled = false;
      if (optMulti) optMulti.disabled = true; // Esconde se for só 1 pessoa
    }
  }

  recalcularTotalFechamentoAdmin();
}

async function confirmarCancelamentoDesdeFechamento() {
  if (!pedidoParaFecharAdmin) return;
  
  const pagoParcial = pedidoParaFecharAdmin.pago_parcial || 0;
  if (pagoParcial > 0) {
    return await mostrarAlerta("⚠️ Esta mesa já possui pagamentos parciais (R$ "+pagoParcial.toFixed(2)+"). Não é possível cancelar o pedido inteiro. Você deve concluir o recebimento ou estornar os pagamentos manualmente no banco.", "Aviso de Segurança", "⚠️");
  }

  // NOVA TRAVA: Verifica se existem itens já entregues (servidos)
  const temEntregues = itensFechamentoAdmin.some(i => i.status === 'entregue');
  let mensagemConfirmacao = "⚠️ DESEJA REALMENTE CANCELAR TODO O PEDIDO?\n\nA mesa será liberada e o pedido irá para o histórico como CANCELADO.";
  
  if (temEntregues) {
    mensagemConfirmacao = "🚨 ATENÇÃO: EXISTEM ITENS JÁ SERVIDOS NESTA MESA!\n\nSe você cancelar, esses produtos terão saído do estoque sem registro de venda. \n\nCONFIRMA O CANCELAMENTO MESMO ASSIM?";
  }

  if (await mostrarConfirmacao(mensagemConfirmacao, temEntregues ? "ALERTA CRÍTICO" : "Atenção", "SIM, CANCELAR", "NÃO")) {
    const res = await fetch(`/api/pedidos/${pedidoParaFecharAdmin.id}/status`, { 
      method: 'PUT', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ status: 'cancelado' }) 
    });
    if (res.ok) { 
      fecharModalFechamentoAdmin(); 
      carregarPedidos(); 
    }
  }
}

function recalcularTotalFechamentoAdmin() {
  const selecionados = itensFechamentoAdmin.filter(i => i.selecionadoFechamento);
  subtotalConsumoAdmin = selecionados.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);

  const cobrarTaxa = document.getElementById('fechamento-taxa-admin').checked;
  const isDelivery = (pedidoParaFecharAdmin && pedidoParaFecharAdmin.garcom_id === 'DELIVERY');
  const taxa = cobrarTaxa ? (isDelivery ? 3.00 : subtotalConsumoAdmin * 0.10) : 0;
  const acrescimo = parseFloat(document.getElementById('fechamento-acrescimo-admin').value) || 0;

  const descontoInput = parseFloat(document.getElementById('fechamento-desconto-admin').value) || 0;
  let desconto = descontoInput;
  if (tipoDescontoAdmin === 'porcentagem') {
    desconto = (subtotalConsumoAdmin + taxa + acrescimo) * (descontoInput / 100);
  }

  const recebido = parseFloat(document.getElementById('fechamento-recebido-admin').value) || 0;
  const pessoas = parseInt(document.getElementById('fechamento-divisao-pessoas').value) || 1;
  
  // BUSCA O VALOR JÁ PAGO SALVO NO OBJETO DO PEDIDO
  const pagoParcial = (pedidoParaFecharAdmin && pedidoParaFecharAdmin.pago_parcial) ? pedidoParaFecharAdmin.pago_parcial : 0;

  // O SALDO RESTANTE agora é o Total Bruto (itens+taxa+acres-desc) MENOS o que já foi pago antecipadamente
  const totalBruto = (subtotalConsumoAdmin + taxa + acrescimo - desconto);
  const saldoRestante = Math.max(0, totalBruto - pagoParcial);
  const valorPessoa = saldoRestante / pessoas;
  
  const trocoTotal = recebido > saldoRestante ? recebido - saldoRestante : 0;
  const trocoCota = (recebido > valorPessoa && pessoas > 1) ? recebido - valorPessoa : 0;

  document.getElementById('fechamento-subtotal-admin').textContent = subtotalConsumoAdmin.toFixed(2);
  document.getElementById('fechamento-taxa-valor-admin').textContent = taxa.toFixed(2);
  
  // Exibe o Saldo Real que falta pagar
  document.getElementById('fechamento-total-admin').textContent = saldoRestante.toFixed(2);
  document.getElementById('fechamento-valor-pessoa-admin').textContent = valorPessoa.toFixed(2);

  const elTroco = document.getElementById('fechamento-troco-admin');
  if (pessoas > 1) {
      elTroco.style.fontSize = "0.9rem";
      elTroco.innerHTML = `Cota: <strong>R$ ${trocoCota.toFixed(2)}</strong><br><small style="opacity:0.6">Total: R$ ${trocoTotal.toFixed(2)}</small>`;
  } else {
      elTroco.style.fontSize = "1.1rem";
      elTroco.textContent = trocoTotal.toFixed(2);
  }

  // ATUALIZAÇÃO DOS NOVOS BOTÕES DE AÇÃO DIRETA
  const btnCota = document.getElementById('btn-pagar-cota-admin');
  const btnTudo = document.getElementById('btn-pagar-tudo-admin');
  const lblCota = document.getElementById('lbl-valor-cota-btn');
  const lblTudo = document.getElementById('lbl-valor-tudo-btn');
  const containerBotoes = document.getElementById('container-botoes-fechamento-dinamico');

  if (btnCota && btnTudo) {
    if (pessoas > 1) {
      btnCota.style.display = 'block';
      containerBotoes.style.gridTemplateColumns = '1fr 1fr';
      if (lblCota) lblCota.textContent = `R$ ${valorPessoa.toFixed(2)}`;
    } else {
      btnCota.style.display = 'none';
      containerBotoes.style.gridTemplateColumns = '1fr';
    }
    const txtTrocoTudo = trocoTotal > 0 ? ` | TROCO: R$ ${trocoTotal.toFixed(2)}` : '';
    if (lblTudo) lblTudo.textContent = `R$ ${saldoRestante.toFixed(2)}${txtTrocoTudo}`;
    
    const lblTextoTudo = document.getElementById('lbl-pagar-tudo-texto');
    if (lblTextoTudo) lblTextoTudo.textContent = isDelivery ? 'FINALIZAR E LIBERAR DELIVERY' : 'FINALIZAR TUDO';
  }

  // CONTROLE DINÂMICO DE VISIBILIDADE DO TROCO
  const formaPagamento = document.getElementById('fechamento-forma-admin').value;
  const secaoTroco = document.getElementById('secao-troco-admin');
  const inputRecebido = document.getElementById('fechamento-recebido-admin');

  if (secaoTroco) {
      const estavaEscondido = secaoTroco.style.display === 'none';
      secaoTroco.style.display = (formaPagamento === 'Dinheiro') ? 'block' : 'none';
      
      // SÓ FOCA se a seção acabou de aparecer (evita perder o foco enquanto digita)
      if (formaPagamento === 'Dinheiro' && estavaEscondido && inputRecebido) {
          setTimeout(() => {
              inputRecebido.focus();
              inputRecebido.select();
          }, 50);
      }
  }

  // Chama a renderização dos assentos de forma unificada
  renderizarAssentosFechamento();
}

let pessoaSelecionadaFechamento = null;

function selecionarPessoaDivisao(index) {
  console.log("👉 Selecionando pessoa:", index);
  pessoaSelecionadaFechamento = index;
  renderizarAssentosFechamento(); // Re-renderiza com o novo destaque
  mostrarToast(`🎯 Cobrando da PESSOA ${index}`);
}

async function renderizarAssentosFechamento() {
  const gridAssentos = document.getElementById('fechamento-grid-assentos');
  if (!gridAssentos) return;

  // numRestantes é o que está no input (pessoas que ainda faltam pagar)
  const numRestantes = parseInt(document.getElementById('fechamento-divisao-pessoas').value) || 1;
  const progressoTxt = document.getElementById('txt-progresso-divisao');
  const progressoPerc = document.getElementById('perc-progresso-divisao');
  const progressoBarra = document.getElementById('barra-progresso-divisao');

  try {
    const res = await fetch(`/api/pedidos/${pedidoParaFecharAdmin.id}/pagamentos`);
    const pagamentos = await res.json();
    const pagosCount = pagamentos ? pagamentos.length : 0;

    // O TOTAL real de pessoas é quem já pagou + quem falta pagar
    const totalPessoasOriginal = pagosCount + numRestantes;

    // Atualiza Barra de Progresso
    if (progressoBarra) {
      const percentual = Math.min(100, Math.round((pagosCount / totalPessoasOriginal) * 100));
      if (progressoTxt) progressoTxt.textContent = `Pagamento: ${pagosCount} de ${totalPessoasOriginal} ${totalPessoasOriginal > 1 ? 'pessoas' : 'pessoa'}`;
      if (progressoPerc) progressoPerc.textContent = `${percentual}%`;
      progressoBarra.style.width = `${percentual}%`;
    }

    // Lógica de Seleção: Foca no próximo que falta pagar (sempre logo após os já pagos)
    if (pessoaSelecionadaFechamento === null || pessoaSelecionadaFechamento <= pagosCount || pessoaSelecionadaFechamento > totalPessoasOriginal) {
      pessoaSelecionadaFechamento = (pagosCount < totalPessoasOriginal) ? pagosCount + 1 : totalPessoasOriginal;
    }

    let html = '';
    for (let i = 1; i <= totalPessoasOriginal; i++) {
      let bg = '#fff';
      let border = '#ffcc80';
      let corTexto = '#d35400';
      let icone = '👤';
      let cursor = 'pointer';
      let onclick = `onclick="selecionarPessoaDivisao(${i})"`;
      let escala = '1';
      let sombra = 'none';

      if (i <= pagosCount) {
        // JÁ PAGO
        bg = '#27ae60';
        border = '#219150';
        corTexto = '#fff';
        icone = '✅';
        cursor = 'default';
        onclick = ''; 
      } else if (i === pessoaSelecionadaFechamento) {
        // SELECIONADO ATUAL
        bg = '#e67e22';
        border = '#d35400';
        corTexto = '#fff';
        icone = '🎯';
        escala = '1.15';
        sombra = '0 6px 12px rgba(230, 126, 34, 0.4)';
      }

      html += `
        <div ${onclick} style="width: 50px; height: 55px; background: ${bg}; border: 3px solid ${border}; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: ${cursor}; transition: 0.2s all; transform: scale(${escala}); box-shadow: ${sombra}; z-index: ${i === pessoaSelecionadaFechamento ? '10' : '1'};">
          <span style="font-size: 1.1rem;">${icone}</span>
          <span style="font-size: 0.75rem; font-weight: 900; color: ${corTexto};">P${i}</span>
        </div>
      `;
    }
    gridAssentos.innerHTML = html;
  } catch (e) { console.error("Erro ao renderizar:", e); }
}

async function confirmarPagamentoAdmin(modo = 'tudo') {
  const idPedido = pedidoParaFecharAdmin.id;
  const idMesa = pedidoParaFecharAdmin.mesa_id;
  const selecionados = itensFechamentoAdmin.filter(i => i.selecionadoFechamento);

  if (selecionados.length === 0) return await mostrarAlerta("Selecione pelo menos um item para pagar!", "Aviso", "⚠️");

  const subtotalLocal = selecionados.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
  const todosItensSelecionados = selecionados.length === itensFechamentoAdmin.length;

  const forma_pagamento = document.getElementById('fechamento-forma-admin').value;
  const acrescimo = parseFloat(document.getElementById('fechamento-acrescimo-admin').value) || 0;

  const descontoInput = parseFloat(document.getElementById('fechamento-desconto-admin').value) || 0;
  const cobrarTaxa = document.getElementById('fechamento-taxa-admin').checked;
  const taxaServico = cobrarTaxa ? subtotalLocal * 0.10 : 0;

  let desconto = descontoInput;
  if (tipoDescontoAdmin === 'porcentagem') {
    desconto = (subtotalLocal + taxaServico + acrescimo) * (descontoInput / 100);
  }

  const valor_recebido = parseFloat(document.getElementById('fechamento-recebido-admin').value) || 0;
  const num_pessoas = parseInt(document.getElementById('fechamento-divisao-pessoas').value) || 1;
  const pagoParcial = (pedidoParaFecharAdmin && pedidoParaFecharAdmin.pago_parcial) ? pedidoParaFecharAdmin.pago_parcial : 0;

  const total = (subtotalLocal + taxaServico + acrescimo - desconto) - pagoParcial;
  const valor_por_pessoa = total / num_pessoas;
  
  // CORREÇÃO DO TROCO: Se for apenas 1 cota, calcula troco sobre a cota. Se for tudo, sobre o total.
  const valorParaTroco = (modo === 'cota') ? valor_por_pessoa : total;
  const troco = valor_recebido > valorParaTroco ? valor_recebido - valorParaTroco : 0;

  // VALIDAÇÃO OBRIGATÓRIA PARA DINHEIRO
  // Só valida se for pagamento em dinheiro E (for pagamento de 1 cota OU fechamento total de apenas 1 pessoa)
  // Se for "FECHAR TUDO" com mais de 1 pessoa, o sistema abrirá o multi-pagamento e não precisa validar aqui.
  const isPagamentoUnicoDinheiro = forma_pagamento === 'Dinheiro' && (modo === 'cota' || (modo === 'tudo' && num_pessoas === 1));

  if (modo !== 'imprimir' && isPagamentoUnicoDinheiro) {
    const valorComparar = modo === 'cota' ? valor_por_pessoa : total;
    if (!valor_recebido || valor_recebido <= 0) {
      await mostrarAlerta("⚠️ O campo 'Valor Recebido' é obrigatório para pagamentos em Dinheiro!", "Aviso", "⚠️");
      const inputRec = document.getElementById('fechamento-recebido-admin');
      if (inputRec) { inputRec.focus(); inputRec.select(); }
      return;
    }
    if (valor_recebido < valorComparar) {
      await mostrarAlerta(`⚠️ Valor insuficiente! O valor a pagar é R$ ${valorComparar.toFixed(2)} e você informou R$ ${valor_recebido.toFixed(2)}.`, "Aviso", "⚠️");
      const inputRec = document.getElementById('fechamento-recebido-admin');
      if (inputRec) { inputRec.focus(); inputRec.select(); }
      return;
    }
  }

  // MODO: APENAS IMPRIMIR PRÉ-CONTA
  if (modo === 'imprimir') {
    const pedidoParcialMock = {
      ...pedidoParaFecharAdmin,
      num_pessoas: num_pessoas,
      valor_por_pessoa: valor_por_pessoa,
      acrescimo: acrescimo,
      desconto: desconto,
      cobrar_taxa: cobrarTaxa,
      pago_parcial: pagoParcial,
      isImpressaoParcialMesa: true,
      total: (subtotalLocal + taxaServico + acrescimo - desconto)
    };
    imprimirCupom(pedidoParcialMock, selecionados);
    return;
  }

  try {
    // MODO: PAGAR APENAS UMA COTA (FRAÇÃO)
    if (modo === 'cota') {
      let historicoAtual = [];
      try {
        const resH = await fetch(`/api/pedidos/${idPedido}/pagamentos`);
        if (resH.ok) historicoAtual = await resH.json();
      } catch(e) {}
      
      const proximaParte = historicoAtual.length + 1;
      
      const resFracao = await fetch(`/api/pedidos/${idPedido}/pagamento-fracao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          mesa_id: idMesa, 
          valor_pago: valor_por_pessoa,
          forma_pagamento, 
          num_pessoas_restantes: Math.max(1, num_pessoas - 1),
          recebido: valor_recebido, // ENVIA O RECEBIDO REAL
          troco: troco             // ENVIA O TROCO REAL
        })
      });

      if (resFracao.ok) {
        mostrarToast(`✅ Parte ${proximaParte} paga com sucesso!`);
        const pedidoMock = {
          ...pedidoParaFecharAdmin,
          num_pessoas: num_pessoas,
          valor_por_pessoa: valor_por_pessoa,
          acrescimo: acrescimo,
          desconto: desconto,
          cobrar_taxa: cobrarTaxa,
          pago_parcial: pedidoParaFecharAdmin.pago_parcial || 0,
          forma_pagamento: forma_pagamento,
          valor_recebido: valor_recebido,
          troco: troco,
          isFracaoPagamento: true,
          total: (subtotalLocal + taxaServico + acrescimo - desconto),
          pagamentos_detalhados_lista: [{ // Adiciona à lista para o cupom ler na hora
            forma_pagamento: forma_pagamento,
            valor: valor_por_pessoa,
            recebido: valor_recebido,
            troco: troco
          }]
        };
        imprimirCupom(pedidoMock, itensFechamentoAdmin);
        fecharModalFechamentoAdmin();
        await carregarStatusCaixa();
        setTimeout(() => carregarPedidos(), 300);
        return;
      }
    }

    // MODO: FECHAMENTO TOTAL OU PARCIAL POR ITENS
    if (!todosItensSelecionados) {
      // PAGAMENTO PARCIAL POR ITENS
      const resParcial = await fetch(`/api/pedidos/${idPedido}/pagamento-parcial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          mesa_id: idMesa, 
          itens: selecionados,
          forma_pagamento, 
          acrescimo, 
          desconto, 
          valor_recebido, 
          troco, 
          total,
          num_pessoas,
          valor_por_pessoa
        })
      });

      if (!resParcial.ok) throw new Error("Erro no pagamento parcial");
      
      mostrarToast("✅ Pagamento parcial (itens) registrado!");
      imprimirCupomParcialItens(pedidoParaFecharAdmin, selecionados, total, cobrarTaxa);
    } else {
      // FECHAMENTO TOTAL DA MESA
      let formasPagamentoPessoas = null;
      let finalFormaPagamento = forma_pagamento;
      
      if (num_pessoas > 1 && modo === 'tudo') {
        // Tenta usar os pagamentos detalhados enviados pelo garçom primeiro
        let pagamentosGarcom = null;
        if (pedidoParaFecharAdmin.pagamentos_detalhados) {
            try {
                pagamentosGarcom = typeof pedidoParaFecharAdmin.pagamentos_detalhados === 'string' 
                                            ? JSON.parse(pedidoParaFecharAdmin.pagamentos_detalhados) 
                                            : pedidoParaFecharAdmin.pagamentos_detalhados;
                console.log("💰 Usando pagamentos detalhados definidos pelo garçom:", pagamentosGarcom);
            } catch (e) {
                console.error("Erro ao fazer parse de pagamentos_detalhados:", e);
            }
        }
        
        // SEMPRE abre o modal para conferência (seja do garçom ou novo)
        formasPagamentoPessoas = await mostrarModalMultiPagamento(num_pessoas, valor_por_pessoa, pagamentosGarcom);
        if (!formasPagamentoPessoas) return; // Se cancelar no modal, interrompe

        finalFormaPagamento = 'Múltiplas';
      }

      const resFechamento = await fetch(`/api/pedidos/${idPedido}/solicitar-fechamento`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          mesa_id: idMesa, 
          forma_pagamento: finalFormaPagamento, 
          desconto, acrescimo, valor_recebido, troco, total,
          num_pessoas, valor_por_pessoa, cobrar_taxa: cobrarTaxa
        })
      });
      if (!resFechamento.ok) throw new Error("Erro ao atualizar dados de fechamento");

      const resStatus = await fetch(`/api/pedidos/${idPedido}/status`, { 
        method: 'PUT', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ status: 'entregue', pagamentos_detalhados: formasPagamentoPessoas }) 
      });

      if (!resStatus.ok) throw new Error("Erro ao finalizar pedido");
      if (idMesa) await fetch(`/api/mesas/${idMesa}/liberar`, { method: 'PUT' });
      
      mostrarToast("✅ Conta Total Finalizada!");
      const novosPagamentosCount = (formasPagamentoPessoas && formasPagamentoPessoas.length) ? formasPagamentoPessoas.length : 1;
      
      const pedidoFinal = { 
        ...pedidoParaFecharAdmin, 
        num_pessoas: num_pessoas, 
        valor_por_pessoa: valor_por_pessoa, 
        total: total, 
        cobrar_taxa: cobrarTaxa, 
        acrescimo: acrescimo, 
        desconto: desconto, 
        pago_parcial: pagoParcial, 
        forma_pagamento: finalFormaPagamento,
        valor_recebido: valor_recebido,
        troco: troco,
        isFechamentoFinal: true,
        novosPagamentosCount: novosPagamentosCount,
        pagamentos_detalhados_lista: formasPagamentoPessoas
      };
      
      // NOVA CONFIRMAÇÃO DE IMPRESSÃO
      if (await mostrarConfirmacao("Venda concluída com sucesso!\n\nDeseja imprimir o cupom final agora?", "Impressão Final", "Sim, Imprimir", "Não")) {
          console.log("🖨️ Disparando impressão final detalhada...");
          imprimirCupom(pedidoFinal, itensFechamentoAdmin);
      }
    }
    
    fecharModalFechamentoAdmin();
    await carregarStatusCaixa();
    if (abaAtiva === 'lancar') switchTab('historico'); else carregarPedidos();

  } catch (error) {
    console.error(error);
    await mostrarAlerta("❌ Erro: " + error.message, "Erro", "❌");
  }
}

function imprimirCupomParcialFracao(pedido, itens, valorPago, saldoRestante, pessoasRestantes, cobrarTaxa) {
  const container = document.getElementById('cupom-impressao');
  if (!container) return;
  aplicarConfiguracaoImpressao();

  const subtotal = itens.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
  const isDelivery = (pedido.garcom_id === 'DELIVERY');
  const taxa = cobrarTaxa ? (isDelivery ? 3.00 : subtotal * 0.10) : 0;
  const totalMesa = subtotal + taxa;
  const numPessoasTotal = (pessoasRestantes + 1);
  const mesaNomeCupom = pedido.mesa_numero ? `MESA ${pedido.mesa_numero}` : `PEDIDO #${pedido.id}`;

  const html = `
    <div class="cupom-header">
      <h2 style="margin:0; font-size: 12pt; font-weight: 900;">GuGA Bebidas</h2>
      <p style="margin:2px 0; font-size: 9pt; font-weight: 700;">Comprovante de Pedido</p>
      <p style="margin:2px 0; font-weight: 900; font-size: 11pt;">${mesaNomeCupom}</p>
      <p style="margin:2px 0; font-size: 9pt;"><strong>ABERTURA:</strong> ${formatarData(pedido.created_at)}</p>
      <p style="margin:2px 0; font-size: 8pt;"><strong>EMISSÃO:</strong> ${new Date().toLocaleString('pt-BR')}</p>
      <p style="margin:2px 0; font-size: 9pt; font-weight:900;">DIVIDIDO POR: ${numPessoasTotal} PESSOAS</p>
    </div>
    
    <div style="font-size: 10pt;">
      ${itens.map(i => `
        <div style="display:flex; justify-content:space-between; margin-bottom: 2px;">
          <span style="flex:1; padding-right:6px; overflow:hidden; text-overflow: ellipsis; white-space:nowrap; font-weight:700;">${i.quantidade}x ${i.nome}</span>
          <span style="flex:0 0 auto; white-space:nowrap; font-weight:900;">R$ ${(i.preco * i.quantidade).toFixed(2)}</span>
        </div>
        ${i.observacao ? `<div style="font-size:9pt; margin-bottom:4px; font-weight:700;">&nbsp;&nbsp;- ${i.observacao}</div>` : ''}
      `).join('')}
    </div>

    <div class="cupom-footer" style="font-size: 10pt;">
      <div style="display:flex; justify-content:space-between; margin-top:5px;">
        <span style="font-weight:900;">SUBTOTAL:</span>
        <span style="font-weight:900;">R$ ${subtotal.toFixed(2)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-weight: 900; font-size: 10pt; background: #f1f2f6; padding: 2px 4px; border-radius: 4px; margin: 2px 0;">
        <span>${isDelivery ? 'TAXA ENTREGA' : `TAXA SERV (${cobrarTaxa ? '10%' : 'OFF'})`}:</span>
        <span>R$ ${taxa.toFixed(2)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-size: 12pt; font-weight: 900; border-top: 2px solid #000; padding-top: 4px; margin-top: 4px;">
        <span>TOTAL PAGO:</span>
        <span>R$ ${totalMesa.toFixed(2)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-weight:bold; margin-top:2px;">
        <span>VALOR POR PESSOA:</span>
        <span>R$ ${valorPago.toFixed(2)}</span>
      </div>
    </div>

    <div class="cupom-central">
      <p style="margin: 5px 0;">OBRIGADO PELA PREFERÊNCIA!</p>
      <p style="margin: 2px 0; font-size: 7pt;">GuGA Bebidas - Sistema de Gestão</p>
      <br><br>.
    </div>
  `;

  container.innerHTML = html;
  setTimeout(() => { window.print(); }, 250);
}

function imprimirCupomParcialItens(pedido, itensPagos, totalPago, cobrarTaxa) {
  const container = document.getElementById('cupom-impressao');
  if (!container) return;
  aplicarConfiguracaoImpressao();

  const isDelivery = (pedido.garcom_id === 'DELIVERY');
  const subtotalPagos = itensPagos.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
  const taxaPagos = cobrarTaxa ? (isDelivery ? 0 : subtotalPagos * 0.10) : 0;
  // O totalPago já vem calculado com taxa/desconto/acréscimo da função chamadora

  const html = `
    <div class="cupom-header">
      <h2 style="margin:0; font-size: 12pt; font-weight: 900;">GuGA Bebidas</h2>
      <p style="margin:2px 0; font-weight: 900; font-size: 10pt;">*** PAGAMENTO DE ITENS ***</p>
      <p style="margin:2px 0; font-weight: 900; font-size: 11pt;">${pedido.mesa_numero ? `MESA ${pedido.mesa_numero}` : `PEDIDO #${pedido.id}`}</p>
      <p style="margin:2px 0; font-size: 9pt;"><strong>ABERTURA:</strong> ${formatarData(pedido.created_at)}</p>
      <p style="margin:2px 0; font-size: 8pt;"><strong>EMISSÃO:</strong> ${new Date().toLocaleString('pt-BR')}</p>
    </div>

    <div style="font-size: 10pt; margin-top: 10px; border-bottom: 1px solid #000; padding-bottom: 5px;">
      <p style="margin:0 0 5px 0; font-weight:900; text-align:center;">ITENS PAGOS NESTA PARCIAL</p>
      ${itensPagos.map(i => `
        <div style="display:flex; justify-content:space-between; margin-bottom: 2px;">
          <span style="flex:1; padding-right:6px; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; font-weight:700;">${i.quantidade}x ${i.nome}</span>
          <span style="flex:0 0 auto; white-space:nowrap; font-weight:900;">R$ ${(i.preco * i.quantidade).toFixed(2)}</span>
        </div>
      `).join('')}
    </div>

    <div class="cupom-footer" style="font-size: 10pt;">
      <div style="display:flex; justify-content:space-between; margin-top:5px;">
        <span style="font-weight:900;">SUBTOTAL ITENS:</span>
        <span style="font-weight:900;">R$ ${subtotalPagos.toFixed(2)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-weight: 900; font-size: 10pt; background: #f1f2f6; padding: 2px 4px; border-radius: 4px; margin: 2px 0;">
        <span>${isDelivery ? 'TAXA ENTREGA' : `TAXA SERV (${cobrarTaxa ? '10%' : 'OFF'})`}:</span>
        <span>R$ ${taxaPagos.toFixed(2)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-size: 12pt; font-weight: 900; border-top: 2px solid #000; padding-top: 4px; margin-top: 4px;">
        <span>TOTAL PAGO:</span>
        <span>R$ ${totalPago.toFixed(2)}</span>
      </div>
    </div>

    <div class="cupom-central" style="margin-top: 20px;">
      <p style="margin: 5px 0; font-size: 8pt;">Os demais itens continuam na conta da mesa.</p>
      <p style="margin: 2px 0; font-size: 7pt;">GuGA Bebidas - Sistema de Gestão</p>
      <br><br>.
    </div>
  `;
  container.innerHTML = html;
  setTimeout(() => { window.print(); }, 250);
}

function fecharModalFechamentoAdmin() { 
  document.getElementById('modal-fechamento-admin').style.display = 'none'; 
  
  // LIBERA O SCROLL APENAS se não estiver nas abas que exigem trava
  if (abaAtiva !== 'lancar' && abaAtiva !== 'ativos') {
      document.body.classList.remove('modal-open');
  }
}

function fecharModalMultiPagamento() { 
  document.getElementById('modal-multi-pagamento').style.display = 'none'; 
  document.body.classList.remove('modal-open');
}

function mostrarModalMultiPagamento(numPessoas, valorPorPessoa, pagamentosGarcom = null) {
  return new Promise(resolve => {
    const elV = document.getElementById('multi-pag-valor-pessoa');
    if (elV) elV.innerText = valorPorPessoa.toFixed(2);
    
    const container = document.getElementById('multi-pag-lista-pessoas');
    if (!container) return resolve(null);

    container.innerHTML = '';
    for (let i = 1; i <= numPessoas; i++) {
      let formaAtual = 'Dinheiro';
      let recebidoAtual = valorPorPessoa.toFixed(2);
      
      if (pagamentosGarcom && pagamentosGarcom[i-1]) {
        formaAtual = pagamentosGarcom[i-1].forma_pagamento;
        if (formaAtual === 'Dinheiro') {
           recebidoAtual = (pagamentosGarcom[i-1].recebido || valorPorPessoa).toFixed(2);
        } else {
           recebidoAtual = '';
        }
      }

      container.innerHTML += `
        <div class="multi-pag-card" style="background: #f8f9fa; padding: 12px; border-radius: 10px; border: 1px solid #dee2e6; margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <strong style="color: #2c3e50; font-size: 1rem;">👤 Pessoa ${i}:</strong>
            <select class="multi-pag-forma-select" data-index="${i}" onchange="toggleMultiPagDinheiro(${i}, this.value)" style="padding: 8px; border-radius: 6px; border: 1px solid #cbd5e0; font-size: 0.95rem; font-weight: bold; background: white;">
              <option value="Dinheiro" ${formaAtual === 'Dinheiro' ? 'selected' : ''}>💵 Dinheiro</option>
              <option value="Pix" ${formaAtual === 'Pix' ? 'selected' : ''}>📱 Pix</option>
              <option value="Cartão" ${formaAtual === 'Cartão' ? 'selected' : ''}>💳 Cartão</option>
            </select>
          </div>
          
          <div id="multi-pag-dinheiro-container-${i}" style="display: flex; gap: 10px; align-items: center; padding-top: 8px; border-top: 1px dashed #cbd5e0; transition: 0.3s opacity; opacity: ${formaAtual === 'Dinheiro' ? '1' : '0.3'};">
            <div style="flex: 1;">
              <label style="display:block; font-size: 0.7rem; font-weight: bold; color: #64748b; margin-bottom: 2px;">VALOR RECEBIDO:</label>
              <input type="number" step="0.01" class="multi-pag-recebido-input" 
                     oninput="calcularTrocoMultiPag(${i}, ${valorPorPessoa})" 
                     id="multi-pag-recebido-${i}" 
                     value="${recebidoAtual}" 
                     ${formaAtual === 'Dinheiro' ? '' : 'disabled'}
                     style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #cbd5e0; font-weight: 800; font-size: 1rem; color: #27ae60; box-sizing: border-box;">
            </div>
            <div style="flex: 1; text-align: right;">
              <label style="display:block; font-size: 0.7rem; font-weight: bold; color: #64748b; margin-bottom: 2px;">TROCO:</label>
              <strong id="multi-pag-troco-${i}" style="font-size: 1.1rem; color: #27ae60;">R$ 0,00</strong>
            </div>
          </div>
        </div>`;
    }

    const modal = document.getElementById('modal-multi-pagamento');
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');

    setTimeout(() => {
        for (let i = 1; i <= numPessoas; i++) {
            if (pagamentosGarcom && pagamentosGarcom[i-1] && pagamentosGarcom[i-1].forma_pagamento === 'Dinheiro') {
                calcularTrocoMultiPag(i, valorPorPessoa);
            }
        }
    }, 50);

    // Garante que o botão de confirmar capture os dados exatos da tela
    const btnFinalizar = document.getElementById('btn-confirmar-multi-pagamento');
    btnFinalizar.onclick = () => {
      const pagamentosDetalhados = [];
      const selects = container.querySelectorAll('.multi-pag-forma-select');
      
      for (let sel of selects) {
        const i = sel.dataset.index;
        const forma = sel.value;
        const inputRec = document.getElementById(`multi-pag-recebido-${i}`);
        
        // Valor que foi efetivamente digitado (ou o valor da cota se não digitou nada)
        const valorDigitado = inputRec ? parseFloat(inputRec.value) : 0;
        const recebido = (forma === 'Dinheiro') ? (valorDigitado || valorPorPessoa) : valorPorPessoa;
        const troco = (forma === 'Dinheiro') ? Math.max(0, recebido - valorPorPessoa) : 0;
        
        if (forma === 'Dinheiro' && recebido < (valorPorPessoa - 0.01)) {
          mostrarAlerta(`⚠️ Pessoa ${i}: Valor recebido insuficiente!`, "Aviso", "⚠️");
          return;
        }
        
        pagamentosDetalhados.push({
          pessoa: parseInt(i),
          forma_pagamento: forma,
          valor: valorPorPessoa,
          recebido: recebido,
          troco: troco
        });
      }
      
      console.log("✅ Dados capturados para o cupom:", pagamentosDetalhados);
      fecharModalMultiPagamento();
      document.body.classList.remove('modal-open');
      resolve(pagamentosDetalhados);
    };
  });
}

// FUNÇÕES AUXILIARES PARA O MULTI-PAGAMENTO
function toggleMultiPagDinheiro(index, forma) {
  const container = document.getElementById(`multi-pag-dinheiro-container-${index}`);
  if (container) {
    container.style.opacity = (forma === 'Dinheiro') ? '1' : '0.3';
    const input = document.getElementById(`multi-pag-recebido-${index}`);
    if (input) input.disabled = (forma !== 'Dinheiro');
  }
}

function calcularTrocoMultiPag(index, valorCota) {
  const recebido = parseFloat(document.getElementById(`multi-pag-recebido-${index}`).value) || 0;
  const elTroco = document.getElementById(`multi-pag-troco-${index}`);
  if (elTroco) {
    const troco = Math.max(0, recebido - valorCota);
    elTroco.innerText = `R$ ${troco.toFixed(2)}`;
    elTroco.style.color = troco > 0 ? '#27ae60' : '#e74c3c';
  }
}

async function carregarCardapio() {
  const res = await fetch('/api/menu');
  cardapio = await res.json();
  const select = document.getElementById('menu-select');
  if (select) {
    const cardapioAtivo = cardapio.filter(i => i.visivel !== false && i.visivel !== 0);
    select.innerHTML = cardapioAtivo.map(item => `<option value="${item.id}">${item.nome} - R$ ${item.preco.toFixed(2)}</option>`).join('');
  }
  
  // Atualiza as interfaces que dependem do cardápio/estoque em tempo real
  if (abaAtiva === 'configuracoes') {
      exibirMenuConfig();
      exibirConfigCategoriasCozinha();
  }
  if (abaAtiva === 'lancar') {
      const catAtiva = document.querySelector('#lancar-menu-categorias .cat-mini.ativa');
      const catNome = catAtiva ? catAtiva.id.replace('cat-lancar-', '') : 'todas';
      exibirMenuLancar(catNome);
  }
  
  // Se o modal de edição estiver aberto, atualiza o cardápio de lá também
  const modalEdicao = document.getElementById('modal-edicao');
  if (modalEdicao && modalEdicao.style.display === 'flex') {
      const btnAtivo = document.querySelector('#edit-menu-categorias .categoria-mini.active');
      const catNomeEdicao = btnAtivo ? btnAtivo.innerText : 'Todos';
      renderizarMenuEdicao(catNomeEdicao === 'Todos' ? 'todas' : catNomeEdicao);
  }
}

function iniciarPiscarTitulo() { if (intervalPiscaTitulo) return; let alt = false; intervalPiscaTitulo = setInterval(() => { document.title = alt ? '🔔 NOVO!' : '⚠️ VERIFIQUE'; alt = !alt; }, 1000); }
function pararPiscarTitulo() { clearInterval(intervalPiscaTitulo); intervalPiscaTitulo = null; document.title = tituloOriginal; }
function solicitarPermissaoNotificacao() { if ("Notification" in window) Notification.requestPermission(); }
function exibirNotificacaoNativa(tit, msg, tagId = 'geral') { 
  const somWindows = localStorage.getItem('admin_som_windows') === 'true';
  
  // Adiciona à nossa central de notificações geral
  let icone = '🔔';
  if (tit.includes('CHAMADO')) icone = '🛎️';
  else if (tit.includes('CONTA')) icone = '💰';
  else if (tit.includes('PEDIDO')) icone = '🚀';
  else if (tit.includes('PRONTO')) icone = '🍳';
  else if (tit.includes('ESTOQUE')) icone = '⚠️';
  adicionarNotificacao(tit, msg, icone);

  if ("Notification" in window && Notification.permission === "granted") {
    const n = new Notification(tit, { 
      body: msg,
      tag: tagId, // Evita empilhamento: nova notificação da mesma tag substitui a antiga
      renotify: true,
      silent: !somWindows 
    });
    n.onclick = () => {
      window.focus();
      if (typeof switchTab === 'function') switchTab('ativos');
    };
  } 
}

let timeoutPusher = null;
let pusherInstancia = null;
let pedidoAtualizadoId = null;

async function configurarPusher() {
  if (pusherInstancia) return;

  try {
    const configRes = await fetch('/api/pusher-config');
    const pusherConfig = await configRes.json();

    console.log('📡 Inicializando Pusher no Admin...', pusherConfig.key);
    pusherInstancia = new Pusher(pusherConfig.key, {
      cluster: pusherConfig.cluster,
      forceTLS: true,
      enabledTransports: ['ws', 'wss', 'xhr_streaming', 'xhr_polling'],
      disableStats: true
    });

    pusherInstancia.connection.bind('connected', () => {
      console.log('✅ Admin conectado ao Pusher com sucesso!');
      const statusLed = document.getElementById('pusher-status');
      if (statusLed) {
        statusLed.style.background = '#2ecc71';
        statusLed.style.boxShadow = '0 0 8px rgba(46, 204, 113, 0.6)';
        statusLed.title = 'Conectado em tempo real';
      }
      mostrarToast("Sincronização em tempo real ativa.", "success", "Rede Conectada", 3000);
    });

    pusherInstancia.connection.bind('disconnected', () => {
      console.warn('⚠️ Admin desconectado do Pusher');
      const statusLed = document.getElementById('pusher-status');
      if (statusLed) {
        statusLed.style.background = '#ff4444';
        statusLed.style.boxShadow = '0 0 5px rgba(255, 0, 0, 0.5)';
        statusLed.title = 'Desconectado';
      }
      mostrarToast("A conexão com o servidor foi interrompida.", "error", "Sem Conexão");
    });

    pusherInstancia.connection.bind('error', function(err) {
      console.warn('❌ Erro de conexão no Pusher (Admin):', err);
      const statusLed = document.getElementById('pusher-status');
      if (statusLed) {
        statusLed.style.background = '#f1c40f';
        statusLed.style.boxShadow = '0 0 5px rgba(241, 196, 15, 0.5)';
        statusLed.title = 'Erro de Conexão';
      }
      mostrarToast("Houve um erro na comunicação com o servidor.", "warning", "Erro de Rede");
    });

    const channel = pusherInstancia.subscribe('garconnexpress');
    console.log('📺 Admin inscrito no canal: garconnexpress');

    // EVENTO: CHAMADO DE CLIENTE (🛎️) - PRIORIDADE
    channel.bind('chamado-garcom', (data) => {
      console.log('📢 Admin: Chamado de cliente recebido!', data);
      tocarNotificacao('campainha');
      iniciarPiscarTitulo();

      const mesaNum = data.mesa_numero || 'X';
      const msg = data.mensagem || `A Mesa ${mesaNum} está solicitando atendimento agora!`;
      
      exibirNotificacaoNativa('🛎️ CHAMADO DE CLIENTE', msg, `chamado-${data.mesa_id}`);
      mostrarToast(`🛎️ CHAMADO: Mesa ${mesaNum}`, 'erro'); // Usa cor de destaque
      
      mostrarAlerta(msg, "🛎️ CHAMADO DE CLIENTE", "🛎️");
    });

    // EVENTO: SOLICITAÇÃO DE FECHAMENTO PELO CLIENTE (💰)
    channel.bind('solicitacao-fechamento-cliente', (data) => {
      console.log('📢 Admin: Solicitação de fechamento recebida!', data);
      tocarNotificacao('campainha');
      iniciarPiscarTitulo();

      const mesaNum = data.mesa_numero || 'X';
      const msg = data.mensagem || `💰 MESA ${mesaNum} solicitou o fechamento da conta!`;
      
      exibirNotificacaoNativa('💰 SOLICITAÇÃO DE CONTA', msg, `fechamento-${data.mesa_id}`);
      mostrarToast(`💰 CONTA: Mesa ${mesaNum}`, 'sucesso');
      
      mostrarAlerta(msg, "💰 FECHAMENTO DE CONTA", "💰");
      
      clearTimeout(timeoutPusher);
      timeoutPusher = setTimeout(() => {
        carregarPedidos();
        carregarHistorico();
      }, 100);
    });

    // EVENTO: NOVO PEDIDO
    channel.bind('novo-pedido', (data) => {
      console.log('📢 Admin: Novo pedido recebido!', data);
      tocarNotificacao(); 
      iniciarPiscarTitulo();

      const p = data.pedido;
      const isDelivery = (p && p.garcom_id === 'DELIVERY');
      let nomeExibicao = 'X';
      
      if (p) {
        if (isDelivery) nomeExibicao = `DELIVERY #${p.id}`;
        else if (p.mesa_numero) nomeExibicao = `Mesa ${p.mesa_numero}`;
        else nomeExibicao = 'Balcão';
      }

      const mesaId = p ? p.mesa_id : 'geral';

      exibirNotificacaoNativa('🚀 NOVO PEDIDO', `${nomeExibicao} acabou de fazer um pedido.`, `mesa-${mesaId}`);
      mostrarToast(`🚀 NOVO PEDIDO: ${nomeExibicao}`);

      clearTimeout(timeoutPusher);
      timeoutPusher = setTimeout(() => {
        carregarPedidos();
        carregarHistorico();
      }, 100);
    });

    // EVENTO: PEDIDO PRONTO (COZINHA)
    channel.bind('pedido-pronto', (data) => {
      console.log('📢 Admin: Pedido pronto!', data);
      tocarNotificacao(); 
      iniciarPiscarTitulo();

      const mesa = data.mesa_numero || 'X';
      const labelMesa = mesa.includes('DELIVERY') ? mesa : `Mesa ${mesa}`;
      const msgSimples = `${labelMesa} está pronto!`;

      exibirNotificacaoNativa('🍳 PEDIDO PRONTO', msgSimples, `mesa-${data.mesa_id}`);
      mostrarToast(`🍳 PRONTO: ${labelMesa}`);
      mostrarAlerta(msgSimples, "🍳 Cozinha", "🍳");

      clearTimeout(timeoutPusher);
      timeoutPusher = setTimeout(() => {
        carregarPedidos();
        carregarHistorico();
      }, 100);
      });

      // EVENTO: MENU ATUALIZADO (SINCRONIZAÇÃO DE ESTOQUE)
      channel.bind('menu-atualizado', () => {
        console.log('🔄 Admin: Estoque atualizado via Pusher!');

        // Adiciona um pequeno delay para garantir que o banco terminou a gravação
        setTimeout(async () => {
          // Recarrega a variável global cardapio forçando bypass de qualquer cache
          try {
            const res = await fetch('/api/menu?admin=true&t=' + Date.now());
            if (res.ok) {
              cardapio = await res.json();

              // Se estiver na aba de configurações, redesenha a lista
              if (abaAtiva === 'configuracoes') {
                  exibirMenuConfig();
              }
              // Se estiver na aba de lançamento, redesenha os itens
              if (abaAtiva === 'lancar') {
                  const catAtiva = document.querySelector('#lancar-menu-categorias .cat-mini.ativa');
                  const catNome = catAtiva ? catAtiva.id.replace('cat-lancar-', '') : 'todas';
                  exibirMenuLancar(catNome);
              }
            }
          } catch (err) {
            console.error('Erro ao atualizar menu via Pusher:', err);
          }
        }, 300);
      });

      // EVENTO: STATUS ATUALIZADO (Mesa/Pedido)
    channel.bind('status-atualizado', (data) => {
      console.log('📢 Admin: Status atualizado recebido!', data);
      if (!data) return;

      let nMesa = '';
      if (data.garcom_id === 'DELIVERY') {
        nMesa = `DELIVERY #${data.pedido_id || data.mesa_id}`;
      } else {
        const mesaData = data.mesa_numero || data.mesa_id || 'X';
        nMesa = isNaN(mesaData) ? mesaData : `Mesa ${mesaData}`;
      }
      
      const tagMesa = `mesa-${data.mesa_id}`;

      if (data.status === 'liberada') {
        tocarNotificacao();
        exibirNotificacaoNativa('✅ Mesa Liberada', `${nMesa} está livre para o próximo cliente.`, tagMesa);
        mostrarToast(`✅ ${nMesa} liberada`);
      } 
      else if (data.status === 'itens_adicionados') {
        tocarNotificacao();
        exibirNotificacaoNativa('📝 Novos itens!', `${nMesa} adicionou novos produtos ao pedido.`, tagMesa);
        mostrarToast(`📝 ${nMesa} adicionou itens`);
        pedidoAtualizadoId = data.pedido_id;
      }
      else if (data.status === 'aguardando_fechamento') {
        tocarNotificacao();
        exibirNotificacaoNativa('🛎️ Fechamento', `${nMesa} está aguardando fechamento.`, tagMesa);
        mostrarToast(`🛎️ Fechamento: ${nMesa}`);
      }
      else if (data.status === 'cancelado') {
        tocarNotificacao();
        exibirNotificacaoNativa('❌ Cancelado', `${nMesa}: Pedido cancelado.`, tagMesa);
        mostrarToast(`❌ ${nMesa} cancelado`);
      }
      else if (data.status === 'servido' && data.garcom_id === 'DELIVERY') {
        tocarNotificacao();
        exibirNotificacaoNativa('🛵 Saiu para Entrega', `${nMesa} está a caminho do cliente!`, tagMesa);
        mostrarToast(`🛵 A Caminho: ${nMesa}`);
      }
      else if (data.status === 'entregue' && data.garcom_id === 'DELIVERY') {
        tocarNotificacao();
        exibirNotificacaoNativa('✅ Concluído', `${nMesa} foi finalizado e concluído com sucesso.`, tagMesa);
        mostrarToast(`✅ Concluído: ${nMesa}`);
      }

      clearTimeout(timeoutPusher);
      timeoutPusher = setTimeout(() => {
        carregarPedidos();
        carregarHistorico();
      }, 100);
    });

    // EVENTO: CAIXA ATUALIZADO
    channel.bind('status-caixa-atualizado', (data) => {
      console.log('📢 Admin: Status do caixa atualizado', data);
      tocarNotificacao();
      carregarStatusCaixa();
      
      if (data.status === 'fechado') {
          mostrarToast('O caixa foi FECHADO com sucesso!', 'warning', '💰 CAIXA');
          adicionarNotificacao('💰 CAIXA FECHADO', 'O expediente foi encerrado com sucesso.', '💰');
      } else if (data.status === 'aberto') {
          mostrarToast('O caixa foi ABERTO! Bom trabalho.', 'success', '💰 CAIXA');
          adicionarNotificacao('💰 CAIXA ABERTO', 'O caixa está pronto para vendas.', '💰');
      }

      clearTimeout(timeoutPusher);
      timeoutPusher = setTimeout(() => {
        carregarPedidos();
        carregarHistorico();
      }, 100);
    });

    // EVENTO: STATUS DO DELIVERY
    channel.bind('delivery-status-atualizado', (data) => {
      console.log('📢 Status do Delivery atualizado:', data);
      const check = document.getElementById('check-delivery');
      if (check) {
        check.checked = data.delivery_aberto;
        atualizarIconeDelivery(data.delivery_aberto);
      }
    });

    channel.bind('estoque-baixo', (data) => {
      console.log('📢 Admin: Estoque baixo!', data);
      mostrarToast(data.mensagem, 'estoque');
      tocarNotificacao('windows');
      exibirNotificacaoNativa('⚠️ ESTOQUE BAIXO', data.mensagem, `estoque-${data.id}`);
    });

    // EVENTO: MENU ATUALIZADO
    channel.bind('menu-atualizado', (data) => {
      console.log('📢 Admin: Menu atualizado recebido!', data);
      carregarCardapio();
      // Recarrega pedidos também para garantir sincronia de estoque na tela
      clearTimeout(timeoutPusher);
      timeoutPusher = setTimeout(() => {
        carregarPedidos();
        carregarHistorico();
      }, 100);
    });

    // EVENTO: STATUS DO GARÇOM ALTERADO (RODÍZIO)
    channel.bind('garcom-status-alterado', (data) => {
      console.log('📢 Admin: Status de garçom alterado!', data);
      if (abaAtiva === 'configuracoes') {
        exibirGarconsConfig();
      }
    });

    } catch (e) {
    console.warn('❌ Erro na inicialização do Pusher:', e);
    }
    }function tocarNotificacao(tipo = 'ambos') {
  const somMP3 = localStorage.getItem('admin_som_mp3_ativo') !== 'false';
  const somWin = localStorage.getItem('admin_som_windows') === 'true';

  if (audioDesbloqueado && somMP3 && (tipo === 'ambos' || tipo === 'campainha')) {
    audioNotificacao.currentTime = 0;
    audioNotificacao.play().catch(e => {
        console.warn('Erro ao tocar som MP3 (tentando nova instância):', e);
        const fallbackAudio = new Audio('/notificacao.mp3');
        fallbackAudio.play().catch(err => console.error('Falha crítica de áudio:', err));
    });
  }

  if (somWin && (tipo === 'ambos' || tipo === 'windows')) {
      const winAudio = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');
      winAudio.play().catch(e => console.warn('Erro ao tocar som Windows:', e));
  }
}
function inicializarConfiguracaoSom() {
  atualizarIconesSom();
}

function atualizarIconesSom() {
  const checkMP3 = document.getElementById('check-som-mp3');
  const checkWin = document.getElementById('check-som-windows');
  const labelMP3 = document.getElementById('label-som-mp3');
  const labelWin = document.getElementById('label-som-win');
  
  const somMP3 = localStorage.getItem('admin_som_mp3_ativo') !== 'false';
  const somWin = localStorage.getItem('admin_som_windows') === 'true';

  if (checkMP3) checkMP3.checked = somMP3;
  if (checkWin) checkWin.checked = somWin;

  if (labelMP3) {
    labelMP3.innerText = somMP3 ? '🔔 CAMPANHA' : '🔕 MUDO';
    labelMP3.style.color = somMP3 ? '#fff' : '#bdc3c7';
  }
  if (labelWin) {
    labelWin.innerText = somWin ? '🔊 WIN' : '🔇 MUDO';
    labelWin.style.color = somWin ? '#fff' : '#bdc3c7';
  }

  // Sincroniza o mudo do objeto de áudio principal
  if (audioNotificacao) audioNotificacao.muted = !somMP3;
}

function alternarSomMP3() {
  const check = document.getElementById('check-som-mp3');
  const ativo = check ? check.checked : true;
  localStorage.setItem('admin_som_mp3_ativo', ativo);
  atualizarIconesSom();
  if (ativo) {
    tocarNotificacao('campainha'); // Som de teste
    mostrarToast("🔔 Som de Campainha ATIVADO");
  } else {
    mostrarToast("🔕 Som de Campainha DESATIVADO");
  }
}

function alternarSomWindows() {
  const check = document.getElementById('check-som-windows');
  const ativo = check ? check.checked : false;
  localStorage.setItem('admin_som_windows', ativo);
  atualizarIconesSom();
  if (ativo) {
    tocarNotificacao('windows'); // Som de teste
    exibirNotificacaoNativa("🔊 TESTE DE SOM", "O som do Windows está agora ativado para notificações.");
    mostrarToast("🔊 Som do Windows ATIVADO");
  } else {
    mostrarToast("🔇 Som do Windows DESATIVADO");
  }
}
/**
 * Exibe uma notificação elegante no canto da tela (Toast)
 * @param {string} msg - Mensagem da notificação
 * @param {string} tipo - 'success', 'error', 'warning', 'info'
 * @param {string} titulo - Título opcional
 * @param {number} duracao - Tempo em ms (padrão 5s)
 */
function mostrarToast(msg, tipo = 'success', titulo = '', duracao = 5000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const t = document.createElement('div');
  // Mapeamento de tipos antigos para os novos
  let classeTipo = tipo;
  if (tipo === 'sucesso') classeTipo = 'success';
  if (tipo === 'estoque') classeTipo = 'warning';

  t.className = `toast-notificacao ${classeTipo}`;

  const icones = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };

  const html = `
    <div class="toast-icon">${icones[classeTipo] || '🔔'}</div>
    <div class="toast-content">
      ${titulo ? `<strong class="toast-title">${titulo}</strong>` : ''}
      <span class="toast-msg">${msg}</span>
    </div>
    <button class="toast-close">&times;</button>
  `;

  t.innerHTML = html;
  container.appendChild(t);

  // Trigger animação de entrada
  setTimeout(() => t.classList.add('show'), 10);
  // Auto-close
  const autoClose = setTimeout(() => {
    fecharToast(t);
  }, duracao);

  // Botão fechar
  t.querySelector('.toast-close').onclick = () => {
    clearTimeout(autoClose);
    fecharToast(t);
  };
}

function fecharToast(el) {
  el.classList.remove('show');
  setTimeout(() => {
      if (el.parentNode) el.remove();
  }, 400);
}
// FUNÇÕES DE SISTEMA (SUBSTITUIÇÃO DE ALERT/CONFIRM)
function mostrarAlerta(msg, titulo = "Aviso", icone = "🔔") {
  return new Promise(resolve => {
    document.getElementById('modal-sistema-icon').innerText = icone;
    document.getElementById('modal-sistema-titulo').innerText = titulo;
    document.getElementById('modal-sistema-mensagem').innerHTML = msg;
    document.getElementById('btn-sistema-cancelar').classList.add('hidden');
    document.getElementById('btn-sistema-confirmar').innerText = "OK";
    document.getElementById('btn-sistema-confirmar').style.background = "#27ae60";

    const modal = document.getElementById('modal-sistema');
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');

    document.getElementById('btn-sistema-confirmar').onclick = () => {
      modal.style.display = 'none';
      if (abaAtiva !== 'lancar' && abaAtiva !== 'ativos') {
          document.body.classList.remove('modal-open');
      }
      resolve(true);
    };
    });
    }

    function mostrarConfirmacao(msg, titulo = "Confirmação", txtConfirmar = "Confirmar", txtCancelar = "Cancelar", icone = "❓") {

  return new Promise(resolve => {
    document.getElementById('modal-sistema-icon').innerText = icone;
    document.getElementById('modal-sistema-titulo').innerText = titulo;
    document.getElementById('modal-sistema-mensagem').innerHTML = msg;
    document.getElementById('btn-sistema-cancelar').classList.remove('hidden');
    document.getElementById('btn-sistema-cancelar').innerText = txtCancelar;
    document.getElementById('btn-sistema-confirmar').innerText = txtConfirmar;
    document.getElementById('btn-sistema-confirmar').style.background = "#e74c3c";

    const modal = document.getElementById('modal-sistema');
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');

    document.getElementById('btn-sistema-confirmar').onclick = () => {
      modal.style.display = 'none';
      if (abaAtiva !== 'lancar' && abaAtiva !== 'ativos') {
          document.body.classList.remove('modal-open');
      }
      resolve(true);
    };

    document.getElementById('btn-sistema-cancelar').onclick = () => {
      modal.style.display = 'none';
      if (abaAtiva !== 'lancar' && abaAtiva !== 'ativos') {
          document.body.classList.remove('modal-open');
      }
      resolve(false);
    };
  });
}
function formatarData(dataIso) {
  if (!dataIso) return '--/--/---- --:--';
  
  let d = dataIso;
  // Se for string no formato YYYY-MM-DD HH:MM:SS (padrão do backend)
  // Adicionamos 'Z' para que o navegador trate como UTC e converta para o fuso local
  if (typeof d === 'string' && d.includes('-') && d.includes(':') && !d.includes('Z') && !d.includes('+')) {
    d = d.replace(' ', 'T') + 'Z';
  }

  const data = new Date(d);
  if (isNaN(data.getTime())) return 'Data Inválida';

  return data.toLocaleString('pt-BR', { 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric',
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

function copiarPedido(btn, texto) {
  navigator.clipboard.writeText(texto).then(() => {
    const orig = btn.innerHTML; btn.innerHTML = "✅ Copiado!";
    setTimeout(() => btn.innerHTML = orig, 2000);
  });
}

async function reimprimirCupomById(id) {
  try {
    const res = await fetch(`/api/pedidos/${id}`);
    if (!res.ok) throw new Error("Erro ao buscar dados do pedido");
    const pedido = await res.json();
    
    const resItens = await fetch(`/api/pedidos/${id}/itens`);
    if (!resItens.ok) throw new Error("Erro ao buscar itens do pedido");
    const itens = await resItens.json();
    
    // Chama a função principal de impressão com o pedido e seus itens
    // Passamos como re-impressão (isFechamentoFinal=false para não calcular "pago agora" como saldo)
    await imprimirCupom({ ...pedido, isReimpressao: true }, itens);
  } catch (e) {
    console.error("Erro ao re-imprimir cupom:", e);
    mostrarAlerta("Não foi possível re-imprimir o cupom: " + e.message, "Erro", "❌");
  }
}

async function imprimirCupom(pedido, itens) {
  const container = document.getElementById('cupom-impressao');
  if (!container) return;
  aplicarConfiguracaoImpressao();

  // Busca histórico de pagamentos deste pedido no servidor
  let historicoPagos = [];
  try {
    const resPagos = await fetch(`/api/pedidos/${pedido.id}/pagamentos`);
    if (resPagos.ok) historicoPagos = await resPagos.json();
    console.log("📜 Histórico de Pagamentos (Banco):", historicoPagos);
    console.log("📑 Detalhes Imediatos (Memória):", pedido.pagamentos_detalhados_lista);
  } catch (e) { console.error("Erro ao buscar pagamentos:", e); }

  const subtotal = itens.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
  
  // Verifica se a taxa está ativa para este pedido (Prioridade para o que está no Banco)
  let cobrarTaxaNoCupom = true;
  
  if (pedido.cobrar_taxa !== undefined && pedido.cobrar_taxa !== null) {
    // No SQLite/Postgres vem 1 ou 0, no JS transformamos em boolean
    cobrarTaxaNoCupom = (pedido.cobrar_taxa == 1 || pedido.cobrar_taxa === true);
  } else if (pedidosStatusTaxa[pedido.id] !== undefined) {
    cobrarTaxaNoCupom = pedidosStatusTaxa[pedido.id];
  }

  const acrescimo = pedido.acrescimo || 0;
  const desconto = pedido.desconto || 0;
  const isDeliveryCupom = (pedido.garcom_id === 'DELIVERY');
  const taxa = cobrarTaxaNoCupom ? (isDeliveryCupom ? 3.00 : subtotal * 0.10) : 0;
  const pagoAnterior = pedido.pago_parcial || 0;
  
  const totalGeralMesa = subtotal + taxa + acrescimo - desconto;
  
  // Define o que será exibido como "PAGO AGORA"
  let pagoAgora = totalGeralMesa; // Padrão: pagamento total
  
  if (pedido.isFracaoPagamento) {
    pagoAgora = pedido.valor_por_pessoa || (totalGeralMesa / (pedido.num_pessoas || 1));
  } else if (pedido.isFechamentoFinal) {
    pagoAgora = totalGeralMesa - (pagoAnterior - (pedido.isFracaoPagamento ? 0 : 0)); // Ajuste se necessário
    // Se for fechamento final, o que está sendo pago agora é o total menos o que já foi pago anteriormente
    pagoAgora = totalGeralMesa - pagoAnterior;
  }

  const mesaNomeCupom = pedido.mesa_numero ? `MESA ${pedido.mesa_numero}` : `PEDIDO #${pedido.id}`;
  
  const numPessoasNoPedido = pedido.num_pessoas || 1;
  
  // Se for uma impressão imediata após pagar, o último item (ou itens) do histórico é o pagamento atual.
  // Se for uma RE-IMPRESSÃO do histórico, todos os itens já são pagamentos passados.
  const isImpressaoImediata = !!(pedido.isFracaoPagamento || pedido.isFechamentoFinal);
  const novosPagamentosCount = pedido.novosPagamentosCount || 1;
  
  const jaPagosAnteriormente = isImpressaoImediata 
    ? historicoPagos.slice(0, -novosPagamentosCount) 
    : historicoPagos;

  const isConferencia = !!(pedido.isImpressaoParcialItens || pedido.isImpressaoParcialMesa);

  // No fechamento total ou re-impressão, o total de pessoas é exatamente a quantidade de pagamentos.
  // No pagamento de fração (apenas 1 parte) ou Nota Parcial, o total é quem já pagou + quem falta.
  let numPessoasExibicao = (pedido.isFracaoPagamento) 
    ? (jaPagosAnteriormente.length + numPessoasNoPedido)
    : Math.max(numPessoasNoPedido, historicoPagos.length);

  // SE FOR CONFERÊNCIA: Se já houve pagamentos, garantimos que mostre pelo menos as partes pagas + 1 a pagar
  if (isConferencia && historicoPagos.length > 0 && numPessoasNoPedido <= 1) {
      numPessoasExibicao = historicoPagos.length + 1;
  }

  // Define se é re-impressão do histórico
  const isReimpressaoHistorico = (pedido.status === 'entregue' && !pedido.isFracaoPagamento);

  // Lógica para exibição da divisão no cupom
  let htmlDivisao = '';
  if (numPessoasExibicao > 1) {
      let linhasDivisao = '';

      // Se for Re-impressão, Fração, Fechamento Final OU Nota Parcial (Conferência)
      if (isReimpressaoHistorico || pedido.isFracaoPagamento || pedido.isFechamentoFinal || isConferencia) {
          const valorParte = totalGeralMesa / numPessoasExibicao;

          for (let i = 0; i < numPessoasExibicao; i++) {
              const numParte = i + 1;
              let status = '';
              let style = '';

              if (isReimpressaoHistorico) {
                  status = '(JÁ PAGO)';
                  style = 'opacity: 0.8;';
              } else if (pedido.isFracaoPagamento) {
                  const jaPago = i < jaPagosAnteriormente.length;
                  const sendoPaga = i === jaPagosAnteriormente.length;

                  if (jaPago) {
                      status = '(JÁ PAGO)';
                      style = 'opacity: 0.7;';
                  } else if (sendoPaga) {
                      status = '(PAGANDO AGORA)';
                      style = 'font-weight: bold; color: #27ae60;';
                  } else {
                      status = '(A PAGAR)';
                      style = 'opacity: 0.5;';
                  }
              } else if (pedido.isFechamentoFinal) {
                  const jaPago = i < jaPagosAnteriormente.length;
                  if (jaPago) {
                      status = '(JÁ PAGO)';
                      style = 'opacity: 0.7;';
                  } else {
                      status = '(PAGANDO AGORA)';
                      style = 'font-weight: bold; color: #27ae60;';
                  }
              } else if (isConferencia) {
                  // Na Nota Parcial (Conferência), mostramos apenas JÁ PAGO ou A PAGAR
                  const jaPago = i < historicoPagos.length;
                  if (jaPago) {
                      status = '(JÁ PAGO)';
                      style = 'opacity: 0.7;';
                  } else {
                      status = '(A PAGAR)';
                      style = 'opacity: 0.5;';
                  }
              }

              // LÓGICA DE BUSCA DE DADOS (CORRIGIDA)
              let formaExibicao = '';
              let valorRecebidoParte = 0;
              let trocoParte = 0;
              let valorRealDaParte = valorParte; // Fallback para a divisão simples

              // Se a parte i já foi paga anteriormente (está no início do histórico)
              if (i < jaPagosAnteriormente.length) {
                const h = jaPagosAnteriormente[i];
                formaExibicao = h.forma_pagamento;
                valorRecebidoParte = h.recebido || h.valor || 0;
                trocoParte = h.troco || 0;
                valorRealDaParte = h.valor || valorParte;
              } 
              // Se a parte i está sendo paga AGORA (está na lista detalhada atual)
              else {
                const indiceNoNovo = i - jaPagosAnteriormente.length;
                if (pedido.pagamentos_detalhados_lista && pedido.pagamentos_detalhados_lista[indiceNoNovo]) {
                  const d = pedido.pagamentos_detalhados_lista[indiceNoNovo];
                  formaExibicao = d.forma_pagamento;
                  valorRecebidoParte = d.recebido || 0;
                  trocoParte = d.troco || 0;
                  valorRealDaParte = d.valor || valorParte;
                } else if (historicoPagos && historicoPagos[i]) {
                  // Fallback para re-impressão total do histórico
                  const h = historicoPagos[i];
                  formaExibicao = h.forma_pagamento;
                  valorRecebidoParte = h.recebido || h.valor || 0;
                  trocoParte = h.troco || 0;
                  valorRealDaParte = h.valor || valorParte;
                }
              }
              
              let infoExtra = '';
              if (formaExibicao === 'Dinheiro') {
                  // Se os valores forem 0 mas for dinheiro, tentamos usar o valor da parte como recebido (fallback)
                  const exibRec = valorRecebidoParte > 0 ? valorRecebidoParte : valorRealDaParte;
                  const exibTrc = trocoParte;
                  
                  infoExtra = `
                    <div style="font-size: 8pt; margin-top: 2px; padding-left: 10px; opacity: 0.9;">
                      <div style="display:flex; justify-content:space-between;">
                        <span>VALOR RECEBIDO:</span>
                        <span>R$ ${exibRec.toFixed(2)}</span>
                      </div>
                      <div style="display:flex; justify-content:space-between; font-weight:bold;">
                        <span>TROCO:</span>
                        <span>R$ ${exibTrc.toFixed(2)}</span>
                      </div>
                    </div>
                  `;
              }

              linhasDivisao += `
                <div style="margin-bottom: 8px; ${style} border-bottom: 1px dotted #ccc; padding-bottom: 4px;">
                  <div style="display:flex; justify-content:space-between; font-weight:bold;">
                    <span>PARTE ${numParte} ${formaExibicao ? '(' + formaExibicao.toUpperCase() + ')' : ''} ${status}:</span>
                    <span>R$ ${valorRealDaParte.toFixed(2)}</span>
                  </div>
                  ${infoExtra}
                </div>
              `;
          }
      }

      if (linhasDivisao) {        htmlDivisao = `
          <div style="margin-top: 10px; border: 1px solid #000; padding: 5px; background: #fff; border-style: dashed;">
            <p style="margin: 0 0 5px 0; font-weight: bold; text-align: center; font-size: 10pt; border-bottom: 1px solid #000; padding-bottom: 3px;">
              DETALHAMENTO DA DIVISÃO
            </p>
            <div style="font-size: 9pt;">
              ${linhasDivisao}
            </div>
          </div>
        `;
    }
  }

  const isDelivery = (pedido.garcom_id === 'DELIVERY');
  const nomeExibicaoCupom = isDelivery ? `🛵 PEDIDO DELIVERY #${pedido.id}` : (pedido.mesa_numero ? `MESA ${pedido.mesa_numero}` : `PEDIDO #${pedido.id}`);

  let dadosDeliveryHtml = '';
  if (isDelivery && pedido.observacao) {
      // Converte as quebras de linha da observação para <br>
      const obsFormatada = pedido.observacao.replace(/\n/g, '<br>');
      dadosDeliveryHtml = `
        <div style="margin: 10px 0; padding: 10px; border: 1px solid #000; font-size: 9pt; text-align: left;">
            <strong style="display:block; text-align:center; border-bottom: 1px dashed #000; padding-bottom: 5px; margin-bottom: 5px;">DADOS DA ENTREGA</strong>
            ${obsFormatada}
        </div>
      `;
  }

  const html = `
    <div class="cupom-header" style="text-align: center; border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px;">
      <h2 style="margin:0; font-size: 14pt; font-weight: 900;">GuGA Bebidas</h2>
      <p style="margin:2px 0; font-size: 10pt; font-weight: 700;">
        ${pedido.status === 'cancelado' ? '*** PEDIDO CANCELADO ***' : (isConferencia ? '*** CONTA PARCIAL ***' : 'Comprovante de Pedido')}
      </p>
      <p style="margin:2px 0; font-weight: 900; font-size: 12pt;">${nomeExibicaoCupom}</p>
      <p style="margin:2px 0; font-size: 9pt;"><strong>ABERTURA:</strong> ${formatarData(pedido.created_at)}</p>
      <p style="margin:2px 0; font-size: 8pt;"><strong>EMISSÃO:</strong> ${new Date().toLocaleString('pt-BR')}</p>
      ${numPessoasExibicao > 1 && !isDelivery ? `<p style="margin:2px 0; font-size: 10pt; font-weight:bold;">DIVIDIDO POR: ${numPessoasExibicao} PESSOAS</p>` : ''}
    </div>

    ${dadosDeliveryHtml}
    
    <div style="font-size: 10pt; margin-bottom: 10px; ${pedido.status === 'cancelado' ? 'text-decoration: line-through; opacity: 0.7;' : ''}">
      ${itens.map(i => `
        <div style="display:flex; justify-content:space-between; margin-bottom: 2px;">
          <span style="flex:1;">${i.quantidade}x ${i.nome}</span>
          <span style="font-weight:bold;">R$ ${(i.preco * i.quantidade).toFixed(2)}</span>
        </div>
        ${i.observacao ? `<div style="font-size:9pt; margin-bottom:4px;">&nbsp;&nbsp;- ${i.observacao}</div>` : ''}
      `).join('')}
    </div>

    <div class="cupom-footer" style="font-size: 10pt; border-top: 1px dashed #000; padding-top: 5px;">
      <div style="display:flex; justify-content:space-between; opacity: 0.8; font-size: 9pt;">
        <span>SUBTOTAL CONSUMO:</span>
        <span>R$ ${subtotal.toFixed(2)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-weight: 900; font-size: 10pt; background: #f1f2f6; padding: 2px 4px; border-radius: 4px; margin: 2px 0;">
        <span>${isDeliveryCupom ? 'TAXA ENTREGA' : `TAXA SERV (${cobrarTaxaNoCupom ? '10%' : 'OFF'})`}:</span>
        <span>R$ ${taxa.toFixed(2)}</span>
      </div>
      ${acrescimo > 0 ? `<div style="display:flex; justify-content:space-between; opacity: 0.8; font-size: 9pt;"><span>ACRÉSCIMO:</span><span>R$ ${acrescimo.toFixed(2)}</span></div>` : ''}
      ${desconto > 0 ? `<div style="display:flex; justify-content:space-between; opacity: 0.8; font-size: 9pt;"><span>DESCONTO:</span><span>- R$ ${desconto.toFixed(2)}</span></div>` : ''}
      
      <div style="display:flex; justify-content:space-between; font-weight: bold; margin-top: 2px; border-top: 1px solid #eee; padding-top: 2px; font-size: 9pt; opacity: 0.9;">
        <span>${isReimpressaoHistorico ? 'VALOR TOTAL DA MESA:' : 'TOTAL DA CONTA:'}</span>
        <span>R$ ${totalGeralMesa.toFixed(2)}</span>
      </div>

      <div style="display:flex; justify-content:space-between; font-weight: 900; margin-top: 5px; font-size: 13pt; border-top: 2px solid #000; padding-top: 4px; background: #eee;">
        <span>${(isReimpressaoHistorico || pedido.isFechamentoFinal) ? 'TOTAL PAGO:' : 'TOTAL A PAGAR:'}</span>
        <span>R$ ${pagoAgora.toFixed(2)}</span>
      </div>

      <!-- Detalhes de Pagamento (Forma, Recebido, Troco) -->
      ${!isConferencia ? `
        <div style="margin-top: 5px; border-top: 1px dashed #000; padding-top: 5px; font-size: 9pt;">
          <div style="display:flex; justify-content:space-between;">
            <span>FORMA DE PAGAMENTO:</span>
            <span style="font-weight:bold;">${(pedido.pagamentos_detalhados_lista || (historicoPagos && historicoPagos.length > 1)) ? 'MÚLTIPLAS / DIVIDIDO' : (pedido.forma_pagamento || 'N/A')}</span>
          </div>
          ${(pedido.forma_pagamento === 'Dinheiro' && !pedido.pagamentos_detalhados_lista && (!historicoPagos || historicoPagos.length <= 1)) ? `
            <div style="display:flex; justify-content:space-between;">
              <span>VALOR RECEBIDO:</span>
              <span>R$ ${(pedido.valor_recebido || 0).toFixed(2)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-weight:bold;">
              <span>TROCO:</span>
              <span>R$ ${(pedido.troco || 0).toFixed(2)}</span>
            </div>
          ` : ''}
        </div>
      ` : ''}

      ${htmlDivisao}
    </div>

    <div class="cupom-central" style="text-align: center; margin-top: 15px;">
      <p style="margin: 5px 0; font-weight: bold;">OBRIGADO PELA PREFERÊNCIA!</p>
      <p style="margin: 2px 0; font-size: 8pt;">GuGA Bebidas - Sistema de Gestão</p>
    </div>
  `;

  container.innerHTML = html;
  setTimeout(() => { window.print(); }, 250);
}

// FUNÇÃO PARA IMPRIMIR RELATÓRIO DE CAIXA
async function imprimirRelatorioCaixa() {
  if (!caixaAtual) return await mostrarAlerta('Nenhum caixa aberto para imprimir.', "Aviso", "⚠️");

  const container = document.getElementById('cupom-impressao');
  if (!container) return;
  aplicarConfiguracaoImpressao();

  const totalEsperadoDinheiro = caixaAtual.valor_inicial + caixaAtual.total_dinheiro;
  const totalGeral = caixaAtual.total_vendas;

  // Busca dados dos garçons para calcular comissões no relatório parcial
  let garconsLista = [];
  try {
    const resG = await fetch('/api/garcons');
    if (resG.ok) garconsLista = await resG.json();
  } catch (err) { console.error(err); }

  // No relatório de caixa, buscamos os dados mais recentes do servidor para garantir precisão total
  let historicoAtualizado = [];
  const performanceGarcons = {}; // Declare o objeto aqui para evitar erro de referência
  try {
    const resH = await fetch('/api/pedidos/historico-detalhado');
    if (resH.ok) historicoAtualizado = await resH.json();
  } catch (err) { 
    console.error("Erro ao buscar histórico para relatório:", err);
    historicoAtualizado = historico; // Fallback para o estado local se a rede falhar
  }

  let totalTaxasRelatorio = 0;
  historicoAtualizado.forEach(p => {    if (p.status === 'entregue') {
      const valorTotalPedido = (p.total || 0) + (p.pago_parcial || 0);
      const garcomId = p.garcom_id || 'SISTEMA';
      const garcomNome = p.garcom_nome || p.garcom_id || 'Administrador';

      // Cálculo aproximado da taxa (10% se estiver ativa no pedido)
      if (p.cobrar_taxa) {
        // Se p.total já inclui a taxa, precisamos extraí-la ou basear no consumo
        // No sistema, p.total geralmente é o consumo + taxa.
        const consumoSemTaxa = valorTotalPedido / 1.1;
        totalTaxasRelatorio += (valorTotalPedido - consumoSemTaxa);
      }

      if (!performanceGarcons[garcomId]) {
        const infoG = (Array.isArray(garconsLista) ? garconsLista : []).find(g => g && g.usuario === garcomId) || { comissao: 0 };
        performanceGarcons[garcomId] = {
          nome: garcomNome,
          vendas: 0,
          atendimentos: 0,
          percComissao: infoG.comissao || 0,
          taxasGeradas: 0
        };
      }
      performanceGarcons[garcomId].vendas += valorTotalPedido;
      performanceGarcons[garcomId].atendimentos++;
      
      if (p.cobrar_taxa) {
        const consumoSemTaxa = valorTotalPedido / 1.1;
        performanceGarcons[garcomId].taxasGeradas += (valorTotalPedido - consumoSemTaxa);
      }
    }
  });

  const htmlPerformance = Object.values(performanceGarcons).map(g => {
    // Usamos o valor das taxas geradas (10%) como a comissão principal exibida no relatório
    return `
      <div style="border-bottom: 1px dotted #ccc; padding: 4px 0; font-size: 9pt;">
        <div style="display:flex; justify-content:space-between; font-weight: bold;">
          <span>👤 ${g.nome.toUpperCase()}</span>
          <span>${g.atendimentos} atend.</span>
        </div>
        <div style="display:flex; justify-content:space-between; opacity: 0.9;">
          <span>Vendas: R$ ${g.vendas.toFixed(2)}</span>
          <span style="font-weight: 900; color: #27ae60;">Comissão (10%): R$ ${g.taxasGeradas.toFixed(2)}</span>
        </div>
      </div>
    `;
  }).join('');

  const html = `
    <div style="width: 100%; font-size: 10pt; line-height: 1.3; color: #000; background: #fff; padding: 0; font-weight: 600;">
      <div style="text-align: center; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
        <h1 style="margin: 0; font-size: 12pt; font-weight: 900;">GuGA Bebidas</h1>
        <p style="margin: 2px 0; font-weight: bold;">*** RELATÓRIO DE CAIXA ***</p>
        <p style="margin: 2px 0;">${caixaAtual.status === 'aberto' ? 'MOVIMENTO PARCIAL' : 'FECHAMENTO DEFINITIVO'}</p>
      </div>
      
      <div style="margin-bottom: 10px; font-size: 10pt;">
        <p><strong>ABERTURA:</strong> ${formatarData(caixaAtual.data_abertura)}</p>
        ${caixaAtual.data_fechamento ? `<p><strong>FECHAMENTO:</strong> ${formatarData(caixaAtual.data_fechamento)}</p>` : ''}
        <p><strong>STATUS:</strong> ${caixaAtual.status.toUpperCase()}</p>
      </div>

      <div style="border-top: 1px solid #000; padding-top: 5px; margin-bottom: 10px;">
        <div style="display:flex; justify-content:space-between;">
          <span>VALOR INICIAL:</span>
          <span>R$ ${caixaAtual.valor_inicial.toFixed(2)}</span>
        </div>
      </div>

      <div style="margin-bottom: 10px;">
        <p style="font-weight: bold; border-bottom: 1px solid #000; margin-bottom: 5px;">VENDAS POR MÉTODOS:</p>
        <div style="display:flex; justify-content:space-between;">
          <span>💵 DINHEIRO:</span>
          <span>R$ ${caixaAtual.total_dinheiro.toFixed(2)}</span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span>📱 PIX:</span>
          <span>R$ ${caixaAtual.total_pix.toFixed(2)}</span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span>💳 CARTÃO:</span>
          <span>R$ ${caixaAtual.total_cartao.toFixed(2)}</span>
        </div>
      </div>

      <div style="border-top: 1px solid #000; padding-top: 5px; margin-bottom: 10px;">
        <p style="font-weight: bold; border-bottom: 1px solid #000; margin-bottom: 5px;">DESEMPENHO GARÇONS:</p>
        ${htmlPerformance || '<p style="text-align:center; opacity:0.5;">Sem vendas registradas.</p>'}
      </div>

      <div style="border-top: 1px dashed #000; padding-top: 8px; margin-top: 10px;">
        <div style="display:flex; justify-content:space-between; font-size: 0.9rem; opacity: 0.8; margin-bottom: 4px;">
          <span>TOTAL EM TAXAS (10%):</span>
          <span>R$ ${totalTaxasRelatorio.toFixed(2)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-weight: bold;">
          <span>TOTAL DE VENDAS:</span>
          <span>R$ ${totalGeral.toFixed(2)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size: 1.1rem; font-weight: bold; margin-top: 5px; background: #eee; padding: 2px;">
          <span>DINHEIRO EM CAIXA:</span>
          <span>R$ ${totalEsperadoDinheiro.toFixed(2)}</span>
        </div>
      </div>

      <div style="text-align: center; margin-top: 30px; border-top: 1px solid #000; padding-top: 10px;">
        <p style="margin-bottom: 40px;">__________________________</p>
        <p style="font-size: 8pt;">Assinatura do Responsável</p>
        <p style="margin-top: 15px; font-size: 7pt;">${new Date().toLocaleString('pt-BR')}</p>
      </div>
    </div>
  `;

  container.innerHTML = html;
  setTimeout(() => { window.print(); }, 250);
}

// --- LOGICA DO NOVO MODAL DE OPÇÕES DA MESA ---
let pedidoEmOpcoes = null;

async function confirmarCancelamentoDesdeOpcoes() {
    if (!pedidoEmOpcoes) return;

    if (await mostrarConfirmacao("⚠️ DESEJA REALMENTE CANCELAR TODO O PEDIDO?\n\nA mesa será liberada e o pedido irá para o histórico como CANCELADO.", "Atenção", "SIM, CANCELAR", "NÃO")) {
        try {
            const res = await fetch(`/api/pedidos/${pedidoEmOpcoes.id}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'cancelado' })
            });
            if (res.ok) {
                fecharModalOpcoes();
                carregarPedidos();
            } else {
                mostrarAlerta("Erro ao cancelar pedido.");
            }
        } catch (e) {
            mostrarAlerta("Erro de conexão ao cancelar.");
        }
    }
}

async function abrirModalOpcoes(pedidoId) {
  const pedido = pedidos.find(p => p.id == pedidoId);
  if (!pedido) return;
  
  pedidoEmOpcoes = pedido;
  const isDelivery = (pedido.garcom_id === 'DELIVERY');
  const mesaNome = isDelivery ? '🛵 DELIVERY #' + pedido.id : (pedido.mesa_numero ? 'Mesa ' + pedido.mesa_numero : 'Balcão');
  const mesaId = pedido.mesa_id;
  
  // 1. DADOS BÁSICOS E CORES
  const headerBg = document.getElementById('modal-opcoes-header-bg');
  const itens = await fetch(`/api/pedidos/${pedidoId}/itens`).then(res => res.json());
  const hasPend = itens.some(i => i.status === 'pendente' || i.status === 'pronto');
  const isAguardando = pedido.status === 'aguardando_fechamento';
  
  document.getElementById('modal-opcoes-titulo').innerText = mesaNome;
  document.getElementById('modal-opcoes-info').innerText = `Pedido #${pedido.id} | Garçom: ${pedido.garcom_id || 'Admin'}`;
  
  const lblTaxa = document.getElementById('modal-taxa-label-text');
  if (lblTaxa) lblTaxa.innerText = isDelivery ? 'R$ 3.00 ENTREGA' : '10% TAXA';

  // Exibir observação do pedido se existir
  const infoExtra = document.getElementById('modal-opcoes-info-extra');
  if (infoExtra) {
    infoExtra.innerHTML = (pedido.observacao ? `<div style="background:#fff3cd; color:#856404; padding:8px 12px; border-radius:8px; margin-top:10px; font-weight:bold; font-size:0.9rem; border:1px solid #ffeeba;">📝 OBS: ${pedido.observacao}</div>` : '');
  }
  
  // Cores dinâmicas conforme status
  if (isAguardando) headerBg.style.background = '#f1c40f'; // Amarelo Atenção
  else if (hasPend) headerBg.style.background = '#e74c3c'; // Vermelho Pendente
  else headerBg.style.background = '#27ae60'; // Verde Servido

  // 2. TOTAIS E TAXA
  const cobrarTaxaNoPedido = (pedidosStatusTaxa[pedidoId] !== undefined) ? pedidosStatusTaxa[pedidoId] : (pedido.cobrar_taxa || true);
  const subtotal = itens.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
  const taxaServico = cobrarTaxaNoPedido ? (isDelivery ? 3.00 : (subtotal * 0.10)) : 0;
  const pagoParcial = pedido.pago_parcial || 0;
  const isAguardandoReal = isAguardando && !isDelivery;
  const totalExibicao = (isAguardandoReal ? pedido.total : (subtotal + taxaServico - pagoParcial)) || 0;

  // DETALHES DA SOLICITAÇÃO DE CONTA / DELIVERY
  let htmlPagamentoModal = '';
  if (pedido.forma_pagamento) {
    const tituloLabel = isDelivery ? 'PAGAMENTO DELIVERY' : 'SOLICITAÇÃO DE CONTA';
    htmlPagamentoModal = `
      <div style="background:#fff9db; padding:12px; border-radius:10px; margin-top:10px; font-size:0.9rem; border:2px solid #d4af37; color:#854d0e;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
           <strong>💰 ${tituloLabel}</strong>
           <span style="background:#d4af37; color:white; padding:2px 8px; border-radius:5px; font-size:0.7rem; font-weight:900;">${pedido.forma_pagamento.toUpperCase()}</span>
        </div>
        ${(pedido.forma_pagamento === 'Dinheiro') ? `<div><strong>Recebido:</strong> R$ ${(pedido.valor_recebido || 0).toFixed(2)} | <strong>Troco:</strong> R$ ${(pedido.troco || 0).toFixed(2)}</div>` : ''}
        ${(pedido.desconto > 0) ? `<div style="color:#e74c3c;"><strong>Desconto:</strong> - R$ ${pedido.desconto.toFixed(2)}</div>` : ''}
        ${(pedido.acrescimo > 0) ? `<div style="color:#27ae60;"><strong>Acréscimo:</strong> + R$ ${pedido.acrescimo.toFixed(2)}</div>` : ''}
      </div>
    `;
  }

  document.getElementById('modal-opcoes-valores').innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
      <div>
        <div style="font-size: 1.6rem; font-weight: 900; color: #166534;">R$ ${totalExibicao.toFixed(2)}</div>
        <div style="font-size: 0.75rem; color: #64748b; font-weight: bold;">SUB: R$ ${subtotal.toFixed(2)} | TAXA: R$ ${taxaServico.toFixed(2)}</div>
      </div>
    </div>
    ${htmlPagamentoModal}
  `;

  // 3. CONFIGURAÇÃO DOS BOTÕES LATERAIS (IMPRIMIR, EDITAR, TAXA)
  document.getElementById('btn-modal-imprimir').onclick = () => { fecharModalOpcoes(); imprimirParcialMesaRapido(pedidoId); };
  document.getElementById('btn-modal-editar').onclick = () => { fecharModalOpcoes(); abrirModalEdicao(pedido, itens); };
  
  const checkboxTaxa = document.getElementById('modal-taxa-checkbox');
  checkboxTaxa.checked = cobrarTaxaNoPedido;
  checkboxTaxa.onchange = (e) => {
     alternarTaxaPedido(pedidoId, e.target);
     // Recarrega o modal para atualizar valores
     setTimeout(() => abrirModalOpcoes(pedidoId), 300);
  };

  // 4. LISTA DE ITENS
  const itensPendentes = itens.filter(i => i.status === 'pendente' || i.status === 'pronto');
  const itensEntregues = itens.filter(i => i.status === 'entregue');
  
  let htmlItens = '';
  if (itensPendentes.length > 0) {
    htmlItens += `<small style="color: #e74c3c; font-weight: 900; display:block; margin-bottom:5px;">⏳ PENDENTES:</small>`;
    itensPendentes.forEach(i => {
      const isPronto = i.status === 'pronto';
      const isCozinha = isItemParaCozinha(i);
      htmlItens += `
        <div style="border-left:4px solid ${isPronto ? '#2ecc71' : '#e74c3c'}; background:white; border-radius:8px; padding:8px 12px; margin-bottom:6px; border:1px solid ${isPronto ? '#d4edda' : '#fee2e2'}; display:flex; align-items:center; gap: 10px;">
          <img src="${i.imagem || 'https://placehold.co/50'}" style="width: 45px; height: 45px; border-radius: 8px; object-fit: cover; flex-shrink: 0; border: 1px solid #eee;">
          <div style="flex: 1;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <span style="font-weight: 700; font-size: 0.9rem;">${i.quantidade}x ${i.nome}</span>
              <span style="font-size: 0.8rem; font-weight: 900; color: ${isPronto ? '#27ae60' : '#e74c3c'};">R$ ${(i.preco * i.quantidade * (cobrarTaxaNoPedido ? 1.1 : 1)).toFixed(2)}</span>
            </div>
            <div style="display: flex; gap: 5px; align-items: center; margin-top: 2px;">
              ${isPronto ? '<small style="background: #dcfce7; color: #166534; padding: 1px 6px; border-radius: 4px; font-weight: 900; font-size: 0.65rem;">🔥 PRONTO</small>' : ''}
              ${isCozinha ? '<small style="background: #fee2e2; color: #e74c3c; padding: 1px 6px; border-radius: 4px; font-weight: 900; font-size: 0.65rem;">🍳 COZINHA</small>' : ''}
            </div>
            ${i.observacao ? `<small style="color:#d35400; font-weight:bold; font-size:0.75rem; display:block; margin-top: 2px;">📝 ${i.observacao}</small>` : ''}
          </div>
        </div>
      `;
    });
  }
  if (itensEntregues.length > 0) {
    let tituloEntregues = '✅ NA MESA:';
    if (isDelivery) {
        tituloEntregues = isAguardando ? '✅ ENTREGUE:' : '🛵 A CAMINHO:';
    }
    
    htmlItens += `<small style="color: #27ae60; font-weight: 900; display:block; margin: 10px 0 5px 0;">${tituloEntregues}</small>`;
    itensEntregues.forEach(i => {
      htmlItens += `
        <div style="border-left:4px solid #27ae60; background:white; border-radius:8px; padding:8px 12px; margin-bottom:6px; border:1px solid #dcfce7; display:flex; align-items:center; gap: 10px; opacity: 0.85;">
          <img src="${i.imagem || 'https://placehold.co/50'}" style="width: 40px; height: 40px; border-radius: 6px; object-fit: cover; flex-shrink: 0; border: 1px solid #eee; filter: grayscale(0.5);">
          <div style="flex: 1;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <span style="font-size: 0.85rem; font-weight: 600;">${i.quantidade}x ${i.nome}</span>
              <span style="font-size: 0.75rem; font-weight: bold; color: #27ae60;">R$ ${(i.preco * i.quantidade * (cobrarTaxaNoPedido ? 1.1 : 1)).toFixed(2)}</span>
            </div>
            ${i.observacao ? `<small style="color:#d35400; font-weight:bold; font-size:0.7rem; display:block;">📝 ${i.observacao}</small>` : ''}
          </div>
        </div>
      `;
    });
  }
  document.getElementById('modal-opcoes-itens-lista').innerHTML = htmlItens || '<p style="text-align:center; opacity:0.5;">Nenhum item.</p>';

  // 5. FOOTER DE AÇÕES (ENTREGAR / LIBERAR / FECHAR)
  let htmlFooter = '';
  if (isAguardando) {
    htmlFooter = `
      <button onclick="fecharModalOpcoes(); aprovarFechamento(${pedidoId}, ${mesaId})" style="background:#27ae60; color:white; border:none; padding: 1.2rem; width: 100%; border-radius:12px; font-weight: 900; font-size: 1.1rem; box-shadow:0 5px 0 #219150; cursor:pointer;">
        ${isDelivery ? '💰 LIBERA DELIVERY' : '💰 CONFIRMAR PAGAMENTO E LIBERAR'}
      </button>
    `;
  } else {
    if (hasPend) {
      // Se ainda houver itens pendentes, mostra APENAS a opção de Entregar Tudo (conforme solicitado pelo usuário)
      htmlFooter = `
        <button onclick="fecharModalOpcoes(); marcarPedidoEntregue(${pedidoId})" style="background:#e67e22; color:white; border:none; padding: 1.2rem; width: 100%; font-weight: 900; border-radius:12px; font-size: 1.1rem; box-shadow:0 5px 0 #d35400; cursor:pointer;">
          ${isDelivery ? '🛵 ENVIAR PARA ENTREGA' : '🚚 ENTREGAR TUDO AGORA'}
        </button>
      `;
    } else {
      if (isDelivery) {
        htmlFooter = `
          <button onclick="fecharModalOpcoes(); confirmarEntregaDelivery(${pedidoId})" style="background:#3498db; color:white; border:none; padding: 1.2rem; width: 100%; border-radius:12px; font-weight: 900; font-size: 1.1rem; box-shadow:0 5px 0 #2980b9; cursor:pointer;">
            ✅ CONFIRMAR ENTREGA
          </button>
        `;
      } else {
        // Se tudo já foi entregue, mostra apenas o botão de Liberar Mesa em destaque (Verde)
        htmlFooter = `
          <button onclick="fecharModalOpcoes(); aprovarFechamento(${pedidoId}, ${mesaId})" style="background:#27ae60; color:white; border:none; padding: 1.2rem; width: 100%; border-radius:12px; font-weight: 900; font-size: 1.1rem; box-shadow:0 5px 0 #219150; cursor:pointer;">
            🔓 LIBERAR MESA
          </button>
        `;
      }
    }
  }
  document.getElementById('modal-opcoes-footer-acoes').innerHTML = htmlFooter;

  document.getElementById('modal-opcoes-mesa').style.display = 'flex';
  document.body.classList.add('modal-open');
}

function fecharModalOpcoes() {
  document.getElementById('modal-opcoes-mesa').style.display = 'none';
  pedidoEmOpcoes = null;
  if (abaAtiva !== 'lancar' && abaAtiva !== 'ativos') {
      document.body.classList.remove('modal-open');
  }
}

async function acaoOpcoesMesa(acao) {
  // Mantido para compatibilidade se houver algum listener direto, mas o abrirModalOpcoes agora é autossuficiente
  fecharModalOpcoes();
}

// Escuta mensagens do iframe do WhatsApp para atualizar o contador de não lidas e notificações
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'whatsapp_unread') {
        console.log('📥 Mensagem recebida do WhatsApp Bot (Contagem):', event.data);
        const count = parseInt(event.data.count) || 0;
        
        if (abaAtiva === 'whatsapp') {
            mensagensNaoLidasWhatsapp = count;
        } else {
            mensagensNaoLidasWhatsapp = Math.max(mensagensNaoLidasWhatsapp, count);
        }

        const badge = document.getElementById('badge-whatsapp-contador');
        const icon = document.getElementById('whatsapp-tab-icon');
        
        if (badge) {
            badge.innerText = mensagensNaoLidasWhatsapp;
            if (mensagensNaoLidasWhatsapp > 0) {
                badge.classList.remove('hidden');
                if (icon) icon.classList.add('hidden');
            } else {
                badge.classList.add('hidden');
                if (icon) icon.classList.remove('hidden');
            }
        }
    }

    if (event.data && event.data.type === 'whatsapp_new_activity') {
        console.log('📥 Nova atividade no WhatsApp Bot:', event.data);
        // Toca o som de notificação se não for mensagem enviada por nós
        if (typeof audioNotificacao !== 'undefined' && audioNotificacao) {
            audioNotificacao.play().catch(e => console.log('Erro ao tocar som:', e));
        }
        
        // Se a aba do WhatsApp não estiver ativa, incrementa o contador visual
        if (abaAtiva !== 'whatsapp') {
            mensagensNaoLidasWhatsapp++;
            
            const badge = document.getElementById('badge-whatsapp-contador');
            const icon = document.getElementById('whatsapp-tab-icon');
            if (badge) {
                badge.innerText = mensagensNaoLidasWhatsapp;
                badge.classList.remove('hidden');
                if (icon) icon.classList.add('hidden');
            }
        }
    }

    if (event.data && event.data.type === 'open_image_fullscreen') {
        console.log('🖼️ Solicitada visualização em tela cheia:', event.data.url);
        abrirVisualizadorGlobal(event.data.url);
    }
});

// Funções do Visualizador de Imagem Global
function abrirVisualizadorGlobal(url) {
    const viewer = document.getElementById('global-image-viewer');
    const target = document.getElementById('global-image-target');
    if (viewer && target) {
        target.src = url;
        viewer.style.display = 'flex';
        document.body.classList.add('modal-open');
    }
}

// Função para o Dropdown de Acessos Rápidos
function toggleDropdownAcessos() {
    const dropdown = document.getElementById('dropdown-acessos');
    if (dropdown) {
        dropdown.classList.toggle('show');
    }
}

// Fechar dropdown ao clicar fora
window.addEventListener('click', function(event) {
    if (!event.target.closest('.dropdown-menu-header')) {
        const dropdowns = document.getElementsByClassName("dropdown-content-header");
        for (let i = 0; i < dropdowns.length; i++) {
            const openDropdown = dropdowns[i];
            if (openDropdown.classList.contains('show')) {
                openDropdown.classList.remove('show');
            }
        }
    }
});

function fecharVisualizadorGlobal() {
    const viewer = document.getElementById('global-image-viewer');
    const target = document.getElementById('global-image-target');
    if (viewer && target) {
        viewer.style.display = 'none';
        target.src = '';
        if (abaAtiva !== 'lancar' && abaAtiva !== 'ativos' && abaAtiva !== 'whatsapp') {
            document.body.classList.remove('modal-open');
        }
    }
}

// Controle Independente do Delivery
async function carregarStatusDelivery() {
  try {
    const res = await fetch('/api/configs/delivery-status');
    const data = await res.json();
    const check = document.getElementById('check-delivery');
    if (check) {
      check.checked = data.delivery_aberto;
      atualizarIconeDelivery(data.delivery_aberto);
    }
  } catch (e) {
    console.error('Erro ao carregar status delivery:', e);
  }
}

async function alternarDelivery() {
  const check = document.getElementById('check-delivery');
  if (!check) return;
  const enabled = check.checked;
  
  try {
    const res = await fetch('/api/configs/delivery-toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    const data = await res.json();
    if (data.success) {
      atualizarIconeDelivery(enabled);
      mostrarToast(enabled ? "🛵 Delivery ATIVADO" : "🛑 Delivery DESATIVADO", enabled ? 'sucesso' : 'alerta');
    } else {
      check.checked = !enabled;
    }
  } catch (e) {
    console.error('Erro ao alternar delivery:', e);
    check.checked = !enabled;
  }
}

function atualizarIconeDelivery(enabled) {
  const label = document.getElementById('label-delivery');
  if (label) {
    label.style.color = enabled ? '#2ecc71' : '#e74c3c';
  }
}

// --- CENTRAL DE NOTIFICAÇÕES (NOTIFICAÇÃO GERAL NO CABEÇALHO) ---
let notificacoesGerais = [];

function toggleDropdownNotificacoes() {
  const dropdown = document.getElementById('dropdown-notificacoes');
  if (!dropdown) return;
  const isVisible = dropdown.style.display === 'flex';
  
  // Fecha o dropdown de acessos se estiver aberto
  const acessos = document.getElementById('dropdown-acessos');
  if (acessos) acessos.classList.remove('show');

  if (isVisible) {
    dropdown.style.display = 'none';
  } else {
    dropdown.style.display = 'flex';
    // Ao abrir, marcamos as visíveis como lidas
    notificacoesGerais.forEach(n => n.lida = true);
    atualizarBadgeNotificacoes();
    salvarNotificacoes();
    renderizarNotificacoes();
  }
}

function adicionarNotificacao(titulo, descricao, icone = '🔔') {
  const nova = {
    id: Date.now() + Math.random(),
    titulo,
    descricao,
    icone,
    data: new Date().toISOString(),
    lida: false
  };

  notificacoesGerais.unshift(nova);
  // Limite de 40 notificações para não pesar o storage
  if (notificacoesGerais.length > 40) notificacoesGerais.pop();

  salvarNotificacoes();
  renderizarNotificacoes();
  atualizarBadgeNotificacoes();
}

function renderizarNotificacoes() {
  const lista = document.getElementById('notificacoes-lista');
  if (!lista) return;

  if (notificacoesGerais.length === 0) {
    lista.innerHTML = `
      <div style="padding: 40px 20px; text-align: center; color: #94a3b8; font-size: 0.85rem;">
        <i class="fa-solid fa-circle-check" style="display: block; font-size: 2.5rem; margin-bottom: 12px; opacity: 0.2;"></i>
        Tudo em dia por aqui!
      </div>`;
    return;
  }

  lista.innerHTML = notificacoesGerais.map(n => {
    const dataObj = new Date(n.data);
    const hora = dataObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    
    return `
      <div class="notificacao-item ${n.lida ? '' : 'nao-lida'}" onclick="marcarNotificacaoComoLida(${n.id})">
        <div class="notificacao-icon">${n.icone}</div>
        <div class="notificacao-content">
          <strong class="notificacao-title">${n.titulo}</strong>
          <div class="notificacao-desc">${n.descricao}</div>
          <span class="notificacao-time">🕒 ${hora}</span>
        </div>
      </div>
    `;
  }).join('');
}

function atualizarBadgeNotificacoes() {
  const badge = document.getElementById('notificacoes-badge');
  if (!badge) return;

  const naoLidas = notificacoesGerais.filter(n => !n.lida).length;
  if (naoLidas > 0) {
    badge.innerText = naoLidas;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function limparNotificacoes() {
  notificacoesGerais = [];
  salvarNotificacoes();
  renderizarNotificacoes();
  atualizarBadgeNotificacoes();
}

function marcarNotificacaoComoLida(id) {
  const n = notificacoesGerais.find(item => item.id === id);
  if (n) n.lida = true;
  salvarNotificacoes();
  renderizarNotificacoes();
  atualizarBadgeNotificacoes();
}

function salvarNotificacoes() {
  localStorage.setItem('admin_notificacoes_v1', JSON.stringify(notificacoesGerais));
}

function carregarNotificacoes() {
  try {
    const salvas = localStorage.getItem('admin_notificacoes_v1');
    if (salvas) {
      notificacoesGerais = JSON.parse(salvas);
      renderizarNotificacoes();
      atualizarBadgeNotificacoes();
    }
  } catch(e) { console.error('Erro ao carregar notificações:', e); }
}

// Fecha dropdown ao clicar fora
document.addEventListener('click', (e) => {
  const container = document.getElementById('notificacoes-container');
  const dropdown = document.getElementById('dropdown-notificacoes');
  if (container && !container.contains(e.target) && dropdown) {
    dropdown.style.display = 'none';
  }
});
