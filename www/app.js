const API_BASE_URL = 'https://garconnexpress.vercel.app';
let pusher;
let channel;

const audioNotificacao = new Audio(API_BASE_URL + '/notificacao.mp3');

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Verifica autenticação
    if (!verificarAutenticacao()) return;

    // 2. Verifica status do caixa
    await verificarStatusCaixa();
    setInterval(verificarStatusCaixa, 30000);

    // Força interação inicial para desbloquear áudio no navegador/celular
    Swal.fire({
        title: 'Ativar Alertas?',
        text: 'Clique para ativar o som de novos pedidos e notificações.',
        icon: 'info',
        confirmButtonText: '<i class="fas fa-volume-up"></i> ATIVAR ÁUDIO',
        confirmButtonColor: '#e67e22',
        allowOutsideClick: false
    }).then((result) => {
        if (result.isConfirmed) {
            audioNotificacao.play().then(() => {
                audioNotificacao.pause();
                audioNotificacao.currentTime = 0;
                showToast("Áudio e notificações ativos!", "success");
            }).catch(e => {
                console.error('Erro ao desbloquear áudio:', e);
            });
        }
    });

    await initPusher();
    await initNativePush();
    loadPedidos();
});

function verificarAutenticacao() {
    const token = localStorage.getItem('motoboy_token');
    const loginScreen = document.getElementById('login-screen');
    
    if (!token) {
        loginScreen.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        setupLoginForm();
        return false;
    }
    
    loginScreen.style.display = 'none';
    document.body.style.overflow = '';
    return true;
}

function setupLoginForm() {
    const form = document.getElementById('login-form');
    if (!form) return;

    form.onsubmit = async (e) => {
        e.preventDefault();
        const usuario = document.getElementById('login-user').value;
        const senha = document.getElementById('login-pass').value;
        const btn = form.querySelector('button');

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> AUTENTICANDO...';

        try {
            const res = await fetch(API_BASE_URL + '/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usuario, senha })
            });

            const data = await res.json();

            if (data.success) {
                localStorage.setItem('motoboy_token', data.token);
                localStorage.setItem('motoboy_user', JSON.stringify(data.garcom));
                
                Swal.fire({
                    title: 'Bem-vindo!',
                    text: `Olá ${data.garcom.nome}, bom trabalho!`,
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false
                });

                setTimeout(() => location.reload(), 2000);
            } else {
                Swal.fire('Erro', 'Usuário ou senha incorretos.', 'error');
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> ENTRAR';
            }
        } catch (e) {
            console.error(e);
            Swal.fire('Erro', 'Falha na conexão com o servidor.', 'error');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> ENTRAR';
        }
    };
}

async function initNativePush() {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        const { PushNotifications } = Capacitor.Plugins;

        // Solicita permissão
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive !== 'granted') {
            perm = await PushNotifications.requestPermissions();
        }

        if (perm.receive === 'granted') {
            // Cria canal de notificação (Obrigatório para Android 8+)
            await PushNotifications.createChannel({
                id: 'pedidos',
                name: 'Pedidos e Alertas',
                description: 'Notificações de novos pedidos e atualizações de status',
                sound: 'notificacao.mp3',
                importance: 5,
                visibility: 1
            });
            await PushNotifications.register();
        }

        PushNotifications.addListener('registration', async (token) => {
            console.log('Push registration success, token: ' + token.value);
            // Envia o token para o servidor para permitir notificações em segundo plano
            try {
                const motoboyToken = localStorage.getItem('motoboy_token');
                await fetch(API_BASE_URL + '/api/subscribe-motoboy', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${motoboyToken}`
                    },
                    body: JSON.stringify({ endpoint: token.value })
                });
                console.log('✅ Token FCM registrado no servidor!');
            } catch (e) {
                console.error('❌ Erro ao registrar token FCM no servidor:', e);
            }
        });

        PushNotifications.addListener('pushNotificationReceived', (notification) => {
            console.log('Push received: ', notification);
            loadPedidos();
            // Apenas mostra o toast se for um evento que o Pusher não tratou ou se o app estiver em background
            // Como o Pusher já trata 'novo-pedido', 'pedido-pronto' etc, evitamos duplicar aqui.
            if (notification.data && notification.data.event === 'mensagem-admin') {
                mostrarToast(notification.body, 'info', notification.title);
            }
        });

        PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
            console.log('Push action performed: ', notification);
            loadPedidos();
        });
    }
}

async function verificarStatusCaixa() {
    try {
        const res = await fetch(API_BASE_URL + '/api/caixa/status');
        const cx = await res.json();
        const screen = document.getElementById('closed-screen');
        if (!screen) return;

        if (!cx) {
            screen.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        } else {
            screen.style.display = 'none';
            document.body.style.overflow = '';
        }
    } catch (e) { console.error("Erro status caixa motoboy:", e); }
}

async function initPusher() {
    try {
        const res = await fetch(API_BASE_URL + '/api/pusher-config');
        const config = await res.json();
        
        pusher = new Pusher(config.key, {
            cluster: config.cluster,
            forceTLS: true
        });

        channel = pusher.subscribe('garconnexpress');
        
        // Sincronia do caixa em tempo real
        channel.bind('status-caixa-atualizado', (data) => {
            console.log('📢 Evento de caixa recebido no motoboy:', data);
            verificarStatusCaixa();
            if (data.status === 'fechado') {
                showToast("O expediente foi encerrado. O caixa está FECHADO.", "warning");
            } else if (data.status === 'aberto') {
                showToast("O caixa foi aberto! Bom trabalho.");
            }
        });

        // Escuta atualizações de status (cozinha/admin)
        channel.bind('status-atualizado', (data) => {
            console.log('🔔 Status atualizado via Pusher:', data);
            loadPedidos();
            
            // FILTRO: Só mostra balão para o motoboy se for DELIVERY
            if (data.garcom_id === 'DELIVERY') {
                if (data.status === 'cancelado') {
                    showToast(`Pedido #${data.pedido_id} foi CANCELADO.`, "warning");
                    exibirNotificacaoNativa(`❌ PEDIDO CANCELADO`, `O pedido #${data.pedido_id} foi cancelado.`);
                } else if (data.status === 'pronto' || data.status === 'servido') {
                    showToast(`Pedido #${data.pedido_id} está PRONTO!`, "success");
                    exibirNotificacaoNativa(`🍳 PEDIDO PRONTO`, `O pedido #${data.pedido_id} está pronto para entrega.`);
                } else if (data.status === 'recebido') {
                    showToast(`Novo pedido #${data.pedido_id} recebido!`, "info");
                } else if (data.status === 'aguardando_fechamento' || data.status === 'entregue') {
                    showToast(`Pedido #${data.pedido_id} ENTREGUE!`, "success");
                }
            }
        });

        // Escuta novos pedidos (Geralmente disparado na criação)
        channel.bind('novo-pedido', (data) => {
            console.log('🆕 Novo pedido via Pusher:', data);
            loadPedidos();

            // FILTRO: Só mostra balão se for DELIVERY
            const pedido = data.pedido || data;
            if (pedido.garcom_id === 'DELIVERY') {
                showToast(`Novo pedido #${pedido.id || pedido.pedido_id} recebido!`, "info");
                exibirNotificacaoNativa(`🆕 NOVO DELIVERY`, `Pedido #${pedido.id || pedido.pedido_id} recebido!`);
            }
        });

        // Escuta cancelamentos (Disparado na exclusão)
        channel.bind('pedido-cancelado', (data) => {
            console.log('❌ Pedido cancelado via Pusher:', data);
            loadPedidos();

            // FILTRO: Só mostra balão se for DELIVERY
            if (String(data.garcom_id) === 'DELIVERY' || (data.mesa_numero && String(data.mesa_numero).includes('DELIVERY'))) {
                showToast(`Pedido #${data.id || data.pedido_id} foi REMOVIDO.`, "warning");
                exibirNotificacaoNativa(`❌ PEDIDO REMOVIDO`, `Pedido #${data.id || data.pedido_id} foi cancelado.`);
            }
        });

        // Escuta quando itens ficam prontos (Cozinha)
        channel.bind('pedido-pronto', (data) => {
            console.log('🍳 Pedido pronto via Pusher:', data);
            loadPedidos();

            // FILTRO: Só mostra balão se for DELIVERY
            if (String(data.garcom_id) === 'DELIVERY' || (data.mesa_numero && String(data.mesa_numero).includes('DELIVERY'))) {
                showToast("Pedido pronto para entrega!", "success");
                exibirNotificacaoNativa(`🍳 COZINHA: PRONTO`, `O pedido de delivery está pronto!`);
            }
        });

    } catch (e) {
        console.error('Erro ao configurar Pusher:', e);
    }
}

async function loadPedidos() {
    try {
        const token = localStorage.getItem('motoboy_token');
        const res = await fetch(API_BASE_URL + '/api/pedidos/ativos-detalhado', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.status === 401 || res.status === 403) {
            localStorage.removeItem('motoboy_token');
            location.reload();
            return;
        }

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
        // Classifica o pedido baseado no status e força o label da coluna
        if (p.status === 'aguardando_fechamento' || p.status === 'entregue') {
            const card = createPedidoCard(p, 'entregue');
            contEntregues.appendChild(card);
            nEntregue++;
        } else {
            const isReady = p.status === 'servido' || p.status === 'pronto' || p.status === 'saiu_entrega';
            if (isReady) {
                const card = createPedidoCard(p, 'a-caminho');
                contPronto.appendChild(card);
                nPronto++;
            } else {
                const card = createPedidoCard(p, 'pendente');
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

function translateStatus(s) {
    const map = {
        'pendente': 'PREPARANDO',
        'pronto': 'PRONTO',
        'entregue': 'ENTREGUE',
        'cancelado': 'CANCELADO',
        'servido': 'PRONTO',
        'saiu_entrega': 'A CAMINHO'
    };
    return map[s.toLowerCase()] || s.toUpperCase();
}

function createPedidoCard(p, displayStatus) {
    const card = document.createElement('div');
    
    // Classes CSS baseadas no displayStatus
    let statusClass = displayStatus;
    let statusText = displayStatus.toUpperCase().replace('-', ' ');
    
    card.className = `pedido-card ${statusClass}`;
    if (displayStatus === 'entregue') card.style.opacity = '0.7';
    
    // Extrai Nome e Endereço da observação (formato padrão do delivery)
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

    let btnHtml = '';
    if (displayStatus === 'entregue') {
        btnHtml = `<button class="btn-entregar" style="background-color: #95a5a6; box-shadow: 0 4px 0 #7f8c8d;" disabled>
                      <i class="fas fa-check-double"></i> ENTREGA CONCLUÍDA
                   </button>`;
    } else {
        const isReady = displayStatus === 'a-caminho';
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
            <div style="text-align: right;">
                <div class="pedido-total">R$ ${parseFloat(p.total).toFixed(2).replace('.', ',')}</div>
                <span class="pedido-time">${time}</span>
            </div>
        </div>
        <div class="pedido-body">
            <span class="cliente-info">${cliente}</span>
            <span class="endereco-info">${endereco}</span>
            <div class="pedido-itens">
                ${p.itens.map(i => {
                    let itemStatusLabel = translateStatus(i.status);
                    // Se o item está entregue (preparado) mas o pedido ainda está "A CAMINHO", 
                    // para o motoboy o item está "A CAMINHO"
                    if (displayStatus === 'a-caminho' && i.status.toLowerCase() === 'entregue') {
                        itemStatusLabel = 'A CAMINHO';
                    }
                    return `<div class="item-row"><span>${i.quantidade}x ${i.nome}</span><span>${itemStatusLabel}</span></div>`;
                }).join('')}
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
        const token = localStorage.getItem('motoboy_token');
        // Envia status 'aguardando_fechamento' para que no Admin caia na coluna de entregue/fechamento
        const res = await fetch(API_BASE_URL + `/api/pedidos/${id}/status`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
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

function solicitarPermissaoNotificacao() {
    if ("Notification" in window) Notification.requestPermission();
}

function exibirNotificacaoNativa(tit, msg, tagId = 'geral') {
    if ("Notification" in window && Notification.permission === "granted") {
        const n = new Notification(tit, {
            body: msg,
            tag: tagId,
            renotify: true
        });
        n.onclick = () => {
            window.focus();
        };
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
    // Normalização de tipos
    let classeTipo = tipo;
    if (tipo === 'sucesso') classeTipo = 'success';
    if (tipo === 'erro') classeTipo = 'error';
    
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

    // NOVO: Espelha para notificação nativa do Windows automaticamente
    if (typeof exibirNotificacaoNativa === 'function') {
        exibirNotificacaoNativa(titulo || (classeTipo.toUpperCase() + ": " + (icones[classeTipo] || "")), msg, 'toast-' + Date.now());
    }

    // Trigger animação
    setTimeout(() => t.classList.add('show'), 10);

    // Auto-close
    const autoClose = setTimeout(() => fecharToast(t), duracao);

    // Toca o som (Motoboy sempre toca para chamar atenção)
    if (typeof audioNotificacao !== 'undefined') {
        audioNotificacao.play().catch(e => console.log('Áudio bloqueado:', e));
    }

    // Botão fechar
    t.querySelector('.toast-close').onclick = () => {
        clearTimeout(autoClose);
        fecharToast(t);
    };
}

function fecharToast(el) {
    el.classList.remove('show');
    setTimeout(() => { if (el.parentNode) el.remove(); }, 400);
}

// Alias para compatibilidade com código antigo do motoboy
function showToast(msg, type = 'info') {
    mostrarToast(msg, type);
}
