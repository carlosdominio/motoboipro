window.onerror = function(msg, url, line) {
    if (msg && typeof msg === 'string' && (msg.includes('WebSocket') || msg.includes('CLOSING') || msg.includes('CLOSED'))) {
      return true; // Suprime o erro
    }
    console.error("ERRO GLOBAL:", msg, "em", url, "linha:", line);
  };

  // Suprimir avisos e erros específicos do WebSocket no console vindos do iframe
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
let mesaAtual = null;
let pedidoEmEdicao = null;
let itensEmEdicao = [];
let abaAtiva = 'ativos';
let subAbaAtiva = 'garcom';
let adminLogado = null;
let configCozinhaCategorias = []; // Estado global das categorias da cozinha

// Busca as categorias configuradas para a cozinha e salva no estado global
async function carregarConfigCategoriasCozinha() {
  try {
    const resConfig = await fetch('/api/config/categorias-cozinha');
    if (resConfig.ok) {
      const configuradas = await resConfig.json();
      configCozinhaCategorias = (configuradas || []).map(c => String(c).trim().toUpperCase());
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
    activeBtn.style.background = sub === 'garcom' ? '#3498db' : '#27ae60';
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
document.addEventListener('click', () => {
  if (audioDesbloqueado) return;
  audioDesbloqueado = true;
  
  audioNotificacao.muted = true;
  audioNotificacao.play().then(() => {
    audioNotificacao.pause();
    audioNotificacao.currentTime = 0;
    // Só desmuda se o som estiver ativo globalmente no Admin
    const somMP3 = localStorage.getItem('admin_som_mp3_ativo') !== 'false';
    if (somMP3) {
      audioNotificacao.muted = false;
    }
    console.log('🔊 Áudio preparado!');
  }).catch(e => console.log('Erro ao preparar áudio:', e));
}, { once: true });
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
  } else await mostrarAlerta("Credenciais inválidas", "Erro de Login");
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
  
  // Define o estado inicial padrão
  abaAtiva = 'ativos';
  subAbaAtiva = 'garcom';
  switchTab('ativos'); 
  switchSubTab('garcom');

  await carregarConfigCategoriasCozinha(); // Carrega config de cozinha imediatamente
  carregarPedidos();
  carregarCardapio();
  carregarStatusCaixa();
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
      await mostrarAlerta(`Estoque insuficiente! Você pode adicionar no máximo mais ${itemNoMenu.estoque} unidades deste item.`, "Estoque");
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
    renderizarMenuEdicao(); // Re-renderiza cardápio para atualizar estoque disponível
  }
}

async function removerItemEdicao(index) { 
  const item = itensEmEdicao[index];
  
  itensEmEdicao.splice(index, 1); 
  renderizarItensEdicao(); 
  renderizarMenuEdicao(); // Re-renderiza cardápio para atualizar estoque disponível
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

function atualizarCronometrosPedidos() {
  if (abaAtiva !== 'ativos') return;
  
  // Busca todos os cronômetros presentes na página (independente do container)
  const spans = document.querySelectorAll('.pedido-cronometro');
  
  spans.forEach((span) => {
    const card = span.closest('.pedido-card');
    const createdAt = span.dataset.createdAt;
    
    // SÓ ATUALIZA se o card existir e o status for 'recebido' (cor verde)
    // Pedidos já servidos (EM ANDAMENTO) ou finalizados não precisam de cronômetro ativo
    const isRecebido = !!card && card.classList.contains('status-recebido');

    if (!isRecebido || !createdAt) {
      span.style.display = 'none';
      if (card) card.classList.remove('alerta-borda-pisca');
      return;
    }

    const minutos = calcularMinutos(createdAt);
    span.textContent = `⏱️ ${minutos} min`;
    span.style.display = '';
    
    // PISCA SE PASSAR DE 10 MINUTOS
    card.classList.toggle('alerta-borda-pisca', minutos >= 10);
  });
}

function switchTab(tab) {
  // Salva a posição do scroll antes de trocar
  const scrollPos = window.scrollY;
  abaAtiva = tab;
  
  // BLOQUEIO DE SCROLL GLOBAL: Na aba de ativos e lançamento para manter o app fixo
  if (tab === 'lancar' || tab === 'ativos') {
      document.body.classList.add('modal-open');
      window.scrollTo({ top: 0, behavior: 'instant' }); 
      document.documentElement.style.overflow = 'hidden'; // Força trava extra no HTML
  } else {
      document.body.classList.remove('modal-open'); 
      document.documentElement.style.overflow = ''; // Libera para histórico/config
  }

  // Remove classe active de todos os botões
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  
  // Tenta encontrar o botão correspondente à aba e ativa-o
  const botoes = document.querySelectorAll('.tab-btn');
  const mapaAbas = {
    'ativos': 'Pedidos Ativos',
    'lancar': 'Lançar Pedido',
    'historico': 'Histórico',
    'caixa': 'Caixa',
    'whatsapp': 'WhatsApp Beta',
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
  else if (tab === 'configuracoes') carregarDadosConfig();
  else if (tab === 'caixa') carregarStatusCaixa();
  else if (tab === 'lancar') prepararLancarPedido();
  else if (tab === 'whatsapp') carregarStatusWhatsApp();
}

async function carregarStatusWhatsApp() {
  const badge = document.getElementById('whatsapp-status-badge');
  const numberEl = document.getElementById('whatsapp-notify-number');
  const toggle = document.getElementById('toggle-whatsapp');
  if (!badge) return;

  try {
    const res = await fetch('/api/whatsapp-status');
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
    numberEl.textContent = status.number || 'Não configurado';
  } catch (e) {
    badge.textContent = 'ERRO';
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
    mesas.map(m => `<option value="${m.id}">Mesa ${m.numero} (${m.status.toUpperCase()})</option>`).join('');
}

function exibirCategoriasLancar() {
  const container = document.getElementById('lancar-menu-categorias');
  if (!container) return;
  const categoriasUnicas = [...new Set(cardapio.map(item => item.categoria.trim().toLowerCase()))];
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
  const itens = categoria === 'todas' ? cardapio : cardapio.filter(i => i.categoria.trim().toLowerCase() === categoria);
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
    <div class="item-menu-mini" onclick="adicionarAoCarrinhoLancar(${item.id})" style="position: relative; display: flex; flex-direction: column; opacity: ${disponivelReal === 0 ? '0.6' : '1'}; min-height: 240px !important; height: auto !important; background: white; border-radius: 12px; overflow: hidden; border: 1px solid #eee; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
      <!-- Badge de Preço em destaque -->
      <div style="position: absolute; top: 6px; right: 6px; background: #27ae60; color: white; padding: 2px 6px; border-radius: 20px; font-weight: 900; font-size: 0.75rem; z-index: 10; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">R$ ${item.preco.toFixed(2)}</div>

      <img src="${item.imagem}" alt="${item.nome}" style="filter: ${disponivelReal === 0 ? 'grayscale(1)' : 'none'}; height: 80px !important; width: 100%; object-fit: cover; display: block; border-bottom: 1px solid #f0f0f0;">

      <div style="padding: 20px !important; display: flex; flex-direction: column; flex-grow: 1; justify-content: space-between;">
        <h4 style="margin: 0 0 2px 0 !important; font-size: 0.85rem !important; color: #2c3e50 !important; line-height: 1.2 !important; font-weight: 700 !important; min-height: 2.2rem !important; padding: 0 !important; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${item.nome}</h4>

        <div style="padding-top: 2px;">
           <p style="margin: 0 0 4px 0 !important; color: #27ae60 !important; font-weight: 900 !important; font-size: 1.05rem !important; padding: 0 !important;">R$ ${item.preco.toFixed(2)}</p>
           ${temEstoqueDefinido ? `
             <div style="background: ${disponivelReal <= 0 ? '#fff5f5' : '#f0f9ff'}; padding: 4px; border-radius: 6px; border: 1px solid ${disponivelReal <= 0 ? '#feb2b2' : '#bee3f8'}; width: 100%; box-sizing: border-box; margin-bottom: 2px; min-height: 24px; display: flex; align-items: center; justify-content: center;">
               <small style="display:block; font-size:0.65rem; font-weight: 900; color:${disponivelReal <= 0 ? '#e74c3c' : '#2c3e50'}; text-align: center; text-transform: uppercase;">DISPONÍVEL: ${disponivelReal}</small>
             </div>
           ` : `
             <div style="background: #f8f9fa; padding: 4px; border-radius: 6px; border: 1px solid #e2e8f0; width: 100%; box-sizing: border-box; margin-bottom: 2px; min-height: 24px; display: flex; align-items: center; justify-content: center;">
               <small style="display:block; font-size:0.65rem; color:#718096; text-align: center; font-weight: 900; text-transform: uppercase;">ILIMITADO</small>
             </div>
           `}
        </div>
      </div>
    </div>
    `}).join('');}

async function adicionarAoCarrinhoLancar(itemId) {
  const item = cardapio.find(m => m.id === itemId);
  if (!item) return;
  
  // Cálculo do que já está no carrinho para validar estoque antes de adicionar
  const noCarrinho = carrinhoLancar.filter(c => c.menu_id === itemId).reduce((s, i) => s + i.quantidade, 0);
  
  if (item.estoque !== -1 && (noCarrinho + 1) > item.estoque) {
    return await mostrarAlerta("Limite de estoque atingido!", "Estoque");
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

          <button onclick="removerDoCarrinhoLancar(${index})" style="width: 32px; height: 32px; border-radius: 50%; border: none; background: #fff1f2; color: #ef4444; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; transition: 0.2s; border: 1px solid #fecaca;">✕</button>
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
  if (await mostrarConfirmacao("Deseja esvaziar todo o carrinho?", "Limpar Tudo")) {
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
    await mostrarAlerta("Estoque insuficiente!", "Estoque");
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
  if (!mesaId) return await mostrarAlerta("Selecione a mesa ou BALCÃO!", "Aviso");
  if (carrinhoLancar.length === 0) return await mostrarAlerta("Carrinho vazio!", "Aviso");

  const cobrarTaxa = document.getElementById('lancar-taxa-toggle').checked;
  const subtotal = carrinhoLancar.reduce((s,i) => s + (i.preco * i.quantidade), 0);

  if (!await mostrarConfirmacao(`Confirmar lançamento de R$ ${(cobrarTaxa ? subtotal * 1.10 : subtotal).toFixed(2)}?`, "Novo Pedido")) return;

  enviandoPedidoLote = true;
  const btn = document.querySelector("button[onclick='enviarPedidoLoteAdmin()']");
  if (btn) { btn.disabled = true; btn.innerText = "⏳ ENVIANDO..."; }

  let pedidoExistente = null;
  if (mesaId !== 'BALCAO') {
    const resMesa = await fetch(`/api/pedidos/mesa/${mesaId}`);
    pedidoExistente = await resMesa.json();
  } else {
    mesaId = null;
  }

  const url = pedidoExistente ? `/api/pedidos/${pedidoExistente.id}/adicionar` : '/api/pedidos';
  const method = pedidoExistente ? 'PUT' : 'POST';
  const body = pedidoExistente 
    ? { itens: carrinhoLancar, cobrar_taxa: cobrarTaxa } 
    : { mesa_id: mesaId, garcom_id: 'ADMIN', itens: carrinhoLancar, cobrar_taxa: cobrarTaxa };

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

      document.getElementById('btn-decisao-fechar').onclick = () => {
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
      await mostrarAlerta("Erro: " + err.error, "Erro");
    }
  } catch (e) {
    await mostrarAlerta("Erro de conexão", "Erro");
  } finally {
    enviandoPedidoLote = false;
    if (btn) { btn.disabled = false; btn.innerText = "🚀 LANÇAR NA MESA"; }
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
  const valor = parseFloat(document.getElementById('caixa-valor-inicial').value) || 0;
  const res = await fetch('/api/caixa/abrir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ valor_inicial: valor })
  });
  if (res.ok) {
    mostrarToast("Caixa aberto com sucesso!");
    carregarStatusCaixa();
  }
}

async function confirmarFechamentoCaixa() {
  if (!await mostrarConfirmacao("Tem certeza que deseja FECHAR O CAIXA e encerrar o expediente?", "Fechar Caixa")) return;
  
  // Guardamos uma cópia dos dados do caixa antes de fechar para o relatório
  const dadosCaixaParaRelatorio = { ...caixaAtual };
  const valorFinal = caixaAtual.valor_inicial + caixaAtual.total_dinheiro + caixaAtual.total_pix + caixaAtual.total_cartao;
  
  const res = await fetch('/api/caixa/fechar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: caixaAtual.id, valor_final: valorFinal })
  });
  
  if (res.ok) {
    await mostrarAlerta(`Caixa fechado com sucesso!\n\nTotal de Vendas: R$ ${dadosCaixaParaRelatorio.total_vendas.toFixed(2)}\nDinheiro em Caixa: R$ ${(dadosCaixaParaRelatorio.valor_inicial + dadosCaixaParaRelatorio.total_dinheiro).toFixed(2)}`, "Sucesso");
    
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
    
    if (await mostrarConfirmacao("Deseja imprimir o resumo diário (PDF) do histórico de vendas?", "Imprimir Resumo", "Sim, Imprimir", "Não agora")) {
        await imprimirResumoDiario();
    }

    // Pergunta se deseja limpar o histórico
    if (await mostrarConfirmacao("Deseja LIMPAR o histórico de pedidos entregues e cancelados agora?", "Limpar Histórico", "Sim, Limpar", "Não")) {
        await limparHistoricoTotal();
    }

    // Restaura e atualiza o status real
    caixaAtual = caixaOriginal;
    carregarStatusCaixa();
  } else {
    const err = await res.json();
    await mostrarAlerta("⚠️ Erro ao fechar caixa: " + (err.error || "Erro desconhecido"), "Erro");
  }
}

async function carregarDadosConfig() {
  await Promise.all([exibirMesasConfig(), exibirGarconsConfig(), exibirMenuConfig(), exibirConfigCategoriasCozinha()]);
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
      await mostrarAlerta("✅ Configuração de cozinha salva com sucesso! Todos os itens do cardápio foram sincronizados automaticamente.", "Sucesso");
    } else {
      throw new Error('Falha ao salvar');
    }
  } catch (e) {
    console.error(e);
    await mostrarAlerta("❌ Erro ao salvar configuração.", "Erro");
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
  if (await mostrarConfirmacao("Remover mesa?", "Configuração")) { await fetch(`/api/mesas/${id}`, { method: 'DELETE' }); exibirMesasConfig(); }
}

// GARÇONS
let idGarcomEdicao = null;

async function exibirGarconsConfig() {
  const res = await fetch('/api/garcons');
  if (!res.ok) return;
  const garcons = await res.json();
  const container = document.getElementById('lista-garcons-config');
  if (!container) return;
  container.innerHTML = garcons.map(g => `
    <div class="item-config">
      <div>
        <strong>${g.nome}</strong> (@${g.usuario})
        ${g.telefone ? `<br><small style="color:#25D366; cursor:pointer;" onclick="window.open('https://wa.me/${g.telefone.replace(/\D/g, '')}', '_blank')">📱 WhatsApp: ${g.telefone}</small>` : ''}
      </div>
      <div style="display:flex; gap:0.5rem">
        <button style="background:#3498db; padding:4px 8px; font-size:0.8rem; width:auto;" onclick='prepararEdicaoGarcom(${JSON.stringify(g)})'>✏️</button>
        <button class="btn-excluir" style="width:auto;" onclick="excluirGarcom(${g.id})">X</button>
      </div>
    </div>`).join('');
}

function prepararEdicaoGarcom(g) {
  idGarcomEdicao = g.id;
  document.getElementById('garcom-nome').value = g.nome;
  document.getElementById('garcom-usuario').value = g.usuario;
  document.getElementById('garcom-telefone').value = g.telefone || '';
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
  ['garcom-nome', 'garcom-usuario', 'garcom-telefone', 'garcom-senha'].forEach(id => {
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
  const senha = document.getElementById('garcom-senha').value;
  
  if (!nome || !usuario) return await mostrarAlerta("Nome e usuário são obrigatórios", "Aviso");
  
  const payload = { nome, usuario, telefone, senha };
  const url = idGarcomEdicao ? `/api/garcons/${idGarcomEdicao}` : '/api/garcons';
  const method = idGarcomEdicao ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    mostrarToast(idGarcomEdicao ? "Garçom atualizado!" : "Garçom cadastrado!");
    cancelarEdicaoGarcom();
    exibirGarconsConfig();
  }
}

async function excluirGarcom(id) {
  if (await mostrarConfirmacao("Excluir este garçom?", "Configuração")) {
    const res = await fetch(`/api/garcons/${id}`, { method: 'DELETE' });
    if (res.ok) exibirGarconsConfig();
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

    document.getElementById('menu-nome').value = item.nome;
    document.getElementById('menu-preco').value = item.preco;
    document.getElementById('menu-estoque').value = item.estoque;
    document.getElementById('menu-validade').value = item.validade || '';
    document.getElementById('menu-img').value = item.imagem;
    document.getElementById('menu-enviar-cozinha').checked = (item.enviar_cozinha === true || item.enviar_cozinha === 1 || item.enviar_cozinha === null);

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
    
    ['menu-nome', 'menu-preco', 'menu-img', 'menu-validade'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('menu-estoque').value = '-1';
    selectCat.value = '';
  }

  modal.style.display = 'flex';
  document.body.classList.add('modal-open');
}

async function excluirDoMenuAtual() {
    if (!idItemEdicaoMenu) return;
    if (await mostrarConfirmacao("Deseja realmente excluir este item do cardápio permanentemente?", "Excluir Item")) {
        try {
            const res = await fetch(`/api/menu/${idItemEdicaoMenu}`, { method: 'DELETE' });
            if (res.ok) {
                mostrarToast("✅ Item removido do cardápio!");
                fecharModalItemMenu();
                carregarCardapio();
            } else {
                const err = await res.json();
                mostrarAlerta("Erro ao excluir: " + (err.error || "Erro desconhecido"));
            }
        } catch (e) {
            mostrarAlerta("Erro de conexão ao excluir item.");
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
  const selectCat = document.getElementById('menu-cat-select').value;
  const inputNovo = document.getElementById('menu-cat-novo').value;
  
  // Define a categoria final
  let categoria = selectCat;
  if (selectCat === 'NOVA_CATEGORIA') {
    categoria = inputNovo.trim();
  }

  const preco = parseFloat(document.getElementById('menu-preco').value);
  const estoque = parseInt(document.getElementById('menu-estoque').value);
  const validade = document.getElementById('menu-validade').value;
  const imagem = document.getElementById('menu-img').value || 'https://placehold.co/100';
  const enviar_cozinha = document.getElementById('menu-enviar-cozinha').checked;

  if (!nome || !categoria || isNaN(preco) || isNaN(estoque)) {
    return await mostrarAlerta("Por favor, preencha o nome, categoria e preço corretamente.", "Aviso");
  }

  const payload = { nome, categoria: categoria.toUpperCase(), preco, imagem, estoque, validade, enviar_cozinha };
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
    mostrarAlerta("Erro ao salvar: " + (err.error || "Desconhecido"), "Erro");
  }
}

function prepararEdicaoMenu(item) {
  abrirModalItemMenu(item);
}

async function exibirMenuConfig() {
  const container = document.getElementById('lista-menu-config');
  if (!container) return;
  
  const res = await fetch('/api/menu');
  if (!res.ok) return;
  cardapio = await res.json(); // Atualiza variável global também, pois ela é usada na renderização
  
  const hoje = new Date();
  hoje.setHours(0,0,0,0);
  let vencidosCount = 0;
  let proxVencimentoCount = 0;

  // Agrupar itens por categoria
  const categorias = [...new Set(cardapio.map(item => item.categoria.trim().toUpperCase()))].sort();
  
  let htmlFinal = '';

  categorias.forEach(cat => {
    const itensDaCat = cardapio.filter(i => i.categoria.trim().toUpperCase() === cat);
    
    htmlFinal += `
      <div class="categoria-config-section" style="width: 100%; grid-column: 1 / -1; margin-top: 2rem;">
        <h2 style="background: #2c3e50; color: white; padding: 10px 20px; border-radius: 8px; font-size: 1.1rem; display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span>📂 ${cat}</span>
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

            return `
            <div class="menu-item-config ${classeValidade}" id="item-menu-${m.id}" style="border-left: 5px solid ${classeValidade === 'vencido' ? '#e74c3c' : (classeValidade === 'alerta-validade' ? '#f39c12' : 'transparent')}">
              <img src="${m.imagem}" alt="${m.nome}">
              <div style="flex-grow: 1;">
                <strong>${m.nome}</strong><br>
                <small>${m.categoria} - R$ ${m.preco.toFixed(2)}</small><br>
                <small style="color: ${m.estoque === 0 ? '#e74c3c' : '#27ae60'}; font-weight: bold;">
                  Estoque: ${m.estoque === -1 ? 'Ilimitado' : m.estoque}
                </small><br>
                <small>${validadeHtml}</small>
              </div>
              <div style="display:flex; flex-direction:column; gap:0.2rem">
                <button style="background:#3498db; padding:4px 8px; font-size:0.8rem" onclick='prepararEdicaoMenu(${JSON.stringify(m)})'>✏️ Editar</button>
                <button class="btn-excluir" onclick="excluirDoMenu(${m.id})">Excluir</button>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    `;
  });

  container.innerHTML = htmlFinal || '<p style="text-align:center; padding: 2rem; opacity: 0.5;">Nenhum item cadastrado no cardápio.</p>';

  if (vencidosCount > 0 || proxVencimentoCount > 0) {
    mostrarToast(`🚨 ALERTA: ${vencidosCount} produtos vencidos e ${proxVencimentoCount} próximos da validade!`);
  }
}

async function excluirDoMenu(id) {
  if (await mostrarConfirmacao("Excluir item do cardápio?", "Configuração")) { await fetch(`/api/menu/${id}`, { method: 'DELETE' }); carregarCardapio(); }
}

async function excluirCategoria(categoria) {
  if (await mostrarConfirmacao(`⚠️ ATENÇÃO: Deseja realmente EXCLUIR TODOS os itens da categoria "${categoria}"?\n\nEsta ação não pode ser desfeita.`, "Excluir Categoria")) {
    const res = await fetch(`/api/menu/categoria/${encodeURIComponent(categoria)}`, { method: 'DELETE' });
    if (res.ok) {
      mostrarToast(`✅ Categoria "${categoria}" e seus itens foram removidos.`);
      carregarCardapio();
    } else {
      const err = await res.json();
      mostrarAlerta("Erro ao excluir categoria: " + (err.error || "Erro desconhecido"), "Erro");
    }
  }
}

async function carregarHistorico() {
  const res = await fetch('/api/pedidos/historico');
  if (!res.ok) return;
  historico = await res.json();
  exibirHistorico();
}

async function exibirHistorico() {
  const listContainer = document.getElementById('historico-list');
  const containerFinalizados = document.getElementById('lista-finalizados');
  const containerCancelados = document.getElementById('lista-cancelados');
  if (!containerFinalizados || !containerCancelados || !listContainer) return;

  // Limpar estados anteriores
  containerFinalizados.innerHTML = '';
  containerCancelados.innerHTML = '';

  // SEMPRE GARANTE QUE OS CONTAINERS ESTEJAM VISÍVEIS PARA MANTER A DIVISÃO
  document.getElementById('historico-finalizados').style.display = 'block';
  document.getElementById('historico-cancelados').style.display = 'block';

  const dataHoje = new Date().toLocaleDateString('pt-BR');
  document.getElementById('data-historico').innerText = dataHoje;

  let faturamentoTotal = 0;

  if (historico.length === 0) {
    containerFinalizados.innerHTML = '<p style="text-align:center; padding: 1.5rem; opacity: 0.5; font-weight:bold;">Nenhum pedido finalizado hoje.</p>';
    containerCancelados.innerHTML = '<p style="text-align:center; padding: 1.5rem; opacity: 0.5; font-weight:bold;">Nenhum pedido cancelado hoje.</p>';
    document.getElementById('faturamento-total-dia').innerText = `Faturamento Concluído: R$ 0,00`;
    
    // Limpa o select de filtros quando não há histórico
    const selectFiltro = document.getElementById('filtro-historico-select');
    if (selectFiltro) {
      selectFiltro.innerHTML = '<option value="">Todas as Mesas / Todos os Garçons</option>';
      selectFiltro.value = '';
    }
    return;
  }

  for (const pedido of historico) {
    const valorConsolidado = (pedido.total || 0) + (pedido.pago_parcial || 0);
    if (pedido.status === 'entregue') faturamentoTotal += valorConsolidado;

    // Busca itens e pagamentos em paralelo
    const [itens, pagamentos] = await Promise.all([
      fetch(`/api/pedidos/${pedido.id}/itens`).then(res => res.json()),
      fetch(`/api/pedidos/${pedido.id}/pagamentos`).then(res => res.json())
    ]);

    const card = document.createElement('div');
    card.className = `pedido-card status-${pedido.status}`;
    const mesaNomeExibicao = pedido.mesa_numero ? `Mesa ${pedido.mesa_numero}` : 'BALCÃO';

    // Gerar HTML dos pagamentos se houver
    let htmlPagamentos = '';
    if (pagamentos && pagamentos.length > 0) {
      htmlPagamentos = `
        <div style="margin-top: 10px; padding: 10px; background: #f8f9fa; border-radius: 6px; border: 1px solid #dee2e6; text-align: left;">
          <h4 style="margin: 0 0 5px 0; font-size: 0.85rem; color: #495057; border-bottom: 1px solid #dee2e6; padding-bottom: 3px;">💳 Resumo de Pagamentos</h4>
          ${pagamentos.map((pag, idx) => `
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 2px;">
              <span>Parte ${idx + 1} (${pag.forma_pagamento}):</span>
              <span style="font-weight: bold;">R$ ${pag.valor.toFixed(2)}</span>
            </div>
          `).join('')}
          <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-top: 5px; padding-top: 3px; border-top: 1px dashed #ced4da; font-weight: bold; color: #212529;">
            <span>TOTAL PAGO:</span>
            <span>R$ ${pedido.pago_parcial.toFixed(2)}</span>
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="pedido-header">
        <div>
          <h3>${mesaNomeExibicao}</h3>
          <span class="status-badge ${pedido.status}">${pedido.status === 'entregue' ? 'PAGO' : pedido.status.toUpperCase()}</span>
          <small style="display:block; margin-top:4px;">📅 ${formatarData(pedido.created_at)}</small>
          <small style="display:block; font-weight:bold; color: #2c3e50;">👤 Garçom: ${pedido.garcom_nome || pedido.garcom_id || 'Administrador'}</small>
          ${pedido.observacao ? `<small style="display:block; color:#e67e22; font-weight:bold; margin-top:2px;">📝 ${pedido.observacao}</small>` : ''}
          ${(pagamentos.length > 1 || pedido.num_pessoas > 1) ? `<small style="display:block; color:#2980b9; font-weight:bold; margin-top:2px;">👥 DIVIDIDO POR: ${Math.max(pagamentos.length, pedido.num_pessoas || 1)} PESSOAS</small>` : ''}
        </div>
        <div style="text-align: right;">
          <div class="pedido-valor">R$ ${valorConsolidado.toFixed(2)}</div>
          <div style="display:flex; flex-direction:column; gap:5px; margin-top:5px;">
            <button style="background:#2c3e50; border:1px solid #34495e; font-size: 0.75rem; width: 100%; padding: 5px 10px;" onclick='imprimirCupom(${JSON.stringify(pedido)}, ${JSON.stringify(itens)})'>🖨️ Re-imprimir</button>
            <button style="background:#e74c3c; font-size: 0.75rem; width: 100%; padding: 5px 10px;" onclick="excluirPedido(${pedido.id})">🗑️ Excluir</button>
          </div>
        </div>
      </div>
      <div class="pedido-itens">${itens.map(item => `
        <div class="pedido-item">
          <span>• ${item.quantidade}x ${item.nome} <span style="font-size:0.75rem; color:#7f8c8d;">(R$ ${(item.preco * item.quantidade).toFixed(2)})</span></span>
          ${item.observacao ? `<br><small style="color:#e67e22; margin-left:15px;">Obs: ${item.observacao}</small>` : ''}
        </div>`).join('')}</div>
      ${htmlPagamentos}
    `;

    if (pedido.status === 'cancelado') {
      containerCancelados.appendChild(card);
    } else {
      containerFinalizados.appendChild(card);
    }
  }

  // Se uma das colunas estiver vazia (mas a outra não), coloca a mensagem de placeholder
  if (containerFinalizados.children.length === 0) {
      containerFinalizados.innerHTML = '<p style="text-align:center; padding: 1rem; opacity: 0.5;">Nenhum pedido finalizado.</p>';
  }
  if (containerCancelados.children.length === 0) {
      containerCancelados.innerHTML = '<p style="text-align:center; padding: 1rem; opacity: 0.5;">Nenhum pedido cancelado.</p>';
  }

  document.getElementById('faturamento-total-dia').innerText = `R$ ${faturamentoTotal.toFixed(2)}`;

  // ATUALIZA O DROPDOWN DE FILTRO DO HISTÓRICO
  const selectFiltro = document.getElementById('filtro-historico-select');
  if (selectFiltro) {
    const valorAtual = selectFiltro.value;
    const opcoes = new Set();
    historico.forEach(p => {
      if (p.mesa_numero) opcoes.add(`Mesa ${p.mesa_numero}`);
      else opcoes.add('BALCÃO');
      if (p.garcom_nome) opcoes.add(p.garcom_nome);
    });

    let htmlOpcoes = '<option value="">Todas as Mesas / Todos os Garçons</option>';
    Array.from(opcoes).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).forEach(opt => {
      htmlOpcoes += `<option value="${opt}">${opt}</option>`;
    });
    selectFiltro.innerHTML = htmlOpcoes;
    selectFiltro.value = valorAtual; // Mantém a seleção

    if (valorAtual) filtrarHistorico(valorAtual);
  }
}

function filtrarHistorico(valor) {
  const busca = valor.toLowerCase().trim();
  const listContainer = document.getElementById('historico-list');
  if (!listContainer) return;

  const cards = listContainer.querySelectorAll('.pedido-card');

  let finalizadosVisiveis = 0;
  let canceladosVisiveis = 0;

  cards.forEach(card => {
    const h3 = card.querySelector('h3');
    const mesaTexto = h3 ? h3.innerText.toLowerCase() : '';
    const textoGeral = card.innerText.toLowerCase();
    const matches = !busca || mesaTexto.includes(busca) || textoGeral.includes(busca);

    if (matches) {
      card.style.display = 'block';
      if (card.classList.contains('status-cancelado')) canceladosVisiveis++;
      else finalizadosVisiveis++;
    } else {
      card.style.display = 'none';
    }
  });

  const msgFin = document.getElementById('lista-finalizados').querySelector('p');
  const msgCan = document.getElementById('lista-cancelados').querySelector('p');
  if (msgFin) msgFin.style.display = (finalizadosVisiveis === 0) ? 'block' : 'none';
  if (msgCan) msgCan.style.display = (canceladosVisiveis === 0) ? 'block' : 'none';
}

async function limparHistoricoTotal() {
  if (historico.length === 0) return await mostrarAlerta("O histórico já está vazio!", "Aviso");

  if (await mostrarConfirmacao("⚠️ ATENÇÃO: Isso apagará TODO o histórico de pedidos entregues e cancelados. Deseja continuar?", "Limpar Histórico")) {
    const res = await fetch('/api/pedidos/limpar', { method: 'DELETE' });
    if (res.ok) { mostrarToast("Histórico limpo!"); carregarHistorico(); }
  }
}

async function imprimirResumoDiario() {
  if (historico.length === 0) return await mostrarAlerta('Nenhum pedido no histórico para imprimir.', "Aviso");

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

  historico.forEach(p => {
    const valorTotalPedido = (p.total || 0) + (p.pago_parcial || 0);
    if (p.status === 'entregue') {
      qtdPedidos++;
      // Se não temos caixaAtual (caixa fechado), fazemos o cálculo manual aproximado
      if (!caixaAtual) {
          totalGeral += valorTotalPedido;
          if (p.forma_pagamento === 'Dinheiro') totalDinheiro += valorTotalPedido;
          else if (p.forma_pagamento === 'Pix') totalPix += valorTotalPedido;
          else if (p.forma_pagamento === 'Cartão') totalCartao += valorTotalPedido;
      }
    } else if (p.status === 'cancelado') {
      totalCancelado += valorTotalPedido;
    }
  });

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
    const res = await fetch('/api/pedidos');
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
  if (!badge) return;
  
  const totalAtivos = pedidos.length;
  if (totalAtivos > 0) {
    badge.textContent = totalAtivos;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function atualizarIndicadoresTopo() {
  const elFat = document.getElementById('faturamento-resumo');
  const elVendas = document.getElementById('vendas-dia-resumo');

  // 1. Busca o status do caixa
  const resCaixa = await fetch('/api/caixa/status');
  caixaAtual = await resCaixa.json();

  if (!caixaAtual) {
    if (elFat) elFat.innerText = `R$ 0,00`;
    if (elVendas) elVendas.innerText = `R$ 0,00`;
    return;
  }

  // 2. Calcula o faturamento ativo (itens já entregues em mesas abertas)
  // Precisamos buscar os itens de cada pedido para saber o que já foi servido
  let faturamentoRealAtivo = 0;
  for (const p of pedidos) {
    const resItens = await fetch(`/api/pedidos/${p.id}/itens`);
    const itens = await resItens.json();
    faturamentoRealAtivo += itens.filter(i => i.status === 'entregue').reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
  }

  if (elFat) elFat.innerText = `R$ ${faturamentoRealAtivo.toFixed(2)}`;
  if (elVendas) elVendas.innerText = `R$ ${caixaAtual.total_vendas.toFixed(2)}`;
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
    mostrarAlerta("Erro ao gerar impressão.", "Erro");
  }
}

let isRenderingPedidos = false;
let expandedPedidoIds = new Set();
let filtroBuscaMesa = '';
let filtroSelectMesa = '';

// ESTADO DE PAGINAÇÃO PARA COLUNAS
let paginaAtualAtivos = {
  garcom: { pendentes: 1, servidos: 1, fechamento: 1 },
  balcao: { pendentes: 1, servidos: 1, fechamento: 1 }
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
  const counts = {
    garcom: { pendentes: 0, servidos: 0, fechamento: 0 },
    balcao: { pendentes: 0, servidos: 0, fechamento: 0 }
  };

  // Listas auxiliares para aplicar a paginação por coluna e grupo
  const itensFiltrados = {
    garcom: { pendentes: [], servidos: [], fechamento: [] },
    balcao: { pendentes: [], servidos: [], fechamento: [] }
  };

  cards.forEach(card => {
    const mesaNome = (card.dataset.mesa || '').trim().toLowerCase();
    const matchesBusca = !filtroBuscaMesa || mesaNome.includes(filtroBuscaMesa);
    const matchesSelect = !filtroSelectMesa || mesaNome === filtroSelectMesa.toLowerCase();
    
    const listId = card.parentElement ? card.parentElement.id : '';
    const group = listId.includes('garcom') ? 'garcom' : 'balcao';
    
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

  // Filtra os pedidos baseado na aba ativa (Garçom ou Balcão)
  const pedidosFiltrados = pedidos.filter(p => {
    const isBalcao = (p.garcom_id === 'ADMIN');
    return subAbaAtiva === 'balcao' ? isBalcao : !isBalcao;
  });

  const nomesMesas = [...new Set(pedidosFiltrados.map(p => p.mesa_numero ? `Mesa ${p.mesa_numero}` : 'BALCÃO'))].sort((a, b) => {
    if (a === 'BALCÃO') return -1;
    if (b === 'BALCÃO') return 1;
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
    }
  };

  if (!lists.garcom.pendentes || !lists.balcao.pendentes) return;
  
  isRenderingPedidos = true;

  // Limpa todas as listas
  Object.values(lists).forEach(group => {
    Object.values(group).forEach(list => list.innerHTML = '');
  });

  const counts = {
    garcom: { pendentes: 0, servidos: 0, fechamento: 0 },
    balcao: { pendentes: 0, servidos: 0 }
  };

  // ORDENAÇÃO: Mais antigos primeiro, priorizando quem já pediu a conta (aguardando_fechamento)
  const pedidosOrdenados = [...pedidos].sort((a, b) => {
    if (a.status === 'aguardando_fechamento' && b.status !== 'aguardando_fechamento') return -1;
    if (a.status !== 'aguardando_fechamento' && b.status === 'aguardando_fechamento') return 1;
    return new Date(a.created_at) - new Date(b.created_at);
  });

  try {
    for (const pedido of pedidosOrdenados) {
      const mesaNomeExibicao = pedido.mesa_numero ? `Mesa ${pedido.mesa_numero}` : 'BALCÃO';
      
      if (pedidosStatusTaxa[pedido.id] === undefined) {
        pedidosStatusTaxa[pedido.id] = (pedido.cobrar_taxa !== undefined) ? pedido.cobrar_taxa : true;
      }
      const cobrarTaxaNoPedido = pedidosStatusTaxa[pedido.id];

      const itens = await fetch(`/api/pedidos/${pedido.id}/itens`).then(res => res.json());
      const itensPendentes = itens.filter(i => i.status === 'pendente');
      const itensProntos = itens.filter(i => i.status === 'pronto');
      const itensEntregues = itens.filter(i => i.status === 'entregue');
      
      const hasPend = (itensPendentes.length > 0 || itensProntos.length > 0);
      const statusGeral = hasPend ? 'recebido' : 'servido';

      let minutosCronometro = null;
      let classeAlertaAtraso = '';
      if (statusGeral === 'recebido' && pedido.created_at) {
        minutosCronometro = calcularMinutos(pedido.created_at);
        if (minutosCronometro >= 10) classeAlertaAtraso = 'alerta-borda-pisca';
      }

      const subtotal = itens.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
      const taxaServico = cobrarTaxaNoPedido ? (subtotal * 0.10) : 0;
      const pagoParcial = pedido.pago_parcial || 0;
      const totalConsumo = (subtotal + taxaServico);
      const totalExibicao = (pedido.status === 'aguardando_fechamento' ? pedido.total : (totalConsumo - pagoParcial)) || 0;
      
      const infoPagamento = (pedido.status === 'aguardando_fechamento' && pedido.forma_pagamento) ? `
        <div style="background:#fff9db; padding:8px; border-radius:8px; margin-top:8px; font-size:0.85rem; border:2px solid #f1c40f;">
          <strong style="color: #d35400;">💰 SOLICITAÇÃO DE CONTA</strong><br>
          <strong>Forma:</strong> ${pedido.forma_pagamento}<br>
          ${(pedido.forma_pagamento === 'Dinheiro') ? `<strong>Recebido:</strong> R$ ${(pedido.valor_recebido || 0).toFixed(2)} | <strong>Troco:</strong> R$ ${(pedido.troco || 0).toFixed(2)}` : ''}
          ${(pedido.desconto > 0) ? `<br><span style="color:#e74c3c;"><strong>Desconto:</strong> - R$ ${pedido.desconto.toFixed(2)}</span>` : ''}
          ${(pedido.acrescimo > 0) ? `<br><span style="color:#27ae60;"><strong>Acréscimo:</strong> + R$ ${pedido.acrescimo.toFixed(2)}</span>` : ''}
        </div>` : '';

      const card = document.createElement('div');
      const isAguardando = pedido.status === 'aguardando_fechamento';
      const isPronto = pedido.status === 'pronto';
      const pedidoIdStr = String(pedido.id);
      const isExpanded = expandedPedidoIds.has(pedidoIdStr);

      card.className = `pedido-card ${isExpanded ? '' : 'minimized'} status-${statusGeral} ${pedido.id === pedidoAtualizadoId ? 'destaque-atualizacao' : ''} ${classeAlertaAtraso} ${isAguardando ? 'alerta-fechamento' : ''} ${isPronto ? 'pedido-pronto-admin' : ''}`;
      card.dataset.pedidoId = pedido.id;
      card.dataset.mesa = mesaNomeExibicao; // Adicionado para facilitar o filtro exato

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
            </h3>            <span class="status-badge ${statusGeral}">${statusGeral === 'servido' ? 'EM ANDAMENTO' : 'PENDENTE'}</span>
            <small style="display:block; margin-top:4px; opacity:0.6;">📅 ${formatarData(pedido.created_at)}</small>
            <small style="display:block; font-weight:bold; color: #34495e; margin-top:2px;">👤 Garçom: ${pedido.garcom_id || 'Admin'}</small>
          </div>
          <div style="text-align:right">
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
              <button class="btn-imprimir-parcial-rapido" data-role="btn-total" onclick="imprimirParcialMesaRapido(${pedido.id})" title="Imprimir Nota Parcial" style="background:#3498db; color:white; border-radius:8px; padding:6px 12px; font-weight:bold; font-size:0.9rem; border:none; cursor:pointer; box-shadow:0 3px 0 #2980b9;">
                🖨️ R$ ${totalExibicao.toFixed(2)}
              </button>
              
              <button style="background: #34495e; color: white; border: none; padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 0.75rem; font-weight: bold; width: 100%; display: flex; align-items: center; justify-content: center; gap: 5px; box-shadow: 0 2px 0 #2c3e50;" 
                      onclick='abrirModalEdicao(${JSON.stringify(pedido)}, ${JSON.stringify(itens)})'>
                ✏️ EDITAR ITENS
              </button>

              <div class="toggle-container">
                <span style="font-size:0.7rem;">10% TAXA</span>
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
                    <strong style="font-size:0.95rem;">${item.quantidade}x ${item.nome} <span class="item-valor" data-base-valor="${(item.preco * item.quantidade).toFixed(2)}" style="font-size:0.75rem; color:#7f8c8d; font-weight:normal;">(R$ ${(item.preco * item.quantidade * (cobrarTaxaNoPedido ? 1.1 : 1)).toFixed(2)})</span></strong>
                    <span style="font-size:0.65rem; font-weight:bold; background:#e74c3c; color:white; padding:2px 6px; border-radius:4px;">⏳ PENDENTE</span>
                  </div>
                  ${item.observacao ? `<small style="color:#d35400; display:block; margin-top:2px; font-weight:bold;">📝 Obs: ${item.observacao}</small>` : ''}
                </div>
              `).join('')}
            </div>
          ` : ''}

          ${itensEntregues.length > 0 ? `
            <div style="opacity: 0.7;">
              <small style="color: #27ae60; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; display:block; margin-bottom:5px;">✅ JÁ NA MESA:</small>
              ${itensEntregues.map(item => `
                <div class="pedido-item" style="border-left:4px solid #27ae60; background:#f0fff4; border-radius:6px; padding:4px 10px; margin-bottom:4px; text-decoration: line-through;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:0.85rem;">${item.quantidade}x ${item.nome} <span class="item-valor" data-base-valor="${(item.preco * item.quantidade).toFixed(2)}" style="font-size:0.7rem; color:#7f8c8d;">(R$ ${(item.preco * item.quantidade * (cobrarTaxaNoPedido ? 1.1 : 1)).toFixed(2)})</span></span>
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
              `<button style="background:#27ae60; font-size:1.1rem; border:none; padding: 1.2rem; width: 100%; border-radius:12px; box-shadow:0 5px 0 #219150; cursor:pointer;" onclick="aprovarFechamento(${pedido.id}, ${pedido.mesa_id})">💰 CONFIRMAR PAGAMENTO E LIBERAR</button>` : 
              `<div style="display:flex; gap:0.5rem;">
                ${hasPend ? `<button style="background:#e67e22; flex: 1.5; padding:12px; font-weight:bold; border-radius:10px; box-shadow:0 4px 0 #d35400; cursor:pointer;" onclick="marcarPedidoEntregue(${pedido.id})">🚚 ENTREGAR TUDO AGORA</button>` : ''}
                <button style="background:#7f8c8d; flex: 1; padding:12px; font-weight:bold; border-radius:10px; box-shadow:0 4px 0 #707b7c; cursor:pointer; font-size:0.75rem;" onclick="liberarMesa(${pedido.id}, ${pedido.mesa_id}, ${hasPend})">🔓 FECHAR CONTA</button>
              </div>`
            }
          </div>
        </div>`;
      
      const group = (pedido.garcom_id === 'ADMIN') ? 'balcao' : 'garcom';
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
    if (bGarcom) bGarcom.textContent = counts.garcom.pendentes + counts.garcom.servidos + counts.garcom.fechamento;
    if (bBalcao) bBalcao.textContent = counts.balcao.pendentes + counts.balcao.servidos;

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
  if (selecionados.length === 0) return await mostrarAlerta("Selecione pelo menos um item!", "Aviso");
  
  if (await mostrarConfirmacao(`Deseja remover os ${selecionados.length} itens selecionados?`, "Remover Itens")) {
    itensEmEdicao = itensEmEdicao.filter(i => !i.selecionado);
    renderizarItensEdicao();
    mostrarToast("✅ Itens selecionados removidos!");
  }
}

// Funções de edição de itens consolidadas na parte inferior do arquivo

function filtrarHistorico(valor) {
  const busca = valor.toLowerCase().trim();
  const listContainer = document.getElementById('historico-list');
  if (!listContainer) return;

  const cards = listContainer.querySelectorAll('.pedido-card');

  let finalizadosVisiveis = 0;
  let canceladosVisiveis = 0;

  cards.forEach(card => {
    // Captura todo o texto do card (Mesa, Garçom, Itens, Observações)
    const texto = card.innerText.toLowerCase();

    // Tenta extrair o número da mesa se houver (ex: Mesa 6 -> 6)
    const h3 = card.querySelector('h3');
    const mesaTexto = h3 ? h3.innerText.toLowerCase() : '';

    // Verifica se a busca bate com o texto geral OU se o usuário digitou um número que bate com o número da mesa
    const matchesTexto = texto.includes(busca);
    const matchesMesaDireta = busca.length > 0 && mesaTexto.includes(busca);

    const matches = !busca || matchesTexto || matchesMesaDireta;

    if (matches) {
      card.style.display = 'block';
      if (card.classList.contains('status-cancelado')) canceladosVisiveis++;
      else finalizadosVisiveis++;
    } else {
      card.style.display = 'none';
    }
  });

  // Atualiza mensagens de "Nenhum pedido" dinamicamente
  const msgFin = document.getElementById('lista-finalizados').querySelector('p');
  const msgCan = document.getElementById('lista-cancelados').querySelector('p');

  if (msgFin) {
    if (finalizadosVisiveis === 0) {
      msgFin.style.display = 'block';
      msgFin.innerText = busca ? 'Nenhum finalizado encontrado para esta busca.' : 'Nenhum pedido finalizado hoje.';
    } else {
      msgFin.style.display = 'none';
    }
  }

  if (msgCan) {
    if (canceladosVisiveis === 0) {
      msgCan.style.display = 'block';
      msgCan.innerText = busca ? 'Nenhum cancelado encontrado para esta busca.' : 'Nenhum pedido cancelado hoje.';
    } else {
      msgCan.style.display = 'none';
    }
  }
}async function excluirPedido(id) {
  if (await mostrarConfirmacao("⚠️ EXCLUIR PERMANENTEMENTE?\n\nIsso removerá o pedido do banco de dados e do histórico. Esta ação não pode ser desfeita.", "Excluir Registro")) {
    const res = await fetch(`/api/pedidos/${id}`, { method: 'DELETE' });
    if (res.ok) {
      mostrarToast("🗑️ Pedido excluído!");
      if (abaAtiva === 'ativos') carregarPedidos();
      else carregarHistorico();
    }
  }
}

async function atualizarStatus(id, status) {
  if (status === 'cancelado' && !await mostrarConfirmacao("Deseja realmente CANCELAR este pedido? A mesa será liberada.", "Cancelar Pedido")) return;
  
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
    await mostrarAlerta("Erro: " + err.error, "Erro");
  }
}

async function marcarPedidoEntregue(id) {
  if (await mostrarConfirmacao("Marcar todos os itens como entregues?", "Entregar Tudo")) {
    const res = await fetch(`/api/pedidos/${id}/marcar-entregue`, { method: 'PUT' });
    if (res.ok) {
      mostrarToast("Pedido marcado como entregue!");
      carregarPedidos();
    }
  }
}

async function liberarMesa(idPedido, idMesa, temPendentes = false) {
  let msg = "Liberar mesa agora?";
  if (temPendentes) {
    msg = "⚠️ ATENÇÃO: Esta mesa possui itens PENDENTES de entrega! Tem certeza que deseja LIBERAR a mesa e encerrar o pedido sem entregar tudo?";
  }
  if (await mostrarConfirmacao(msg, "Liberar Mesa")) {
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
  fetch(`/api/pedidos/${idPedido}/itens`).then(res => res.json()).then(itens => abrirModalEdicao(pedidoParaFecharAdmin, itens));
}

function abrirModalEdicao(pedido, itens) {
  pedidoEmEdicao = pedido;
  itensEmEdicao = itens.map(i => ({ ...i, selecionado: false }));
  document.getElementById('modal-titulo').innerText = `Editar Pedido: ${pedido.mesa_numero ? 'Mesa ' + pedido.mesa_numero : 'Balcão'}`;
  renderizarItensEdicao();
  renderizarMenuEdicao();
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
    return `
    <div class="item-edicao" style="${isEntregue ? 'background: #f0fff4; border-left: 4px solid #27ae60;' : (item.status === 'pronto' ? 'background: #e8f8f5; border-left: 4px solid #2ecc71;' : 'border-left: 4px solid #e67e22;')} padding: 12px; margin-bottom: 10px; border-radius: 12px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); border: 1px solid #edf2f7; display: flex; flex-direction: column; gap: 10px;">
      
      <!-- LINHA 1: CHECKBOX + NOME + STATUS -->
      <div style="display: flex; align-items: flex-start; gap: 10px;">
        <input type="checkbox" ${item.selecionado ? 'checked' : ''} onchange="alternarSelecaoItemEdicao(${index})" style="width: 22px; height: 22px; cursor: pointer; flex-shrink: 0; margin-top: 2px;">
        
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 1rem; color: #1e293b; font-weight: 800; line-height: 1.3; margin-bottom: 2px;">${item.nome}</div>
          <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 900; text-transform: uppercase; background: ${isEntregue ? '#dcfce7' : (item.status === 'pronto' ? '#e8f8f5' : '#fef3c7')}; color: ${isEntregue ? '#166534' : (item.status === 'pronto' ? '#27ae60' : '#92400e')};">
            ${isEntregue ? '✅ Entregue' : (item.status === 'pronto' ? '🔥 Pronto' : '⏳ Pendente')}
          </span>
        </div>
      </div>

      <!-- OBSERVAÇÃO -->
      <div style="margin: 0;">
        <input type="text" 
               placeholder="📝 Observação..." 
               value="${item.observacao || ''}" 
               oninput="itensEmEdicao[${index}].observacao = this.value"
               style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #edf2f7; font-size: 0.85rem; background: #f8fafc;">
      </div>

      <!-- LINHA 2: CONTROLES + PREÇO TOTAL -->
      <div style="display: flex; align-items: center; justify-content: space-between; padding-top: 8px; border-top: 1px solid #f1f5f9;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <!-- SELETOR DE QTD -->
          <div style="display: flex; align-items: center; border: 2px solid #e2e8f0; border-radius: 10px; overflow: hidden; background: #fff; height: 38px;">
            <button onclick="mudarQtdItem(${index}, ${item.quantidade - 1})" 
                    style="width: 38px; height: 100%; border: none; background: #fff; color: #ef4444; font-size: 1.4rem; font-weight: bold; cursor: pointer; border-right: 2px solid #e2e8f0;">-</button>
            
            <span style="min-width: 40px; text-align: center; font-weight: 900; font-size: 1.1rem; color: #0f172a;">${item.quantidade}</span>
            
            <button onclick="mudarQtdItem(${index}, ${item.quantidade + 1})" 
                    style="width: 38px; height: 100%; border: none; background: #fff; color: #22c55e; font-size: 1.4rem; font-weight: bold; cursor: pointer; border-left: 2px solid #e2e8f0;">+</button>
          </div>

          <!-- BOTÃO REMOVER -->
          <button onclick="removerItemEdicao(${index})" 
                  style="background: #fee2e2; color: #ef4444; border: 1px solid #fecaca; width: 38px; height: 38px; border-radius: 10px; cursor: pointer; font-weight: bold; display: flex; align-items: center; justify-content: center;">✕</button>
        </div>

        <!-- PREÇO TOTAL DO ITEM -->
        <div style="text-align: right;">
          <small style="display: block; font-size: 0.7rem; color: #64748b; font-weight: bold; margin-bottom: -2px;">TOTAL ITEM</small>
          <strong style="color: #166534; font-size: 1.2rem; font-weight: 900;">R$ ${(item.preco * item.quantidade).toFixed(2)}</strong>
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
  const container = document.getElementById('edit-menu-grid');
  const catContainer = document.getElementById('edit-menu-categorias');
  if (!container || !catContainer) return;

  const categoriasUnicas = [...new Set(cardapio.map(i => i.categoria.trim().toLowerCase()))];
  const categorias = ['todas', ...categoriasUnicas];
  
  catContainer.innerHTML = categorias.map(cat => {
    const nomeExibicao = cat === 'todas' ? 'Todos' : cat.charAt(0).toUpperCase() + cat.slice(1);
    const isAtiva = cat === categoria.trim().toLowerCase();
    return `
      <div class="cat-mini ${isAtiva ? 'ativa' : ''}" 
           onclick="renderizarMenuEdicao('${cat}')">
        ${nomeExibicao}
      </div>
    `;
  }).join('');

  const itens = categoria === 'todas' ? cardapio : cardapio.filter(i => i.categoria.trim().toLowerCase() === categoria.trim().toLowerCase());
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
    <div class="item-menu-mini" onclick="adicionarItemNaEdicao(${item.id})" style="position: relative; display: flex; flex-direction: column; opacity: ${estoqueDisponivel === 0 ? '0.6' : '1'}; min-height: 240px !important; height: auto !important; background: white; border-radius: 12px; overflow: hidden; border: 1px solid #eee; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
      <!-- Badge de Preço em destaque -->
      <div style="position: absolute; top: 6px; right: 6px; background: #27ae60; color: white; padding: 2px 6px; border-radius: 20px; font-weight: 900; font-size: 0.75rem; z-index: 10; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">R$ ${item.preco.toFixed(2)}</div>
      
      <img src="${item.imagem}" alt="${item.nome}" style="filter: ${estoqueDisponivel === 0 ? 'grayscale(1)' : 'none'}; height: 80px !important; width: 100%; object-fit: cover; display: block; border-bottom: 1px solid #f0f0f0;">
      
      <div style="padding: 20px !important; display: flex; flex-direction: column; flex-grow: 1; justify-content: space-between;">
        <h4 style="margin: 0 0 2px 0 !important; font-size: 0.85rem !important; color: #2c3e50 !important; line-height: 1.2 !important; font-weight: 700 !important; min-height: 2.2rem !important; padding: 0 !important; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${item.nome}</h4>
        
        <div style="padding-top: 2px;">
           <p style="margin: 0 0 4px 0 !important; color: #27ae60 !important; font-weight: 900 !important; font-size: 1.05rem !important; padding: 0 !important;">R$ ${item.preco.toFixed(2)}</p>
           ${temEstoqueDefinido ? `
             <div style="background: ${estoqueDisponivel <= 0 ? '#fff5f5' : '#f0f9ff'}; padding: 4px; border-radius: 6px; border: 1px solid ${estoqueDisponivel <= 0 ? '#feb2b2' : '#bee3f8'}; width: 100%; box-sizing: border-box; margin-bottom: 2px; min-height: 24px; display: flex; align-items: center; justify-content: center;">
               <small style="display:block; font-size:0.65rem; font-weight: 900; color:${estoqueDisponivel <= 0 ? '#e74c3c' : '#2c3e50'}; text-align: center; text-transform: uppercase;">DISPONÍVEL: ${estoqueDisponivel}</small>
             </div>
           ` : `
             <div style="background: #f8f9fa; padding: 4px; border-radius: 6px; border: 1px solid #e2e8f0; width: 100%; box-sizing: border-box; margin-bottom: 2px; min-height: 24px; display: flex; align-items: center; justify-content: center;">
               <small style="display:block; font-size:0.65rem; color:#718096; text-align: center; font-weight: 900; text-transform: uppercase;">ILIMITADO</small>
             </div>
           `}
        </div>
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
    if (await mostrarConfirmacao(`Deseja substituir os ${selecionadosIndices.length} itens selecionados por ${menuItem.nome}?`, "Substituir Itens")) {
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
      mostrarToast("🔄 Itens substituídos com sucesso!");
      return;
    }
  }

  const exist = itensEmEdicao.find(i => i.menu_id === itemId && i.status === 'pendente');
  const qtdAtual = exist ? exist.quantidade : 0;
  
  if (menuItem.estoque !== -1 && (qtdAtual + 1) > menuItem.estoque) {
    return await mostrarAlerta(`Estoque insuficiente! Restam apenas ${menuItem.estoque} unidades.`, "Estoque");
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
  renderizarMenuEdicao(); // ATUALIZAÇÃO EM TEMPO REAL DO ESTOQUE NO CARDÁPIO
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
      mostrarToast("Pedido cancelado!");
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

  const resItens = await fetch(`/api/pedidos/${idPedido}/itens`);
  itensFechamentoAdmin = await resItens.json();
  
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

  const mesaLabel = pedidoParaFecharAdmin.mesa_numero ? `Mesa ${pedidoParaFecharAdmin.mesa_numero}` : 'BALCÃO';
  document.getElementById('fechamento-mesa-admin').textContent = mesaLabel;
  
  let cobrarTaxaNoPedido = true;
  if (pedidoParaFecharAdmin.cobrar_taxa !== undefined) {
    cobrarTaxaNoPedido = pedidoParaFecharAdmin.cobrar_taxa;
  } else if (pedidosStatusTaxa[idPedido] !== undefined) {
    cobrarTaxaNoPedido = pedidosStatusTaxa[idPedido];
  }
  
  document.getElementById('fechamento-taxa-admin').checked = cobrarTaxaNoPedido;
  document.getElementById('fechamento-acrescimo-admin').value = pedidoParaFecharAdmin.acrescimo || 0;
  document.getElementById('fechamento-desconto-admin').value = pedidoParaFecharAdmin.desconto || 0;
  document.getElementById('fechamento-forma-admin').value = pedidoParaFecharAdmin.forma_pagamento || 'Dinheiro';
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
    <div style="display: flex; align-items: center; gap: 8px; padding: 6px; border-bottom: 1px solid #f0f0f0; font-size: 0.85rem; ${item.status === 'entregue' ? 'background: #f0fff4;' : ''}">
      <input type="checkbox" ${item.selecionadoFechamento ? 'checked' : ''} onchange="alternarItemFechamento(${index})" style="width:16px; height:16px;">
      <span style="flex-grow: 1; font-weight: 500;">${item.quantidade}x ${item.nome}</span>
      <span style="font-weight: bold; color: #2c3e50;">R$ ${(item.preco * item.quantidade).toFixed(2)}</span>
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
  
  recalcularTotalFechamentoAdmin();
}

async function confirmarCancelamentoDesdeFechamento() {
  if (!pedidoParaFecharAdmin) return;
  
  const pagoParcial = pedidoParaFecharAdmin.pago_parcial || 0;
  if (pagoParcial > 0) {
    return await mostrarAlerta("⚠️ Esta mesa já possui pagamentos parciais (R$ "+pagoParcial.toFixed(2)+"). Não é possível cancelar o pedido inteiro. Você deve concluir o recebimento ou estornar os pagamentos manualmente no banco.", "Aviso de Segurança");
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
      mostrarToast("❌ Pedido cancelado!"); 
      fecharModalFechamentoAdmin(); 
      carregarPedidos(); 
    }
  }
}

function recalcularTotalFechamentoAdmin() {
  const selecionados = itensFechamentoAdmin.filter(i => i.selecionadoFechamento);
  subtotalConsumoAdmin = selecionados.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);

  const cobrarTaxa = document.getElementById('fechamento-taxa-admin').checked;
  const taxa = cobrarTaxa ? subtotalConsumoAdmin * 0.10 : 0;
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
      const txtTrocoCota = trocoCota > 0 ? ` | TROCO: R$ ${trocoCota.toFixed(2)}` : '';
      if (lblCota) lblCota.textContent = `R$ ${valorPessoa.toFixed(2)}${txtTrocoCota}`;
    } else {
      btnCota.style.display = 'none';
      containerBotoes.style.gridTemplateColumns = '1fr';
    }
    const txtTrocoTudo = trocoTotal > 0 ? ` | TROCO: R$ ${trocoTotal.toFixed(2)}` : '';
    if (lblTudo) lblTudo.textContent = `R$ ${saldoRestante.toFixed(2)}${txtTrocoTudo}`;
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

  if (selecionados.length === 0) return await mostrarAlerta("Selecione pelo menos um item para pagar!", "Aviso");

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
      await mostrarAlerta("⚠️ O campo 'Valor Recebido' é obrigatório para pagamentos em Dinheiro!", "Aviso");
      const inputRec = document.getElementById('fechamento-recebido-admin');
      if (inputRec) { inputRec.focus(); inputRec.select(); }
      return;
    }
    if (valor_recebido < valorComparar) {
      await mostrarAlerta(`⚠️ Valor insuficiente! O valor a pagar é R$ ${valorComparar.toFixed(2)} e você informou R$ ${valor_recebido.toFixed(2)}.`, "Aviso");
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
      // Se num_pessoas > 1 e clicou em "FECHAR TUDO", abre o modal de multi-pagamento DIRETO
      if (num_pessoas > 1 && modo === 'tudo') {
          formasPagamentoPessoas = await mostrarModalMultiPagamento(num_pessoas, valor_por_pessoa);
          if (!formasPagamentoPessoas) return; // Se cancelar no modal, interrompe
      }

      const resFechamento = await fetch(`/api/pedidos/${idPedido}/solicitar-fechamento`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          mesa_id: idMesa, 
          forma_pagamento: forma_pagamento, 
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
        forma_pagamento: forma_pagamento,
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
    await mostrarAlerta("❌ Erro: " + error.message, "Erro");
  }
}

function imprimirCupomParcialFracao(pedido, itens, valorPago, saldoRestante, pessoasRestantes, cobrarTaxa) {
  const container = document.getElementById('cupom-impressao');
  if (!container) return;
  aplicarConfiguracaoImpressao();

  const subtotal = itens.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
  const taxa = cobrarTaxa ? subtotal * 0.10 : 0;
  const totalMesa = subtotal + taxa;
  const numPessoasTotal = (pessoasRestantes + 1);
  const mesaNomeCupom = pedido.mesa_numero ? `MESA ${pedido.mesa_numero}` : 'BALCÃO / VENDA DIRETA';

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
      <div style="display:flex; justify-content:space-between;">
        <span style="font-weight:900;">TAXA SERV (${cobrarTaxa ? '10%' : 'OFF'}):</span>
        <span style="font-weight:900;">R$ ${taxa.toFixed(2)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-size: 12pt; font-weight: 900; border-top: 2px solid #000; padding-top: 4px; margin-top: 4px;">
        <span>TOTAL A PAGAR:</span>
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

  const subtotalPagos = itensPagos.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
  const taxaPagos = cobrarTaxa ? subtotalPagos * 0.10 : 0;
  // O totalPago já vem calculado com taxa/desconto/acréscimo da função chamadora

  const html = `
    <div class="cupom-header">
      <h2 style="margin:0; font-size: 12pt; font-weight: 900;">GuGA Bebidas</h2>
      <p style="margin:2px 0; font-weight: 900; font-size: 10pt;">*** PAGAMENTO DE ITENS ***</p>
      <p style="margin:2px 0; font-weight: 900; font-size: 11pt;">MESA ${pedido.mesa_numero}</p>
      <p style="margin:2px 0; font-size: 9pt;"><strong>ABERTURA:</strong> ${formatarData(pedido.created_at)}</p>
      <p style="margin:2px 0; font-size: 8pt;"><strong>EMISSÃO:</strong> ${new Date().toLocaleString('pt-BR')}</p>
    </div>
    
    <div style="font-size: 10pt; margin-top: 10px; border-bottom: 1px solid #000; padding-bottom: 5px;">
      <p style="margin:0 0 5px 0; font-weight:900; text-align:center;">ITENS PAGOS NESTA PARCIAL</p>
      ${itensPagos.map(i => `
        <div style="display:flex; justify-content:space-between; margin-bottom: 2px;">
          <span style="flex:1; padding-right:6px; overflow:hidden; text-overflow: ellipsis; white-space:nowrap; font-weight:700;">${i.quantidade}x ${i.nome}</span>
          <span style="flex:0 0 auto; white-space:nowrap; font-weight:900;">R$ ${(i.preco * i.quantidade).toFixed(2)}</span>
        </div>
      `).join('')}
    </div>

    <div class="cupom-footer" style="font-size: 10pt;">
      <div style="display:flex; justify-content:space-between; margin-top:5px;">
        <span style="font-weight:900;">SUBTOTAL ITENS:</span>
        <span style="font-weight:900;">R$ ${subtotalPagos.toFixed(2)}</span>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span style="font-weight:900;">TAXA SERV (${cobrarTaxa ? '10%' : 'OFF'}):</span>
        <span style="font-weight:900;">R$ ${taxaPagos.toFixed(2)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-size: 12pt; font-weight: 900; border-top: 2px solid #000; padding-top: 4px; margin-top: 4px;">
        <span>TOTAL A PAGAR:</span>
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

function mostrarModalMultiPagamento(numPessoas, valorPorPessoa) {
  return new Promise(resolve => {
    const elV = document.getElementById('multi-pag-valor-pessoa');
    if (elV) elV.innerText = valorPorPessoa.toFixed(2);
    
    const container = document.getElementById('multi-pag-lista-pessoas');
    if (!container) return resolve(null);

    container.innerHTML = '';
    for (let i = 1; i <= numPessoas; i++) {
      container.innerHTML += `
        <div class="multi-pag-card" style="background: #f8f9fa; padding: 12px; border-radius: 10px; border: 1px solid #dee2e6; margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <strong style="color: #2c3e50; font-size: 1rem;">👤 Pessoa ${i}:</strong>
            <select class="multi-pag-forma-select" data-index="${i}" onchange="toggleMultiPagDinheiro(${i}, this.value)" style="padding: 8px; border-radius: 6px; border: 1px solid #cbd5e0; font-size: 0.95rem; font-weight: bold; background: white;">
              <option value="Dinheiro">💵 Dinheiro</option>
              <option value="Pix">📱 Pix</option>
              <option value="Cartão">💳 Cartão</option>
            </select>
          </div>
          
          <div id="multi-pag-dinheiro-container-${i}" style="display: flex; gap: 10px; align-items: center; padding-top: 8px; border-top: 1px dashed #cbd5e0; transition: 0.3s opacity;">
            <div style="flex: 1;">
              <label style="display:block; font-size: 0.7rem; font-weight: bold; color: #64748b; margin-bottom: 2px;">VALOR RECEBIDO:</label>
              <input type="number" step="0.01" class="multi-pag-recebido-input" 
                     oninput="calcularTrocoMultiPag(${i}, ${valorPorPessoa})" 
                     id="multi-pag-recebido-${i}" 
                     value="${valorPorPessoa.toFixed(2)}" 
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
          mostrarAlerta(`⚠️ Pessoa ${i}: Valor recebido insuficiente!`, "Aviso");
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
  if (select) select.innerHTML = cardapio.map(item => `<option value="${item.id}">${item.nome} - R$ ${item.preco.toFixed(2)}</option>`).join('');
  
  // Atualiza as interfaces que dependem do cardápio/estoque em tempo real
  if (abaAtiva === 'configuracoes') exibirMenuConfig();
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
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(tit, { 
      body: msg,
      tag: tagId, // Evita empilhamento: nova notificação da mesma tag substitui a antiga
      renotify: true,
      silent: !somWindows 
    }); 
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
      forceTLS: true
    });    
    pusherInstancia.connection.bind('connected', () => {
      console.log('✅ Admin conectado ao Pusher com sucesso!');
    });

    pusherInstancia.connection.bind('error', function(err) {
      console.warn('❌ Erro de conexão no Pusher (Admin):', err);
    });

    const channel = pusherInstancia.subscribe('garconnexpress');
    console.log('📺 Admin inscrito no canal: garconnexpress');

  channel.bind('pedido-pronto', (data) => {
    console.log('📢 Admin: Pedido pronto!', data);
    tocarNotificacao(); iniciarPiscarTitulo();
    exibirNotificacaoNativa('👨‍🍳 PEDIDO PRONTO', data.mensagem, `mesa-${data.mesa_id}`);
    
    // Mostra apenas alerta informativo (sem o botão de entregar agora no modal)
    mostrarAlerta(data.mensagem, "👨‍🍳 Cozinha");

    clearTimeout(timeoutPusher); timeoutPusher = setTimeout(() => carregarPedidos(), 500);
  });

  channel.bind('novo-pedido', (data) => {
    console.log('📢 Admin: Novo pedido recebido!', data);
    tocarNotificacao(); iniciarPiscarTitulo();
    exibirNotificacaoNativa('🚀 NOVO PEDIDO', `Mesa ${data.pedido.mesa_numero} acabou de fazer um pedido.`, `mesa-${data.pedido.mesa_id}`);
    mostrarToast(`🚀 NOVO PEDIDO: Mesa ${data.pedido.mesa_numero}`);
    clearTimeout(timeoutPusher); timeoutPusher = setTimeout(() => carregarPedidos(), 500);
  });

  channel.bind('status-atualizado', (data) => {
    console.log('📢 Admin: Status atualizado recebido!', data);
    if (!data) return;

    const mesaData = data.mesa_numero || data.mesa_id || 'X';
    const nMesa = isNaN(mesaData) ? mesaData : `Mesa ${mesaData}`;
    const tagMesa = `mesa-${data.mesa_id}`;

    // Se for liberação de mesa
    if (data.status === 'liberada') {
        tocarNotificacao();
        exibirNotificacaoNativa('✅ Mesa Liberada', `${nMesa} está livre para o próximo cliente.`, tagMesa);
        mostrarToast(`✅ ${nMesa} liberada`);
        clearTimeout(timeoutPusher); timeoutPusher = setTimeout(() => carregarPedidos(), 500);
        return;
    }

    if (data.status === 'itens_adicionados') {
        tocarNotificacao();
        exibirNotificacaoNativa('📝 Novos itens!', `${nMesa} adicionou novos produtos ao pedido.`, tagMesa);
        mostrarToast(`📝 ${nMesa} adicionou itens`);
        pedidoAtualizadoId = data.pedido_id;
        clearTimeout(timeoutPusher); timeoutPusher = setTimeout(() => carregarPedidos(), 500);
        return;
    }

    let tit = 'Atualização!';
    let msg = 'Verifique o painel de pedidos.';

    if (data.status === 'aguardando_fechamento') {
        tit = `🛎️ Fechamento ${nMesa}`;
        msg = 'O cliente solicitou o fechamento da conta.';
        tocarNotificacao(); // Agora toca som no fechamento!
    }
    else if (data.status === 'servido') {
        tit = `🚚 ${nMesa} servida!`;
        msg = 'Todos os itens pendentes foram entregues.';
    }
    else if (data.status === 'itens_atualizados') {
        tit = `📝 Pedido da ${nMesa} editado`;
        msg = 'A lista de itens do pedido foi alterada.';
    }
    else if (data.status === 'cancelado') {
        tit = `❌ Pedido da ${nMesa} CANCELADO`;
        msg = 'O pedido foi removido do sistema.';
    }

    exibirNotificacaoNativa(tit, msg, tagMesa);
    mostrarToast(tit);
    tocarNotificacao(); // Toca som para qualquer atualização de status
    clearTimeout(timeoutPusher); timeoutPusher = setTimeout(() => carregarPedidos(), 500);
  });

  channel.bind('status-caixa-atualizado', (data) => {
    console.log('📢 Admin: Status do caixa atualizado', data);
    tocarNotificacao();
    // Adicione aqui qualquer função de recarga de caixa se necessário
  });

  channel.bind('menu-atualizado', (data) => {
    console.log('📢 Admin: Menu atualizado recebido!', data);
    carregarCardapio();
  });
  } catch (e) { console.warn('Pusher init error:', e); }
}

function tocarNotificacao() {
  const somMP3 = localStorage.getItem('admin_som_mp3_ativo') !== 'false';
  
  if (audioDesbloqueado && somMP3) {
    audioNotificacao.currentTime = 0;
    audioNotificacao.play().catch(e => {
        console.warn('Erro ao tocar som MP3 (tentando nova instância):', e);
        const fallbackAudio = new Audio('/notificacao.mp3');
        fallbackAudio.play().catch(err => console.error('Falha crítica de áudio:', err));
    });
  }
}

function inicializarConfiguracaoSom() {
  atualizarIconeSomAdmin();
}

function atualizarIconeSomAdmin() {
  const checkMP3 = document.getElementById('check-som-mp3');
  const checkWin = document.getElementById('check-som-windows');
  
  const somMP3 = localStorage.getItem('admin_som_mp3_ativo') !== 'false';
  const somWin = localStorage.getItem('admin_som_windows') === 'true';

  if (checkMP3) checkMP3.checked = somMP3;
  if (checkWin) checkWin.checked = somWin;

  // Sincroniza o mudo do objeto de áudio principal
  audioNotificacao.muted = !somMP3;
}

function alternarSomMP3() {
  const check = document.getElementById('check-som-mp3');
  const ativo = check ? check.checked : true;
  localStorage.setItem('admin_som_mp3_ativo', ativo);
  atualizarIconeSomAdmin();
  if (ativo) tocarNotificacao(); // Som de teste
}

function alternarSomWindows() {
  const check = document.getElementById('check-som-windows');
  const ativo = check ? check.checked : false;
  localStorage.setItem('admin_som_windows', ativo);
  atualizarIconeSomAdmin();
  if (ativo) {
    exibirNotificacaoNativa("🔊 TESTE DE SOM", "O som do Windows está agora ativado para notificações.");
  }
}

function mostrarToast(msg) {
  const old = document.querySelector('.toast-notificacao'); if (old) old.remove();
  const t = document.createElement('div'); 
  t.className = 'toast-notificacao';
  t.textContent = msg; // Usar textContent em vez de innerText/innerHTML
  document.body.appendChild(t);
  setTimeout(() => { t.classList.add('show'); setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 500); }, 4000); }, 100);
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
  const taxa = cobrarTaxaNoCupom ? subtotal * 0.10 : 0;
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

  const mesaNomeCupom = pedido.mesa_numero ? `MESA ${pedido.mesa_numero}` : 'BALCÃO / VENDA DIRETA';
  
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

  const html = `
    <div class="cupom-header" style="text-align: center; border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px;">
      <h2 style="margin:0; font-size: 14pt; font-weight: 900;">GuGA Bebidas</h2>
      <p style="margin:2px 0; font-size: 10pt; font-weight: 700;">
        ${pedido.status === 'cancelado' ? '*** PEDIDO CANCELADO ***' : (isConferencia ? '*** CONTA PARCIAL ***' : 'Comprovante de Pedido')}
      </p>
      <p style="margin:2px 0; font-weight: 900; font-size: 12pt;">${mesaNomeCupom}</p>
      <p style="margin:2px 0; font-size: 9pt;"><strong>ABERTURA:</strong> ${formatarData(pedido.created_at)}</p>
      <p style="margin:2px 0; font-size: 8pt;"><strong>EMISSÃO:</strong> ${new Date().toLocaleString('pt-BR')}</p>
      ${numPessoasExibicao > 1 ? `<p style="margin:2px 0; font-size: 10pt; font-weight:bold;">DIVIDIDO POR: ${numPessoasExibicao} PESSOAS</p>` : ''}
    </div>
    
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
      <div style="display:flex; justify-content:space-between; opacity: 0.8; font-size: 9pt;">
        <span>TAXA SERV (${cobrarTaxaNoCupom ? '10%' : 'OFF'}):</span>
        <span>R$ ${taxa.toFixed(2)}</span>
      </div>
      ${acrescimo > 0 ? `<div style="display:flex; justify-content:space-between; opacity: 0.8; font-size: 9pt;"><span>ACRÉSCIMO:</span><span>R$ ${acrescimo.toFixed(2)}</span></div>` : ''}
      ${desconto > 0 ? `<div style="display:flex; justify-content:space-between; opacity: 0.8; font-size: 9pt;"><span>DESCONTO:</span><span>- R$ ${desconto.toFixed(2)}</span></div>` : ''}
      
      <div style="display:flex; justify-content:space-between; font-weight: bold; margin-top: 2px; border-top: 1px solid #eee; padding-top: 2px; font-size: 9pt; opacity: 0.9;">
        <span>${isReimpressaoHistorico ? 'VALOR TOTAL DA MESA:' : 'TOTAL DA CONTA:'}</span>
        <span>R$ ${totalGeralMesa.toFixed(2)}</span>
      </div>

      <div style="display:flex; justify-content:space-between; font-weight: 900; margin-top: 5px; font-size: 13pt; border-top: 2px solid #000; padding-top: 4px; background: #eee;">
        <span>${isReimpressaoHistorico ? 'TOTAL PAGO:' : 'TOTAL A PAGAR:'}</span>
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
  if (!caixaAtual) return await mostrarAlerta('Nenhum caixa aberto para imprimir.', "Aviso");

  const container = document.getElementById('cupom-impressao');
  if (!container) return;
  aplicarConfiguracaoImpressao();

  const totalEsperadoDinheiro = caixaAtual.valor_inicial + caixaAtual.total_dinheiro;
  const totalGeral = caixaAtual.total_vendas;

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

      <div style="border-top: 1px dashed #000; padding-top: 8px; margin-top: 10px;">
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
                mostrarToast("✅ Pedido cancelado!");
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
  const mesaNome = pedido.mesa_numero ? 'Mesa ' + pedido.mesa_numero : 'Balcão';
  const mesaId = pedido.mesa_id;
  
  // 1. DADOS BÁSICOS E CORES
  document.getElementById('modal-opcoes-titulo').innerText = mesaNome;
  document.getElementById('modal-opcoes-info').innerText = `Pedido #${pedido.id} | Garçom: ${pedido.garcom_id || 'Admin'}`;
  
  // Exibir observação do pedido se existir
  const infoExtra = document.getElementById('modal-opcoes-info-extra');
  if (infoExtra) {
    infoExtra.innerHTML = pedido.observacao ? `<div style="background:#fff3cd; color:#856404; padding:8px 12px; border-radius:8px; margin-top:10px; font-weight:bold; font-size:0.9rem; border:1px solid #ffeeba;">📝 OBS: ${pedido.observacao}</div>` : '';
  }
  
  const headerBg = document.getElementById('modal-opcoes-header-bg');
  const itens = await fetch(`/api/pedidos/${pedidoId}/itens`).then(res => res.json());
  const hasPend = itens.some(i => i.status === 'pendente' || i.status === 'pronto');
  const isAguardando = pedido.status === 'aguardando_fechamento';
  
  // Cores dinâmicas conforme status
  if (isAguardando) headerBg.style.background = '#f1c40f'; // Amarelo Atenção
  else if (hasPend) headerBg.style.background = '#e74c3c'; // Vermelho Pendente
  else headerBg.style.background = '#27ae60'; // Verde Servido

  // 2. TOTAIS E TAXA
  const cobrarTaxaNoPedido = (pedidosStatusTaxa[pedidoId] !== undefined) ? pedidosStatusTaxa[pedidoId] : (pedido.cobrar_taxa || true);
  const subtotal = itens.reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
  const taxaServico = cobrarTaxaNoPedido ? (subtotal * 0.10) : 0;
  const pagoParcial = pedido.pago_parcial || 0;
  const totalExibicao = (pedido.status === 'aguardando_fechamento' ? pedido.total : (subtotal + taxaServico - pagoParcial)) || 0;

  // DETALHES DA SOLICITAÇÃO DE CONTA
  let htmlPagamentoModal = '';
  if (isAguardando && pedido.forma_pagamento) {
    htmlPagamentoModal = `
      <div style="background:#fff9db; padding:12px; border-radius:10px; margin-top:10px; font-size:0.9rem; border:2px solid #d4af37; color:#854d0e;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
           <strong>💰 SOLICITAÇÃO DE CONTA</strong>
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
      htmlItens += `
        <div style="border-left:4px solid ${isPronto ? '#2ecc71' : '#e74c3c'}; background:white; border-radius:8px; padding:8px 12px; margin-bottom:6px; border:1px solid ${isPronto ? '#d4edda' : '#fee2e2'}; display:flex; justify-content:space-between; align-items:center;">
          <div style="flex: 1;">
            <span style="font-weight: 700; font-size: 0.9rem;">${i.quantidade}x ${i.nome}</span>
            ${isPronto ? '<br><small style="color:#27ae60; font-weight:bold;">🔥 PRONTO</small>' : ''}
            ${i.observacao ? `<br><small style="color:#d35400; font-weight:bold; font-size:0.75rem;">📝 ${i.observacao}</small>` : ''}
          </div>
          <span style="font-size: 0.8rem; font-weight: 900; color: ${isPronto ? '#27ae60' : '#e74c3c'};">R$ ${(i.preco * i.quantidade * (cobrarTaxaNoPedido ? 1.1 : 1)).toFixed(2)}</span>
        </div>
      `;
    });
  }
  if (itensEntregues.length > 0) {
    htmlItens += `<small style="color: #27ae60; font-weight: 900; display:block; margin: 10px 0 5px 0;">✅ NA MESA:</small>`;
    itensEntregues.forEach(i => {
      htmlItens += `
        <div style="border-left:4px solid #27ae60; background:white; border-radius:8px; padding:8px 12px; margin-bottom:6px; border:1px solid #dcfce7; display:flex; justify-content:space-between; align-items:center; opacity: 0.7;">
          <div style="flex: 1;">
            <span style="font-size: 0.85rem;">${i.quantidade}x ${i.nome}</span>
            ${i.observacao ? `<br><small style="color:#d35400; font-weight:bold; font-size:0.7rem;">📝 ${i.observacao}</small>` : ''}
          </div>
          <span style="font-size: 0.75rem; font-weight: bold; color: #27ae60;">R$ ${(i.preco * i.quantidade * (cobrarTaxaNoPedido ? 1.1 : 1)).toFixed(2)}</span>
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
        💰 CONFIRMAR PAGAMENTO E LIBERAR
      </button>
    `;
  } else {
    // SEMPRE MOSTRA OS DOIS BOTÕES SE NÃO ESTIVER AGUARDANDO FECHAMENTO, PARA EVITAR MUDANÇAS REPETINAS
    htmlFooter = `
      <div style="display:flex; gap:10px;">
        <button onclick="fecharModalOpcoes(); marcarPedidoEntregue(${pedidoId})" style="background:#e67e22; flex: 1.5; color:white; border:none; padding:15px; font-weight:bold; border-radius:10px; box-shadow:0 4px 0 #d35400; cursor:pointer; ${!hasPend ? 'opacity:0.5; pointer-events:none;' : ''}">🚚 ENTREGAR TUDO</button>
        <button onclick="fecharModalOpcoes(); aprovarFechamento(${pedidoId}, ${mesaId})" style="background:#7f8c8d; flex: 1; color:white; border:none; padding:15px; font-weight:bold; border-radius:10px; box-shadow:0 4px 0 #707b7c; cursor:pointer; font-size:0.8rem;">🔓 LIBERAR MESA</button>
      </div>
    `;
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
