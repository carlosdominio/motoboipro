let pusher;
let canal;
let timeoutPusher;
const container = document.getElementById('pedidos-container');
const audioNotificacao = new Audio('/notificacao.mp3');
const statusConexao = document.getElementById('status-conexao');

let somAtivo = localStorage.getItem('cozinha_som_ativo') !== 'false';
let audioDesbloqueado = false;

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
    localStorage.setItem('cozinha_som_ativo', somAtivo);
    atualizarIconeSom();
}

function tocarCampainha() {
    if (somAtivo && audioDesbloqueado) {
        audioNotificacao.currentTime = 0;
        audioNotificacao.play().catch(e => console.warn('Erro ao tocar áudio:', e));
    }
}

function tocarSomNotificacao(tipo = 'campainha') {
    if (tipo === 'campainha') {
        tocarCampainha();
    } else if (tipo === 'windows') {
        const winAudio = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');
        winAudio.play().catch(e => console.warn('Erro ao tocar som Windows:', e));
    }
}

async function carregarPedidos() {
    try {
        const res = await fetch('/api/pedidos/cozinha');
        if (!res.ok) throw new Error('Erro na resposta da API');
        const itens = await res.json();
        renderizarPedidos(itens);
    } catch (e) {
        console.error('❌ Erro ao carregar pedidos:', e);
        setTimeout(carregarPedidos, 5000);
    }
}

function renderizarPedidos(itens) {
    // FILTRO DE SEGURANÇA REFORÇADO
    const itensValidos = itens.filter(item => {
        const pStatus = (item.pedido_status || '').toLowerCase();
        const iStatus = (item.item_status || '').toLowerCase();
        
        // Se for cancelado em qualquer nível, remove
        if (pStatus === 'cancelado' || iStatus === 'cancelado') return false;
        
        // Se o pedido não estiver em um status ativo para cozinha, remove
        if (pStatus && !['recebido', 'aguardando_fechamento'].includes(pStatus)) return false;
        
        return true;
    });

    if (!itensValidos || itensValidos.length === 0) {
        container.innerHTML = '<div class="sem-pedidos"><h2>🍳 Nenhum pedido pendente</h2></div>';
        return;
    }

    // Agrupar itens por pedido_id
    const pedidosMap = {};
    itensValidos.forEach(item => {
        if (!pedidosMap[item.pedido_id]) {
            console.log(`📦 [Render] Agrupando Pedido #${item.pedido_id}`);
            pedidosMap[item.pedido_id] = {
                id: item.pedido_id,
                mesa: item.mesa_numero || 'BALCÃO',
                created_at: item.created_at,
                pedido_observacao: item.pedido_observacao,
                itens: []
            };
        }
        pedidosMap[item.pedido_id].itens.push(item);
    });

    const pedidosSorted = Object.values(pedidosMap).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    container.innerHTML = '';
    pedidosSorted.forEach(pedido => {
        const card = document.createElement('div');
        card.className = 'card-pedido';
        card.id = `pedido-card-${pedido.id}`;
        
        card.innerHTML = `
            <div class="card-header">
                <span class="mesa-num">Mesa ${pedido.mesa}</span>
                <span class="pedido-id">#${pedido.id} - <span class="pedido-tempo" data-created-at="${pedido.created_at}">${calcularTempo(pedido.created_at)}</span></span>
            </div>
            <div class="card-body">
                ${pedido.pedido_observacao ? `<div class="pedido-obs-global" style="margin-bottom:10px; padding:8px; background:#fff3e0; border-left:4px solid #ff9800; border-radius:4px; font-size:0.95rem; color:#d35400;"><strong>OBS:</strong> ${pedido.pedido_observacao}</div>` : ''}
                ${pedido.itens.map(item => `
                    <div class="item-pedido">
                        <div class="item-info">
                            <div class="item-nome">${item.item_nome}</div>
                            ${item.observacao && item.observacao.trim() !== '' ? `<div class="item-obs" style="color:#e67e22; font-style:italic; font-size:0.9rem; margin-top:2px;">"${item.observacao}"</div>` : ''}
                        </div>
                        <div class="item-qtd">${item.quantidade}</div>
                    </div>
                `).join('')}
            </div>
            <div class="card-footer">
                <button class="btn-pronto" onclick="marcarComoPronto(${pedido.id}, this)">CONCLUIR PEDIDO</button>
            </div>
        `;
        container.appendChild(card);
    });
}

function calcularTempo(createdAt) {
    const diff = Math.floor((new Date() - new Date(createdAt)) / 1000);
    if (diff < 0) return '00:00';
    
    const min = Math.floor(diff / 60);
    const seg = diff % 60;
    
    return `${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}`;
}

function atualizarCronometros() {
    document.querySelectorAll('.pedido-tempo').forEach(span => {
        const createdAt = span.getAttribute('data-created-at');
        if (createdAt) {
            span.innerText = calcularTempo(createdAt);
            
            // Adicionar cor de alerta se passar de 10 ou 15 min
            const diffMin = Math.floor((new Date() - new Date(createdAt)) / 60000);
            if (diffMin >= 15) {
                span.style.color = '#e74c3c'; // Vermelho
                span.style.fontWeight = 'bold';
            } else if (diffMin >= 10) {
                span.style.color = '#f39c12'; // Laranja
                span.style.fontWeight = 'bold';
            } else {
                span.style.color = '#2ecc71'; // Verde (Padrão)
                span.style.fontWeight = 'bold';
            }
        }
    });
}

async function marcarComoPronto(pedidoId, btn) {
    const originalText = btn.innerText;
    btn.innerText = 'CONCLUINDO...';
    btn.disabled = true;

    try {
        // Agora a cozinha marca como 'pronto' em vez de 'entregue'
        // Isso notificará o admin/garçom para eles fazerem a entrega física.
        const res = await fetch(`/api/pedidos/${pedidoId}/cozinha-pronto`, { method: 'PUT' });
        const result = await res.json();
        
        if (result.success) {
            carregarPedidos();
        } else {
            alert('Erro ao concluir pedido: ' + (result.error || 'Erro desconhecido'));
            btn.innerText = originalText;
            btn.disabled = false;
        }
    } catch (e) {
        console.error('Erro:', e);
        alert('Erro de conexão ao concluir pedido.');
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

function mostrarNotificacaoCancelamento(mensagem, pedidoId) {
    console.log(`🗑️ Verificando cancelamento do pedido ${pedidoId}...`);
    
    let estavaNaTela = false;

    // REMOÇÃO IMEDIATA E AGRESSIVA DO DOM
    if (pedidoId) {
        // Tenta encontrar pelo ID do card
        const card = document.getElementById(`pedido-card-${pedidoId}`);
        if (card) {
            card.remove(); // Remove completamente do DOM na hora
            estavaNaTela = true;
        }
        
        // Reforço: Procura qualquer elemento que mencione o ID do pedido se o card não foi achado pelo ID fixo
        const todosCards = document.querySelectorAll('.card-pedido');
        todosCards.forEach(c => {
            if (c.innerText.includes(`#${pedidoId}`)) {
                c.remove();
                estavaNaTela = true;
            }
        });
    }

    // SÓ EXIBE O MODAL E TOCA SOM SE O PEDIDO ESTAVA REALMENTE NA TELA DA COZINHA
    if (estavaNaTela) {
        const modal = document.getElementById('modal-cancelamento');
        const modalMsg = document.getElementById('modal-mensagem');
        
        if (modal && modalMsg) {
            modalMsg.innerText = mensagem;
            modal.classList.add('active');
            tocarSomNotificacao('campainha');
        }
    }
}

function fecharModalCancelamento() {
    const modal = document.getElementById('modal-cancelamento');
    if (modal) {
        modal.classList.remove('active');
    }
    carregarPedidos();
}

async function configurarPusher() {
    try {
        const res = await fetch('/api/pusher-config');
        const config = await res.json();

        pusher = new Pusher(config.key, { cluster: config.cluster });
        canal = pusher.subscribe('garconnexpress');

        canal.bind('novo-pedido', (data) => {
            console.log('Novo pedido recebido!', data);
            
            // SÓ TOCA O SOM SE O PEDIDO FOR REALMENTE PARA A COZINHA
            if (data && data.para_cozinha === true) {
                tocarSomNotificacao('campainha');
                tocarSomNotificacao('windows');
            }
            
            clearTimeout(timeoutPusher);
            timeoutPusher = setTimeout(carregarPedidos, 50);
        });

        canal.bind('pedido-cancelado', (data) => {
            console.log('📢 Pedido cancelado recebido:', data);
            const idParaCancelar = data.id || data.pedido_id;
            if (idParaCancelar) {
                mostrarNotificacaoCancelamento(data.mensagem || `Pedido #${idParaCancelar} cancelado`, idParaCancelar);
            }
            
            clearTimeout(timeoutPusher);
            timeoutPusher = setTimeout(carregarPedidos, 50);
        });

        canal.bind('menu-atualizado', () => {
            clearTimeout(timeoutPusher);
            timeoutPusher = setTimeout(carregarPedidos, 50);
        });

        canal.bind('status-atualizado', (data) => {
            console.log('📢 Status atualizado recebido:', data);
            if (data && data.status === 'cancelado') {
                const idParaCancelar = data.pedido_id || data.id;
                mostrarNotificacaoCancelamento(data.mensagem || `Pedido #${idParaCancelar} CANCELADO pelo Admin`, idParaCancelar);
            } else if (data && (data.status === 'itens_atualizados' || data.status === 'itens_adicionados')) {
                // Se o pedido está na tela, avisa que mudou
                const card = document.getElementById(`pedido-card-${data.pedido_id || data.id}`);
                if (card) {
                    tocarSomNotificacao('campainha');
                    console.log('🔔 Som tocado: Itens atualizados em pedido na tela');
                }
            }
            clearTimeout(timeoutPusher);
            timeoutPusher = setTimeout(carregarPedidos, 50);
        });

        pusher.connection.bind('connected', () => {
            statusConexao.innerText = 'Online';
            statusConexao.classList.add('online');
        });

        pusher.connection.bind('disconnected', () => {
            statusConexao.innerText = 'Offline';
            statusConexao.classList.remove('online');
        });

    } catch (e) {
        console.error('Erro ao configurar Pusher:', e);
    }
}

// Inicialização
carregarPedidos();
configurarPusher();
atualizarIconeSom();

// Atualizar tempos a cada segundo para o efeito de cronômetro
setInterval(atualizarCronometros, 1000);

// Recarregar lista completa a cada minuto para garantir sincronia
setInterval(carregarPedidos, 60000);

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
