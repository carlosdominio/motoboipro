window.onerror = function(msg, url, line) {
    console.error("ERRO GLOBAL:", msg, "em", url, "linha:", line);
    // Se quiser mostrar um alerta na tela para o usuário saber que deu erro:
    // alert("Erro no sistema: " + msg);
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
let tipoDescontoAdmin = 'porcentagem'; // Ativado por padrão como porcentagem

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
  document.querySelectorAll('.sub-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`tab-sub-${sub}`).classList.add('active');
  
  document.querySelectorAll('.sub-tab-content').forEach(content => content.classList.add('hidden'));
  document.getElementById(`group-${sub}`).classList.remove('hidden');
  
  // Estilo visual dos botões
  document.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.style.background = 'transparent';
    btn.style.color = '#7f8c8d';
  });
  const activeBtn = document.getElementById(`tab-sub-${sub}`);
  activeBtn.style.background = sub === 'garcom' ? '#3498db' : '#27ae60';
  activeBtn.style.color = 'white';
}
let caixaAtual = null;

const audioNotificacao = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
let audioDesbloqueado = false;
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

function iniciarPainelAdmin() {
  inicializarConfiguracaoImpressao();
  inicializarConfiguracaoSom(); 
  solicitarPermissaoNotificacao();
  
  // Define o estado inicial padrão
  abaAtiva = 'ativos';
  subAbaAtiva = 'garcom';
  switchTab('ativos'); 
  switchSubTab('garcom');

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
  }, 60000);
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
    itensEmEdicao[index].quantidade = novaQtd; 
    renderizarItensEdicao(); 
  }
}

function removerItemEdicao(index) { 
  itensEmEdicao.splice(index, 1); 
  renderizarItensEdicao(); 
}

function calcularMinutos(dataIso) {
  if (!dataIso) return 0;
  const isoStr = dataIso.replace(' ', 'T');
  const data = new Date(isoStr);
  const agora = new Date();
  const diffMs = agora - data;
  return Math.floor(diffMs / 60000);
}

function atualizarCronometrosPedidos() {
  if (abaAtiva !== 'ativos') return;
  const container = document.getElementById('pedidos-list');
  if (!container) return;

  const spans = container.querySelectorAll('.pedido-cronometro');
  spans.forEach((span) => {
    const card = span.closest('.pedido-card');
    const createdAt = span.dataset.createdAt;
    const isRecebido = !!card && card.classList.contains('status-recebido');

    if (!isRecebido || !createdAt) {
      span.style.display = 'none';
      if (card) card.classList.remove('alerta-borda-pisca');
      return;
    }

    const minutos = calcularMinutos(createdAt);
    span.textContent = `⏱️ ${minutos} min`;
    span.style.display = '';
    card.classList.toggle('alerta-borda-pisca', minutos >= 10);
  });
}

function switchTab(tab) {
  abaAtiva = tab;
  
  // Remove classe active de todos os botões
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  
  // Tenta encontrar o botão correspondente à aba e ativa-o (funciona para chamadas manuais e automáticas)
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
  if (tab === 'ativos') carregarPedidos();
  else if (tab === 'historico') carregarHistorico();
  else if (tab === 'configuracoes') carregarDadosConfig();
  else if (tab === 'caixa') carregarStatusCaixa();
  else if (tab === 'lancar') prepararLancarPedido();
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
  container.innerHTML = itens.map(item => `
    <div class="item-menu-mini" onclick="adicionarAoCarrinhoLancar(${item.id})">
      <img src="${item.imagem}" alt="${item.nome}">
      <h4>${item.nome}</h4>
      <p>R$ ${item.preco.toFixed(2)}</p>
      ${item.estoque !== -1 ? `<small style="display:block; font-size:0.7rem; color:${item.estoque <= 0 ? '#e74c3c' : '#7f8c8d'}">Estoque: ${item.estoque}</small>` : ''}
    </div>
  `).join('');
}

async function adicionarAoCarrinhoLancar(itemId) {
  const item = cardapio.find(m => m.id === itemId);
  if (!item) return;
  if (item.estoque === 0) return await mostrarAlerta("Item esgotado!", "Estoque");

  const exist = carrinhoLancar.find(c => c.menu_id === itemId);
  if (exist) {
    if (item.estoque !== -1 && exist.quantidade + 1 > item.estoque) return await mostrarAlerta("Limite de estoque atingido!", "Estoque");
    exist.quantidade++;
  } else {
    carrinhoLancar.push({ menu_id: item.id, nome: item.nome, preco: item.preco, quantidade: 1 });
  }
  renderizarCarrinhoLancar();
}

function renderizarCarrinhoLancar() {
  const container = document.getElementById('lancar-carrinho');
  if (!container) return;
  
  const cobrarTaxa = document.getElementById('lancar-taxa-toggle') ? document.getElementById('lancar-taxa-toggle').checked : true;

  if (carrinhoLancar.length === 0) {
    container.innerHTML = '<p style="text-align: center; margin-top: 2rem; opacity: 0.5;">Adicione itens do cardápio...</p>';
    document.getElementById('lancar-total').innerText = 'Total: R$ 0,00';
    return;
  }
  let subtotal = 0;
  container.innerHTML = carrinhoLancar.map((item, index) => {
    subtotal += item.preco * item.quantidade;
    return `
      <div class="item-edicao">
        <div style="flex-grow:1;"><strong>${item.nome}</strong></div>
        <div style="display:flex; align-items:center; gap:0.5rem">
          <input type="number" value="${item.quantidade}" min="1" style="width:45px;" onchange="alterarQtdCarrinhoLancar(${index}, this.value)">
          <button class="btn-remover-item" onclick="removerDoCarrinhoLancar(${index})">X</button>
        </div>
      </div>`;
  }).join('');
  
  const total = cobrarTaxa ? subtotal * 1.10 : subtotal;
  document.getElementById('lancar-total').innerText = `Total: R$ ${total.toFixed(2)}`;
}

async function alterarQtdCarrinhoLancar(index, qtd) {
  const novaQtd = parseInt(qtd);
  const itemMenu = cardapio.find(m => m.id === carrinhoLancar[index].menu_id);
  if (itemMenu && itemMenu.estoque !== -1 && novaQtd > itemMenu.estoque) {
    await mostrarAlerta("Estoque insuficiente!", "Estoque");
    renderizarCarrinhoLancar();
    return;
  }
  if (novaQtd > 0) { carrinhoLancar[index].quantidade = novaQtd; renderizarCarrinhoLancar(); }
}

function removerDoCarrinhoLancar(index) { carrinhoLancar.splice(index, 1); renderizarCarrinhoLancar(); }

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

      document.getElementById('btn-decisao-fechar').onclick = () => {
        modalDecisao.style.display = 'none';
        aprovarFechamento(novoPedidoId, mesaId, nomeMesa);
      };

      document.getElementById('btn-decisao-manter').onclick = () => {
        modalDecisao.style.display = 'none';
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
  
  const valorFinal = caixaAtual.valor_inicial + caixaAtual.total_dinheiro + caixaAtual.total_pix + caixaAtual.total_cartao;
  
  const res = await fetch('/api/caixa/fechar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: caixaAtual.id, valor_final: valorFinal })
  });
  
  if (res.ok) {
    await mostrarAlerta(`Caixa fechado!\nTotal de Vendas: R$ ${caixaAtual.total_vendas.toFixed(2)}\nDinheiro em Caixa: R$ ${(caixaAtual.valor_inicial + caixaAtual.total_dinheiro).toFixed(2)}`, "Sucesso");
    
    // Zera os indicadores de faturamento e vendas no topo imediatamente
    const elFat = document.getElementById('faturamento-resumo');
    const elVendas = document.getElementById('vendas-dia-resumo');
    if (elFat) elFat.innerText = `R$ 0,00`;
    if (elVendas) elVendas.innerText = `R$ 0,00`;
    
    carregarStatusCaixa();
  } else {
    const err = await res.json();
    await mostrarAlerta("⚠️ Erro ao fechar caixa: " + (err.error || "Erro desconhecido"), "Erro");
  }
}

async function carregarDadosConfig() {
  await Promise.all([exibirMesasConfig(), exibirGarconsConfig(), exibirMenuConfig()]);
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
          <span>📂 ${cat}</span>
          <small style="font-size: 0.8rem; opacity: 0.8;">${itensDaCat.length} itens</small>
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

function prepararEdicaoMenu(item) {
  idItemEdicaoMenu = item.id;
  document.getElementById('menu-nome').value = item.nome;
  document.getElementById('menu-cat').value = item.categoria;
  document.getElementById('menu-preco').value = item.preco;
  document.getElementById('menu-estoque').value = item.estoque;
  document.getElementById('menu-validade').value = item.validade || '';
  document.getElementById('menu-img').value = item.imagem;
  document.getElementById('btn-acao-menu').textContent = "💾 Salvar";
  document.getElementById('btn-acao-menu').style.background = "#e67e22";
  document.getElementById('btn-cancelar-menu').classList.remove('hidden');
}

function cancelarEdicaoMenu() {
  idItemEdicaoMenu = null;
  ['menu-nome', 'menu-cat', 'menu-preco', 'menu-img', 'menu-estoque', 'menu-validade'].forEach(id => { const el = document.getElementById(id); if (el) el.value = (id === 'menu-estoque' ? '-1' : ''); });
  document.getElementById('btn-acao-menu').textContent = "Adicionar Item";
  document.getElementById('btn-acao-menu').style.background = "#27ae60";
  document.getElementById('btn-cancelar-menu').classList.add('hidden');
}

async function processarAcaoMenu() {
  const nome = document.getElementById('menu-nome').value;
  const categoria = document.getElementById('menu-cat').value;
  const preco = parseFloat(document.getElementById('menu-preco').value);
  const estoque = parseInt(document.getElementById('menu-estoque').value);
  const validade = document.getElementById('menu-validade').value;
  const imagem = document.getElementById('menu-img').value || 'https://placehold.co/100';
  if (!nome || !categoria || isNaN(preco) || isNaN(estoque)) return await mostrarAlerta("Preencha corretamente", "Aviso");
  const payload = { nome, categoria, preco, imagem, estoque, validade };
  const res = await fetch(idItemEdicaoMenu ? `/api/menu/${idItemEdicaoMenu}` : '/api/menu', { method: idItemEdicaoMenu ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (res.ok) { mostrarToast("Menu atualizado!"); cancelarEdicaoMenu(); carregarCardapio(); }
}

async function excluirDoMenu(id) {
  if (await mostrarConfirmacao("Excluir item do cardápio?", "Configuração")) { await fetch(`/api/menu/${id}`, { method: 'DELETE' }); carregarCardapio(); }
}

async function carregarHistorico() {
  const res = await fetch('/api/pedidos/historico');
  if (!res.ok) return;
  historico = await res.json();
  exibirHistorico();
}

async function exibirHistorico() {
  const container = document.getElementById('historico-list');
  if (!container) return;
  container.innerHTML = '';
  
  const dataHoje = new Date().toLocaleDateString('pt-BR');
  document.getElementById('data-historico').innerText = dataHoje;

  let faturamentoTotal = 0;

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
          <span>• ${item.quantidade}x ${item.nome}</span>
          ${item.observacao ? `<br><small style="color:#e67e22; margin-left:15px;">Obs: ${item.observacao}</small>` : ''}
        </div>`).join('')}</div>
      ${htmlPagamentos}
    `;
    container.appendChild(card);
  }
  document.getElementById('faturamento-total-dia').innerText = `Faturamento Concluído: R$ ${faturamentoTotal.toFixed(2)}`;
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
  
  let totalDinheiro = 0;
  let totalPix = 0;
  let totalCartao = 0;
  let totalCancelado = 0;
  let totalGeral = 0;
  let qtdPedidos = 0;

  historico.forEach(p => {
    if (p.status === 'entregue') {
      qtdPedidos++;
      totalGeral += p.total;
      if (p.forma_pagamento === 'Dinheiro') totalDinheiro += p.total;
      else if (p.forma_pagamento === 'Pix') totalPix += p.total;
      else totalCartao += p.total;
    } else if (p.status === 'cancelado') {
      totalCancelado += p.total;
    }
  });

  const html = `
    <div style="width: 100%; font-size: 10pt; line-height: 1.3; color: #000; background: #fff; padding: 0; font-weight: 600;">
      <div style="text-align: center; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
        <h1 style="margin: 0; font-size: 12pt; font-weight: 900;">GuGA Bebidas</h1>
        <p style="margin: 2px 0; font-weight: bold;">*** RESUMO DE VENDAS ***</p>
        <p style="margin: 2px 0;">DATA: ${dataHoje}</p>
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
        <span>(Cancelados: R$ ${totalCancelado.toFixed(2)})</span>
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
async function exibirPedidos() {
  if (isRenderingPedidos || abaAtiva !== 'ativos') return;
  const listGarcom = document.getElementById('pedidos-list-garcom');
  const listBalcao = document.getElementById('pedidos-list-balcao');
  if (!listGarcom || !listBalcao) return;
  
  isRenderingPedidos = true;
  listGarcom.innerHTML = '';
  listBalcao.innerHTML = '';

  let countGarcom = 0;
  let countBalcao = 0;

  try {
    for (const pedido of pedidos) {
      if (pedidosStatusTaxa[pedido.id] === undefined) {
        pedidosStatusTaxa[pedido.id] = (pedido.cobrar_taxa !== undefined) ? pedido.cobrar_taxa : true;
      }
      const cobrarTaxaNoPedido = pedidosStatusTaxa[pedido.id];

      const itens = await fetch(`/api/pedidos/${pedido.id}/itens`).then(res => res.json());
      const totalEnt = itens.filter(i => i.status === 'entregue').reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
      const totalPend = itens.filter(i => i.status === 'pendente').reduce((sum, i) => sum + (i.preco * i.quantidade), 0);
      const hasPend = itens.some(i => i.status === 'pendente');
      const statusGeral = hasPend ? 'recebido' : 'servido';

      let minutosCronometro = null;
      let classeAlertaAtraso = '';
      if (statusGeral === 'recebido' && pedido.created_at) {
        minutosCronometro = calcularMinutos(pedido.created_at);
        if (minutosCronometro >= 10) classeAlertaAtraso = 'alerta-borda-pisca';
      }

      const subtotal = totalEnt + totalPend;
      const taxaServico = cobrarTaxaNoPedido ? (subtotal * 0.10) : 0;
      const pagoParcial = pedido.pago_parcial || 0;
      const totalConsumo = (subtotal + taxaServico);
      const totalExibicao = (pedido.status === 'aguardando_fechamento' ? pedido.total : (totalConsumo - pagoParcial)) || 0;
      
      const infoPagamento = (pedido.status === 'aguardando_fechamento' && pedido.forma_pagamento) ? `
        <div style="background:#f9f9f9; padding:5px; border-radius:4px; margin-top:5px; font-size:0.85rem; border:1px solid #ddd;">
          <strong>Pagamento:</strong> ${pedido.forma_pagamento}<br>
          ${(pedido.forma_pagamento === 'Dinheiro') ? `<strong>Recebido:</strong> R$ ${(pedido.valor_recebido || 0).toFixed(2)} | <strong>Troco:</strong> R$ ${(pedido.troco || 0).toFixed(2)}` : ''}
          ${(pedido.desconto > 0) ? `<br><span style="color:#e74c3c;"><strong>Desconto:</strong> - R$ ${pedido.desconto.toFixed(2)}</span>` : ''}
          ${(pedido.acrescimo > 0) ? `<br><span style="color:#27ae60;"><strong>Acréscimo:</strong> + R$ ${pedido.acrescimo.toFixed(2)}</span>` : ''}
        </div>` : '';

      const card = document.createElement('div');
      card.className = `pedido-card status-${statusGeral} ${pedido.id === pedidoAtualizadoId ? 'destaque-atualizacao' : ''} ${classeAlertaAtraso}`;
      card.dataset.pedidoId = pedido.id;
      const mesaNomeExibicao = pedido.mesa_numero ? `Mesa ${pedido.mesa_numero}` : 'BALCÃO';
      card.innerHTML = `
        <div class="pedido-header">
          <div>
            <h3>${mesaNomeExibicao} <span class="pedido-cronometro" data-created-at="${pedido.created_at || ''}" style="margin-left:10px; font-size:0.9rem; background:#eee; padding:2px 6px; border-radius:4px; color:#333; ${minutosCronometro === null ? 'display:none;' : ''}">⏱️ ${minutosCronometro === null ? '' : `${minutosCronometro} min`}</span></h3>
            <span class="status-badge ${statusGeral}">${statusGeral === 'servido' ? 'EM ANDAMENTO' : statusGeral.toUpperCase()}</span>
            <small style="display:block; margin-top:4px;">📅 ${formatarData(pedido.created_at)}</small>
            <small style="display:block; font-weight:bold; color: #2c3e50;">👤 Garçom: ${pedido.garcom_id || 'N/I'}</small>
          </div>
          <div style="text-align:right">
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
              <button class="btn-imprimir-parcial-rapido" onclick="imprimirParcialMesaRapido(${pedido.id})" title="Imprimir Nota Parcial">
                🖨️ PARCIAL: R$ ${totalExibicao.toFixed(2)}
              </button>
              
              <div class="toggle-container" title="${pagoParcial > 0 ? 'Bloqueado: Mesa com pagamento parcial' : ''}">
                <span>10%</span>
                <label class="switch" style="${pagoParcial > 0 ? 'opacity: 0.5; cursor: not-allowed;' : ''}">
                  <input type="checkbox" ${cobrarTaxaNoPedido ? 'checked' : ''} 
                         ${pagoParcial > 0 ? 'disabled' : ''} 
                         onchange="alternarTaxaPedido(${pedido.id}, this)">
                  <span class="slider"></span>
                </label>
              </div>
            </div>
            <div data-role="pedido-subtotais" style="font-size:0.75rem; color:#7f8c8d; border-top:1px solid #eee; margin-top:3px;">
              Consumo: R$ ${totalConsumo.toFixed(2)} ${pagoParcial > 0 ? `<br><span style="color:#27ae60; font-weight:bold;">(-) Já Pago: R$ ${pagoParcial.toFixed(2)}</span>` : ''}
            </div>
          </div>
        </div>
        
        ${infoPagamento}
        
        <div class="pedido-itens">
          ${itens.map(item => `
            <div class="pedido-item" style="${item.status === 'entregue' ? 'opacity:0.5; background:#f0fff4; text-decoration: line-through;' : 'border-left:3px solid #e74c3c; background:#fff5f5;'} border-radius:4px; padding:4px 8px; margin-bottom:4px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong>${item.quantidade}x ${item.nome}</strong>
                <span style="font-size:0.7rem; font-weight:bold; color:${item.status === 'entregue' ? '#27ae60' : '#e74c3c'}; text-decoration: none !important; display: inline-block;">
                  ${item.status === 'entregue' ? '✓ NA MESA' : '⏳ PENDENTE'}
                </span>
              </div>
              ${item.observacao ? `<small style="text-decoration: none !important; color:#e67e22; display:block;">Obs: ${item.observacao}</small>` : ''}
            </div>
          `).join('')}
        </div>
        
        <div class="pedido-footer">
          <div style="display:flex; gap:0.5rem; flex-grow: 1;">
            <button style="background:#3498db; flex: 1;" onclick='abrirModalEdicao(${JSON.stringify(pedido)}, ${JSON.stringify(itens)})'>✏️ EDITAR / ADD ITENS</button>
          </div>
          
          <div class="pedido-actions" style="width: 100%; margin-top: 10px;">
            ${pedido.status === 'aguardando_fechamento' ? 
              `<button style="background:#27ae60; font-size:1rem; border:2px solid #fff; padding: 1rem; width: 100%;" onclick="aprovarFechamento(${pedido.id}, ${pedido.mesa_id})">💰 CONFIRMAR PAGAMENTO E LIBERAR</button>` : 
              `<div style="display:flex; gap:0.5rem;">
                ${hasPend ? `<button style="background:#e67e22; flex: 1;" onclick="marcarPedidoEntregue(${pedido.id})">🚚 ENTREGAR TUDO</button>` : ''}
                <button style="background:#7f8c8d; flex: 1;" onclick="liberarMesa(${pedido.id}, ${pedido.mesa_id}, ${hasPend})">🔓 LIBERAR MESA E FECHAR CONTA</button>
              </div>`
            }
          </div>
        </div>`;
      
      if (pedido.garcom_id === 'ADMIN') {
        listBalcao.appendChild(card);
        countBalcao++;
      } else {
        listGarcom.appendChild(card);
        countGarcom++;
      }
    }

    const bGarcom = document.getElementById('badge-sub-garcom');
    const bBalcao = document.getElementById('badge-sub-balcao');
    if (bGarcom) bGarcom.textContent = countGarcom;
    if (bBalcao) bBalcao.textContent = countBalcao;

    const emptyStateGarcom = `
      <div class="empty-state-container">
        <div class="empty-state-icon">🪑</div>
        <div class="empty-state-title">Nenhuma mesa aberta</div>
        <div class="empty-state-subtitle">Os pedidos feitos pelos garçons aparecerão aqui.</div>
      </div>
    `;

    const emptyStateBalcao = `
      <div class="empty-state-container">
        <div class="empty-state-icon">🏪</div>
        <div class="empty-state-title">Balcão vazio</div>
        <div class="empty-state-subtitle">As vendas diretas e pedidos de balcão aparecerão aqui.</div>
      </div>
    `;

    if (countGarcom === 0) listGarcom.innerHTML = emptyStateGarcom;
    if (countBalcao === 0) listBalcao.innerHTML = emptyStateBalcao;

  } catch (e) { console.error('Erro ao renderizar pedidos:', e); }
  
  isRenderingPedidos = false;
  if (pedidoAtualizadoId) setTimeout(() => { pedidoAtualizadoId = null; }, 5000);
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

function abrirModalEdicao(pedido, itens) {
  pedidoEmEdicao = pedido; 
  itensEmEdicao = [...itens];
  const elTit = document.getElementById('modal-titulo'); 
  if (elTit) elTit.innerText = `Editar Pedido - Mesa ${pedido.mesa_numero}`;
  const elMod = document.getElementById('modal-edicao'); 
  if (elMod) elMod.style.display = 'flex';
  
  exibirCategoriasEdicao();
  exibirMenuEdicao('todas');
  renderizarItensEdicao();
}

function exibirCategoriasEdicao() {
  const container = document.getElementById('edit-menu-categorias');
  if (!container) return;
  
  const categoriasUnicas = [...new Set(cardapio.map(item => item.categoria.trim().toLowerCase()))];
  const categorias = ['todas', ...categoriasUnicas];
  
  container.innerHTML = categorias.map(cat => {
    const nomeExibicao = cat === 'todas' ? 'Todos' : cat.charAt(0).toUpperCase() + cat.slice(1);
    return `
      <div class="cat-mini ${cat === 'todas' ? 'ativa' : ''}" 
           id="cat-edit-${cat}" 
           onclick="selecionarCategoriaEdicao('${cat}')">
        ${nomeExibicao}
      </div>
    `;
  }).join('');
}

function selecionarCategoriaEdicao(cat) {
  // Remove classe ativa de todos
  document.querySelectorAll('.cat-mini').forEach(c => c.classList.remove('ativa'));
  
  // Adiciona no selecionado por ID (mais seguro que 'this')
  const el = document.getElementById(`cat-edit-${cat}`);
  if (el) el.classList.add('ativa');
  
  exibirMenuEdicao(cat);
}

function exibirMenuEdicao(categoria) {
  const container = document.getElementById('edit-menu-grid');
  if (!container) return;
  
  // Força o display grid caso tenha sido alterado por algum erro
  container.style.display = 'grid';
  
  const itens = categoria === 'todas' 
    ? cardapio 
    : cardapio.filter(i => i.categoria.trim().toLowerCase() === categoria);
    
  if (itens.length === 0) {
    container.innerHTML = `<p style="grid-column: 1/-1; text-align: center; padding: 20px; opacity: 0.5;">Nenhum item nesta categoria.</p>`;
    return;
  }

  container.innerHTML = itens.map(item => `
    <div class="item-menu-mini" onclick="adicionarAoPedidoEdicao(${item.id})">
      <img src="${item.imagem}" alt="${item.nome}">
      <h4>${item.nome}</h4>
      <p>R$ ${item.preco.toFixed(2)}</p>
      ${item.estoque !== -1 ? `<small style="display:block; font-size:0.7rem; color:${item.estoque === 0 ? '#e74c3c' : '#7f8c8d'}">Estoque: ${item.estoque}</small>` : ''}
    </div>
  `).join('');
}

async function adicionarAoPedidoEdicao(itemId) {
  const menuItem = cardapio.find(m => m.id === itemId);
  if (!menuItem) return;

  // Verifica se existem itens selecionados para substituição
  const selecionadosIndices = itensEmEdicao.map((item, index) => item.selecionado ? index : -1).filter(index => index !== -1);

  if (selecionadosIndices.length > 0) {
    if (await mostrarConfirmacao(`Deseja substituir os ${selecionadosIndices.length} itens selecionados por ${menuItem.nome}?`, "Substituir Itens")) {
      selecionadosIndices.forEach(async index => {
        const itemOriginal = itensEmEdicao[index];

        // Valida estoque para a substituição
        if (menuItem.estoque !== -1 && itemOriginal.quantidade > menuItem.estoque) {
          await mostrarAlerta(`Estoque insuficiente de ${menuItem.nome} para substituir uma das linhas!`, "Estoque");
          return;
        }

        // Substitui o item mantendo a quantidade, mas reseta o status para 'pendente' 
        // já que o novo item ainda não foi entregue ao cliente.
        itensEmEdicao[index] = {
          ...itemOriginal,
          menu_id: menuItem.id,
          nome: menuItem.nome,
          preco: menuItem.preco,
          status: 'pendente', // Novo item substituído deve ser preparado/entregue
          selecionado: false // Desmarca após substituir
        };
      });
      renderizarItensEdicao();
      mostrarToast("🔄 Itens substituídos com sucesso!");
      return;
    }
  }

  // Comportamento padrão (Adicionar Novo) se nada estiver selecionado
  const exist = itensEmEdicao.find(i => i.menu_id === itemId && i.status === 'pendente');
  const qtdAtual = exist ? exist.quantidade : 0;

  if (menuItem.estoque !== -1 && (qtdAtual + 1) > menuItem.estoque) {
    return await mostrarAlerta(`Estoque insuficiente! Restam apenas ${menuItem.estoque} unidades.`, "Estoque");
  }

  if (exist) {
    exist.quantidade += 1;
  } else {
    itensEmEdicao.push({ 
      menu_id: menuItem.id, 
      nome: menuItem.nome, 
      preco: menuItem.preco, 
      quantidade: 1, 
      observacao: '', 
      status: 'pendente' 
    });
  }
  renderizarItensEdicao();
}

function renderizarItensEdicao() {
  const container = document.getElementById('itens-atuais'); if (!container) return;
  let total = 0;
  container.innerHTML = itensEmEdicao.map((item, index) => {
    total += item.preco * item.quantidade;
    const isEntregue = item.status === 'entregue';
    return `
      <div class="item-edicao" style="${isEntregue ? 'background: #e8f5e9; border-left: 4px solid #27ae60;' : 'border-left: 4px solid #e67e22;'} padding: 10px; display: flex; align-items: center; gap: 10px;">
        <input type="checkbox" ${item.selecionado ? 'checked' : ''} onchange="alternarSelecaoItem(${index})" style="width: 18px; height: 18px; cursor: pointer;">
        <div style="flex-grow:1;">
          <strong>${item.nome}</strong><br>
          <small>${isEntregue ? '✅ Já na mesa (Entregue)' : '⏳ Pendente de entrega'}</small>
        </div>
        <div style="display:flex; align-items:center; gap:0.5rem">
          <input type="number" value="${item.quantidade}" min="1" style="width:45px; padding:2px;" onchange="mudarQtdItem(${index}, this.value)">
          <button class="btn-remover-item" onclick="removerItemEdicao(${index})">X</button>
          <span style="min-width: 60px; text-align:right;">R$ ${(item.preco * item.quantidade).toFixed(2)}</span>
        </div>
      </div>`;
  }).join('');
  const elTot = document.getElementById('modal-total'); if (elTot) elTot.innerText = `Total: R$ ${total.toFixed(2)}`;
}

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

async function salvarAlteracoes() {
  if (itensEmEdicao.length === 0) { if (await mostrarConfirmacao("Pedido vazio. Deseja cancelar pedido?", "Aviso")) return confirmarCancelamento(); return; }
  const res = await fetch(`/api/pedidos/${pedidoEmEdicao.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itens: itensEmEdicao }) });
  if (res.ok) { mostrarToast("Pedido atualizado!"); fecharModal(); }
  else { const err = await res.json(); await mostrarAlerta("Erro: " + err.error, "Erro"); }
}

async function confirmarCancelamento() {
  if (await mostrarConfirmacao("⚠️ CANCELAR TODO O PEDIDO?\nA mesa será liberada e o pedido irá para o histórico como CANCELADO.", "Cancelar Pedido")) {
    const res = await fetch(`/api/pedidos/${pedidoEmEdicao.id}/status`, { 
      method: 'PUT', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ status: 'cancelado' }) 
    });
    if (res.ok) { mostrarToast("❌ Pedido cancelado!"); fecharModal(); carregarPedidos(); }
  }
}

function fecharModal() { document.getElementById('modal-edicao').style.display = 'none'; }

async function excluirPedido(id) {
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
  
  // Marca todos como selecionados por padrão
  itensFechamentoAdmin.forEach(i => i.selecionadoFechamento = true);
  
  renderizarListaItensFechamento();

  document.getElementById('fechamento-mesa-admin').textContent = pedidoParaFecharAdmin.mesa_numero;
  
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
  document.getElementById('modal-fechamento-admin').style.display = 'flex';
}

function renderizarListaItensFechamento() {
  const container = document.getElementById('fechamento-itens-lista-admin');
  if (!container) return;
  
  container.innerHTML = itensFechamentoAdmin.map((item, index) => `
    <div style="display: flex; align-items: center; gap: 8px; padding: 4px; border-bottom: 1px solid #f0f0f0; font-size: 0.85rem;">
      <input type="checkbox" ${item.selecionadoFechamento ? 'checked' : ''} onchange="alternarItemFechamento(${index})">
      <span style="flex-grow: 1;">${item.quantidade}x ${item.nome}</span>
      <span style="font-weight: bold;">R$ ${(item.preco * item.quantidade).toFixed(2)}</span>
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
  const pagoParcial = (pedidoParaFecharAdmin && pedidoParaFecharAdmin.pago_parcial) ? pedidoParaFecharAdmin.pago_parcial : 0;

  const total = (subtotalConsumoAdmin + taxa + acrescimo - desconto) - pagoParcial;
  const troco = recebido > total ? recebido - total : 0;
  const valorPessoa = total / pessoas;

  document.getElementById('fechamento-subtotal-admin').textContent = subtotalConsumoAdmin.toFixed(2);
  document.getElementById('fechamento-taxa-valor-admin').textContent = taxa.toFixed(2);
  document.getElementById('fechamento-total-admin').textContent = total.toFixed(2);
  document.getElementById('fechamento-troco-admin').textContent = troco.toFixed(2);
  document.getElementById('fechamento-valor-pessoa-admin').textContent = valorPessoa.toFixed(2);
}

async function confirmarPagamentoAdmin() {
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
  const troco = valor_recebido > total ? valor_recebido - total : 0;
  // VALIDAÇÃO OBRIGATÓRIA PARA DINHEIRO
  if (forma_pagamento === 'Dinheiro') {
    if (!valor_recebido || valor_recebido <= 0) {
      return await mostrarAlerta("⚠️ O campo 'Valor Recebido' é obrigatório para pagamentos em Dinheiro!", "Aviso");
    }
    if (valor_recebido < total) {
      return await mostrarAlerta(`⚠️ Valor insuficiente! O total é R$ ${total.toFixed(2)} e você informou R$ ${valor_recebido.toFixed(2)}.`, "Aviso");
    }
  }

  // NOVO: Modal de Escolha entre Parcial ou Total
  const escolha = await mostrarConfirmacao(
    `Deseja apenas imprimir uma CONTA PARCIAL (a mesa continuará aberta) ou realizar o FECHAMENTO TOTAL e liberar a mesa?`,
    "Opções de Finalização",
    "FECHAR CONTA TOTAL",
    "APENAS IMPRIMIR PARCIAL"
  );

  // Se escolheu APENAS IMPRIMIR PARCIAL (false no mostrarConfirmacao porque o cancelar é o segundo botão)
  if (escolha === false) {
    const pedidoParcialMock = {
      ...pedidoParaFecharAdmin,
      num_pessoas: num_pessoas,
      valor_por_pessoa: valor_por_pessoa,
      acrescimo: acrescimo,
      desconto: desconto,
      cobrar_taxa: cobrarTaxa,
      pago_parcial: pagoParcial,
      isImpressaoParcialMesa: true, // Flag para o cupom
      total: (subtotalLocal + taxaServico + acrescimo - desconto)
    };
    imprimirCupom(pedidoParcialMock, selecionados);
    return; // Interrompe aqui, não chama APIs de fechamento
  }

  // Se escolheu FECHAR CONTA TOTAL (true), segue a lógica normal...
  try {
    // CENÁRIO: Pagamento de APENAS UMA PARTE DA DIVISÃO
    if (num_pessoas > 1 && todosItensSelecionados) {
      // Busca o histórico real para saber qual é o número desta parte
      let historicoAtual = [];
      try {
        const resH = await fetch(`/api/pedidos/${idPedido}/pagamentos`);
        if (resH.ok) historicoAtual = await resH.json();
      } catch(e) {}
      
      const proximaParte = historicoAtual.length + 1;
      const pagarFracao = await mostrarConfirmacao(`Esta conta está dividida para ${num_pessoas} pessoas.\n\nDeseja pagar apenas a PARTE ${proximaParte} (R$ ${valor_por_pessoa.toFixed(2)}) e manter a mesa aberta para as outras ${num_pessoas - 1} pessoas?`, "Pagamento de Fração", "Sim", "Não");
      
      if (pagarFracao) {
        const resFracao = await fetch(`/api/pedidos/${idPedido}/pagamento-fracao`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            mesa_id: idMesa, 
            valor_pago: valor_por_pessoa,
            forma_pagamento, 
            num_pessoas_restantes: num_pessoas - 1
          })
        });

        if (resFracao.ok) {
          const dataFracao = await resFracao.json();
          mostrarToast("✅ 1 Parte paga com sucesso!");
          
          // Prepara um "mock" do pedido com flag de pagamento de fração
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
            isFracaoPagamento: true, // Flag para o cupom mostrar o valor da fração
            total: (subtotalLocal + taxaServico + acrescimo - desconto)
          };

          imprimirCupom(pedidoMock, itensFechamentoAdmin);
          
          fecharModalFechamentoAdmin();
          await carregarStatusCaixa();
          carregarPedidos();
          return;
        }
      }
    }

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

      if (!resParcial.ok) {
        const err = await resParcial.json();
        throw new Error(err.error || "Erro no pagamento parcial");
      }
      
      mostrarToast("✅ Pagamento parcial (itens) registrado!");
      
      // PERGUNTA SE DESEJA IMPRIMIR
      if (await mostrarConfirmacao("Deseja imprimir o comprovante desta parcial?", "Impressão", "Sim, Imprimir", "Não")) {
        imprimirCupomParcialItens(pedidoParaFecharAdmin, selecionados, total, cobrarTaxa);
      }
    } else {
      // 4. FECHAMENTO TOTAL DA MESA
      // Se for dividido, perguntar as formas de cada pessoa antes de enviar
      let formasPagamentoPessoas = null;
      if (num_pessoas > 1) {
          formasPagamentoPessoas = await mostrarModalMultiPagamento(num_pessoas, valor_por_pessoa);
          if (!formasPagamentoPessoas) return; // Cancelou
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
      
      // PERGUNTA SE DESEJA IMPRIMIR O FINAL
      if (await mostrarConfirmacao("Venda concluída! Deseja imprimir o comprovante final?", "Impressão Final", "Sim, Imprimir", "Não")) {
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
          novosPagamentosCount: novosPagamentosCount
        };
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

function fecharModalFechamentoAdmin() { document.getElementById('modal-fechamento-admin').style.display = 'none'; }

function fecharModalMultiPagamento() { document.getElementById('modal-multi-pagamento').style.display = 'none'; }

function mostrarModalMultiPagamento(numPessoas, valorPorPessoa) {
  return new Promise(resolve => {
    document.getElementById('multi-pag-valor-pessoa').innerText = valorPorPessoa.toFixed(2);
    const container = document.getElementById('multi-pag-lista-pessoas');
    if (!container) return resolve(null);

    container.innerHTML = '';
    for (let i = 1; i <= numPessoas; i++) {
      container.innerHTML += `
        <div style="display: flex; justify-content: space-between; align-items: center; background: #f8f9fa; padding: 10px; border-radius: 8px; border: 1px solid #dee2e6;">
          <strong style="color: #2c3e50;">Pessoa ${i}:</strong>
          <select class="multi-pag-forma-select" style="padding: 8px; border-radius: 5px; border: 1px solid #ced4da; font-size: 0.95rem;">
            <option value="Dinheiro">💵 Dinheiro</option>
            <option value="Pix">📱 Pix</option>
            <option value="Cartão">💳 Cartão</option>
          </select>
        </div>`;
    }

    const modal = document.getElementById('modal-multi-pagamento');
    modal.style.display = 'flex';

    document.getElementById('btn-confirmar-multi-pagamento').onclick = () => {
      const selects = container.querySelectorAll('.multi-pag-forma-select');
      const formas = Array.from(selects).map(s => s.value);
      modal.style.display = 'none';
      resolve(formas);
    };
  });
}

async function carregarCardapio() {
  const res = await fetch('/api/menu');
  cardapio = await res.json();
  const select = document.getElementById('menu-select');
  if (select) select.innerHTML = cardapio.map(item => `<option value="${item.id}">${item.nome} - R$ ${item.preco.toFixed(2)}</option>`).join('');
  
  if (abaAtiva === 'configuracoes') exibirMenuConfig();
}

function iniciarPiscarTitulo() { if (intervalPiscaTitulo) return; let alt = false; intervalPiscaTitulo = setInterval(() => { document.title = alt ? '🔔 NOVO!' : '⚠️ VERIFIQUE'; alt = !alt; }, 1000); }
function pararPiscarTitulo() { clearInterval(intervalPiscaTitulo); intervalPiscaTitulo = null; document.title = tituloOriginal; }
function solicitarPermissaoNotificacao() { if ("Notification" in window) Notification.requestPermission(); }
function exibirNotificacaoNativa(tit, msg) { 
  const somWindows = localStorage.getItem('admin_som_windows') === 'true';
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(tit, { 
      body: msg,
      silent: !somWindows 
    }); 
  } 
}

let timeoutPusher = null;
let pusherInstancia = null;
let pedidoAtualizadoId = null;

function configurarPusher() {
  if (pusherInstancia) return;
  
  try {
    console.log('📡 Inicializando Pusher no Admin...');
    pusherInstancia = new Pusher('5b2b284e309dea9d90fb', { 
      cluster: 'sa1',
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


  channel.bind('novo-pedido', (data) => {
    console.log('📢 Admin: Novo pedido recebido!', data);
    tocarNotificacao(); iniciarPiscarTitulo();
    exibirNotificacaoNativa('Novo Pedido!', `Mesa ${data.pedido.mesa_numero}`);
    mostrarToast(`🚀 NOVO PEDIDO: Mesa ${data.pedido.mesa_numero}`);
    clearTimeout(timeoutPusher); timeoutPusher = setTimeout(() => carregarPedidos(), 500);
  });

  channel.bind('status-atualizado', (data) => {
    console.log('📢 Admin: Status atualizado recebido!', data);
    if (!data) return;

    const mesaData = data.mesa_numero || data.mesa_id || 'X';
    const nMesa = isNaN(mesaData) ? mesaData : `Mesa ${mesaData}`;

    // Se for liberação de mesa
    if (data.status === 'liberada') {
        tocarNotificacao();
        exibirNotificacaoNativa('Mesa Liberada', `${nMesa} está livre.`);
        mostrarToast(`✅ ${nMesa} liberada`);
        clearTimeout(timeoutPusher); timeoutPusher = setTimeout(() => carregarPedidos(), 500);
        return;
    }

    if (data.status === 'itens_adicionados') {
        tocarNotificacao();
        exibirNotificacaoNativa('Novos itens!', `${nMesa} adicionou itens.`);
        mostrarToast(`📝 ${nMesa} adicionou itens`);
        pedidoAtualizadoId = data.pedido_id;
        clearTimeout(timeoutPusher); timeoutPusher = setTimeout(() => carregarPedidos(), 500);
        return;
    }

    let tit = 'Atualização!';

    if (data.status === 'aguardando_fechamento') tit = `🛎️ Fechamento ${nMesa}`;
    else if (data.status === 'servido') tit = `🚚 ${nMesa} servida!`;
    else if (data.status === 'itens_atualizados') tit = `📝 Pedido da ${nMesa} editado`;
    else if (data.status === 'cancelado') tit = `❌ Pedido da ${nMesa} CANCELADO`;
    else tit = `📝 ${nMesa} atualizada!`;

    exibirNotificacaoNativa(tit, "Verifique o painel.");
    mostrarToast(tit);
    clearTimeout(timeoutPusher); timeoutPusher = setTimeout(() => carregarPedidos(), 500);
  });

  channel.bind('menu-atualizado', (data) => {
    console.log('📢 Admin: Menu atualizado recebido!', data);
    carregarCardapio();
  });
  } catch (e) { console.warn('Pusher init error:', e); }
}

function tocarNotificacao() { 
  const somWindows = localStorage.getItem('admin_som_windows') === 'true';
  // Só toca o MP3 se o Som do Windows NÃO estiver ativado
  if (audioDesbloqueado && !somWindows) { 
    audioNotificacao.currentTime = 0; 
    audioNotificacao.play().catch(e => console.error(e)); 
  } 
}

function inicializarConfiguracaoSom() {
  const somWindows = localStorage.getItem('admin_som_windows') === 'true';
  const toggle = document.getElementById('toggle-som-windows');
  if (toggle) toggle.checked = somWindows;
}

function alternarSomWindows(ativo) {
  localStorage.setItem('admin_som_windows', ativo);
  mostrarToast(ativo ? "🔊 Som padrão do Windows ativado" : "🎵 Som personalizado (MP3) ativado");
}

function mostrarToast(msg) {
  const old = document.querySelector('.toast-notificacao'); if (old) old.remove();
  const t = document.createElement('div'); 
  t.className = 'toast-notificacao';
  t.textContent = msg; // Usar textContent em vez de innerText/innerHTML
  document.body.appendChild(t);
  setTimeout(() => { t.classList.add('show'); setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 500); }, 8000); }, 100);
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

              linhasDivisao += `
                <div style="display:flex; justify-content:space-between; margin-bottom: 2px; ${style}">
                  <span>PARTE ${numParte} ${status}:</span>
                  <span>R$ ${valorParte.toFixed(2)}</span>
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
            <span style="font-weight:bold;">${pedido.forma_pagamento || 'N/A'}</span>
          </div>
          ${pedido.forma_pagamento === 'Dinheiro' ? `
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
