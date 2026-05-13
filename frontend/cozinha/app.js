let pusher;
let canal;
const container = document.getElementById('pedidos-container');
const audioNotificacao = document.getElementById('audio-notificacao');
const statusConexao = document.getElementById('status-conexao');

async function carregarPedidos() {
    try {
        const res = await fetch('/api/pedidos/cozinha');
        const itens = await res.json();
        renderizarPedidos(itens);
    } catch (e) {
        console.error('Erro ao carregar pedidos:', e);
        container.innerHTML = '<div class="loading">Erro ao carregar pedidos. Tentando novamente...</div>';
        setTimeout(carregarPedidos, 5000);
    }
}

function renderizarPedidos(itens) {
    if (!itens || itens.length === 0) {
        container.innerHTML = '<div class="sem-pedidos"><h2>🍳 Nenhum pedido pendente</h2></div>';
        return;
    }

    // Agrupar itens por pedido_id
    const pedidosMap = {};
    itens.forEach(item => {
        if (!pedidosMap[item.pedido_id]) {
            pedidosMap[item.pedido_id] = {
                id: item.pedido_id,
                mesa: item.mesa_numero || 'BALCÃO',
                created_at: item.created_at,
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
        
        card.innerHTML = `
            <div class="card-header">
                <span class="mesa-num">Mesa ${pedido.mesa}</span>
                <span class="pedido-id">#${pedido.id} - <span class="pedido-tempo" data-created-at="${pedido.created_at}">${calcularTempo(pedido.created_at)}</span></span>
            </div>
            <div class="card-body">
                ${pedido.itens.map(item => `
                    <div class="item-pedido">
                        <div class="item-info">
                            <div class="item-nome">${item.item_nome}</div>
                            ${item.observacao ? `<div class="item-obs">"${item.observacao}"</div>` : ''}
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

async function configurarPusher() {
    try {
        const res = await fetch('/api/pusher-config');
        const config = await res.json();

        pusher = new Pusher(config.key, { cluster: config.cluster });
        canal = pusher.subscribe('garconnexpress');

        canal.bind('novo-pedido', (data) => {
            console.log('Novo pedido recebido!', data);
            audioNotificacao.play().catch(e => console.log('Erro ao tocar áudio:', e));
            carregarPedidos();
        });

        canal.bind('pedido-cancelado', (data) => {
            console.log('Pedido cancelado:', data);
            // Mostra um alerta visual simples ou recarrega
            if (data.mensagem) {
                const toast = document.createElement('div');
                toast.className = 'cancel-toast';
                toast.innerText = data.mensagem;
                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 5000);
            }
            carregarPedidos();
        });

        canal.bind('menu-atualizado', () => carregarPedidos());
        canal.bind('status-atualizado', () => carregarPedidos());

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

// Atualizar tempos a cada segundo para o efeito de cronômetro
setInterval(atualizarCronometros, 1000);

// Recarregar lista completa a cada minuto para garantir sincronia
setInterval(carregarPedidos, 60000);
