let pusher;
let channel;

document.addEventListener('DOMContentLoaded', async () => {
    await initPusher();
    loadPedidos();
});

async function initPusher() {
    try {
        const res = await fetch('/api/pusher-config');
        const config = await res.json();
        
        pusher = new Pusher(config.key, {
            cluster: config.cluster,
            forceTLS: true
        });

        channel = pusher.subscribe('garconnexpress');
        
        // Escuta atualizações de status (cozinha/admin)
        channel.bind('status-atualizado', (data) => {
            console.log('🔔 Status atualizado via Pusher:', data);
            loadPedidos();
        });

        // Escuta novos pedidos
        channel.bind('novo-pedido', (data) => {
            console.log('🆕 Novo pedido via Pusher:', data);
            showToast("Novo pedido recebido!");
            loadPedidos();
        });

        // Escuta cancelamentos
        channel.bind('pedido-cancelado', (data) => {
            console.log('❌ Pedido cancelado via Pusher:', data);
            loadPedidos();
        });

        // Escuta quando itens ficam prontos
        channel.bind('pedido-pronto', (data) => {
            console.log('🍳 Pedido pronto via Pusher:', data);
            loadPedidos();
        });

    } catch (e) {
        console.error('Erro ao configurar Pusher:', e);
    }
}

async function loadPedidos() {
    try {
        const res = await fetch('/api/pedidos/ativos-detalhado');
        const allPedidos = await res.json();
        
        // Filtra apenas os pedidos de DELIVERY
        const deliveryPedidos = allPedidos.filter(p => p.garcom_id === 'DELIVERY');
        
        renderPedidos(deliveryPedidos);
    } catch (e) {
        console.error('Erro ao carregar pedidos:', e);
    }
}

function renderPedidos(pedidos) {
    const contPronto = document.getElementById('container-a-caminho');
    const contPendente = document.getElementById('container-pendentes');
    const contEntregues = document.getElementById('container-entregues');
    
    const countPronto = document.getElementById('count-pronto');
    const countPendente = document.getElementById('count-pendente');
    const countEntregues = document.getElementById('count-entregues');

    // Limpa containers
    contPronto.innerHTML = '';
    contPendente.innerHTML = '';
    contEntregues.innerHTML = '';

    let nPronto = 0;
    let nPendente = 0;
    let nEntregue = 0;

    pedidos.forEach(p => {
        // Classifica o pedido baseado no status
        if (p.status === 'aguardando_fechamento') {
            // PEDIDO JÁ ENTREGUE PELO MOTOBOY
            const card = createPedidoCard(p, true, true);
            contEntregues.appendChild(card);
            nEntregue++;
        } else {
            const isReady = p.status === 'servido' || p.status === 'pronto';
            const card = createPedidoCard(p, isReady, false);
            
            if (isReady) {
                contPronto.appendChild(card);
                nPronto++;
            } else {
                contPendente.appendChild(card);
                nPendente++;
            }
        }
    });

    // Empty states
    if (nPronto === 0) contPronto.innerHTML = '<div class="empty-state">Nenhum pedido pronto para entrega.</div>';
    if (nPendente === 0) contPendente.innerHTML = '<div class="empty-state">Nenhum pedido em preparo.</div>';
    if (nEntregue === 0) contEntregues.innerHTML = '<div class="empty-state">Nenhuma entrega realizada ainda.</div>';

    countPronto.innerText = nPronto;
    countPendente.innerText = nPendente;
    countEntregues.innerText = nEntregue;
}

function createPedidoCard(p, isReady, isDelivered) {
    const card = document.createElement('div');
    card.className = `pedido-card ${isDelivered ? 'pronto' : (isReady ? 'pronto' : 'pendente')}`;
    if (isDelivered) card.style.opacity = '0.7'; // Visual diferenciado para entregues
    
    // Extrai Nome e Endereço da observação (formato padrão do delivery)
    // 👤 Cliente: Nome
    // 🏠 End: Endereço, Número
    let cliente = "Cliente não identificado";
    let endereco = "Endereço não informado";
    
    if (p.observacao) {
        const lines = p.observacao.split('\n');
        const lineNome = lines.find(l => l.includes('👤 Cliente:'));
        const lineEnd = lines.find(l => l.includes('🏠 End:'));
        
        if (lineNome) cliente = lineNome.replace('👤 Cliente:', '').trim();
        if (lineEnd) endereco = lineEnd.replace('🏠 End:', '').trim();
    }

    const time = new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let statusText = 'PENDENTE';
    let statusClass = 'pendente';

    if (isDelivered) {
        statusText = 'ENTREGUE';
        statusClass = 'entregue';
    } else if (isReady) {
        statusText = 'A CAMINHO';
        statusClass = 'a-caminho';
    }

    let btnHtml = '';
    if (isDelivered) {
        btnHtml = `<button class="btn-entregar" style="background-color: #95a5a6; box-shadow: 0 4px 0 #7f8c8d;" disabled>
                      <i class="fas fa-check-double"></i> ENTREGA CONCLUÍDA
                   </button>`;
    } else {
        btnHtml = `<button class="btn-entregar" ${!isReady ? 'disabled' : ''} onclick="confirmarEntrega(${p.id}, this)">
                      ${isReady ? '<i class="fas fa-check"></i> CONFIRMAR ENTREGA' : '<i class="fas fa-clock"></i> AGUARDANDO COZINHA'}
                   </button>`;
    }

    card.innerHTML = `
        <div class="pedido-header">
            <div>
                <span class="pedido-id">#${p.id}</span>
                <span class="status-badge ${statusClass}">${statusText}</span>
            </div>
            <span class="pedido-time">${time}</span>
        </div>
        <div class="pedido-body">
            <span class="cliente-info">${cliente}</span>
            <span class="endereco-info">${endereco}</span>
            <div class="pedido-itens">
                ${p.itens.map(i => `<div class="item-row"><span>${i.quantidade}x ${i.nome}</span><span>${i.status}</span></div>`).join('')}
            </div>
        </div>
        ${btnHtml}
    `;

    return card;
}

async function confirmarEntrega(id, btn) {
    const { isConfirmed } = await Swal.fire({
        title: 'Confirmar Entrega?',
        text: `Você confirma que o pedido #${id} foi entregue ao cliente?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#27ae60',
        cancelButtonColor: '#95a5a6',
        confirmButtonText: 'Sim, entregue!',
        cancelButtonText: 'Cancelar'
    });

    if (!isConfirmed) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> PROCESSANDO...';

    try {
        // Envia status 'aguardando_fechamento' para que no Admin caia na coluna de entregue/fechamento
        const res = await fetch(`/api/pedidos/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'aguardando_fechamento' })
        });

        if (res.ok) {
            showToast(`Pedido #${id} entregue com sucesso!`);
            loadPedidos();
        } else {
            showToast("Erro ao confirmar entrega.");
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check"></i> CONFIRMAR ENTREGA';
        }
    } catch (e) {
        console.error(e);
        showToast("Falha na conexão.");
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check"></i> CONFIRMAR ENTREGA';
    }
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.innerText = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}
