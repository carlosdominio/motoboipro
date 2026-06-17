const API_BASE_URL = 'https://garconnexpress.vercel.app';

let pusher;
let channel;
const audioNotificacao = new Audio('/notificacao.mp3');

// --- INTERCEPTADOR FETCH PARA APP NATIVO ---
const isNativeApp = (window.Capacitor && window.Capacitor.isNativePlatform()) ||
                   window.location.protocol === 'capacitor:';

const originalFetch = window.fetch;
window.fetch = async (...args) => {
    let url = args[0];
    const token = localStorage.getItem('garcom_token');

    if (isNativeApp && typeof url === 'string' && url.startsWith('/api/')) {
        url = API_BASE_URL + url;
        args[0] = url;
    }

    if (token) {
        if (!args[1]) args[1] = {};
        if (!args[1].headers) args[1].headers = {};
        args[1].headers['Authorization'] = `Bearer ${token}`;
    }

    return originalFetch(...args);
};
// --------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('garcom_token');
    const loginScreen = document.getElementById('login-screen');
    const loginForm = document.getElementById('login-form');

    if (!token) {
        if (loginScreen) loginScreen.style.display = 'flex';
    } else {
        if (loginScreen) loginScreen.style.display = 'none';
        await iniciarApp();
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await realizarLogin();
        });
    }
});

async function realizarLogin() {
    const user = document.getElementById('login-user').value;
    const pass = document.getElementById('login-pass').value;
    const btn = document.getElementById('btn-login-submit');

    if (!user || !pass) {
        return Swal.fire({
            title: 'Aviso',
            text: 'Preencha usuário e senha',
            icon: 'warning',
            confirmButtonColor: '#e67e22'
        });
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> AUTENTICANDO...';

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario: user, senha: pass })
        });

        if (res.ok) {
            const data = await res.json();
            localStorage.setItem('garcom_token', data.token);
            localStorage.setItem('garcom_logado', JSON.stringify(data.garcom));
            
            const loginScreen = document.getElementById('login-screen');
            if (loginScreen) loginScreen.style.display = 'none';
            
            await iniciarApp();
            Swal.fire({
                title: 'Sucesso',
                text: 'Bem-vindo ao Motoboy Express!',
                icon: 'success',
                confirmButtonColor: '#27ae60'
            });
        } else {
            Swal.fire({
                title: 'Erro de Login',
                text: 'Usuário ou senha inválidos. Verifique os dados e tente novamente.',
                icon: 'error',
                confirmButtonColor: '#e74c3c'
            });
        }
    } catch (e) {
        console.error(e);
        Swal.fire({
            title: 'Erro de Conexão',
            text: 'Não foi possível conectar ao servidor. Verifique sua internet.',
            icon: 'error',
            confirmButtonColor: '#e74c3c'
        });
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'ENTRAR <i class="fas fa-arrow-right" style="margin-left: 10px;"></i>';
    }
}

function logout() {
    localStorage.removeItem('garcom_token');
    localStorage.removeItem('garcom_logado');
    location.reload();
}

async function iniciarApp() {
    await verificarStatusCaixa();
    setInterval(verificarStatusCaixa, 30000);

    if (!sessionStorage.getItem('audio_unlocked')) {
        Swal.fire({
            title: 'Ativar Alertas?',
            text: 'Clique para ativar o som de novos pedidos e notificações.',
            icon: 'info',
            confirmButtonText: '<i class="fas fa-volume-up"></i> ATIVAR ÁUDIO',
            confirmButtonColor: '#e67e22',
            allowOutsideClick: false
        }).then((result) => {
            if (result.isConfirmed) {
                sessionStorage.setItem('audio_unlocked', 'true');
                audioNotificacao.play().then(() => {
                    audioNotificacao.pause();
                    audioNotificacao.currentTime = 0;
                    showToast("Áudio e notificações ativos!", "success");
                }).catch(e => {
                    console.error('Erro ao desbloquear áudio:', e);
                });
            }
        });
    }

    await initPusher();
    await initNativePush();
    loadPedidos();
}

async function initNativePush() {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        const { PushNotifications } = Capacitor.Plugins;

        let perm = await PushNotifications.checkPermissions();
        if (perm.receive !== 'granted') {
            perm = await PushNotifications.requestPermissions();
        }

        if (perm.receive === 'granted') {
            await PushNotifications.register();
        }

        PushNotifications.addListener('registration', (token) => {
            console.log('Push registration success, token: ' + token.value);
        });

        PushNotifications.addListener('pushNotificationReceived', (notification) => {
            console.log('Push received: ', notification);
            loadPedidos();
        });
    }
}

async function verificarStatusCaixa() {
    try {
        const res = await fetch('/api/caixa/status');
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
        const res = await fetch('/api/pusher-config');
        const config = await res.json();
        
        pusher = new Pusher(config.key, {
            cluster: config.cluster,
            forceTLS: true
        });

        channel = pusher.subscribe('garconnexpress');
        
        channel.bind('status-caixa-atualizado', (data) => {
            console.log('📢 Evento de caixa recebido no motoboy:', data);
            verificarStatusCaixa();
            if (data.status === 'fechado') {
                showToast("O expediente foi encerrado. O caixa está FECHADO.", "warning");
            } else if (data.status === 'aberto') {
                showToast("O caixa foi aberto! Bom trabalho.");
            }
        });

        channel.bind('status-atualizado', (data) => {
            console.log('🔔 Status atualizado via Pusher:', data);
            loadPedidos();
            
            if (data.garcom_id === 'DELIVERY') {
                if (data.status === 'cancelado') {
                    showToast(`Pedido #${data.pedido_id} foi CANCELADO.`, "warning");
                } else if (data.status === 'pronto' || data.status === 'servido') {
                    showToast(`Pedido #${data.pedido_id} está PRONTO!`, "success");
                } else if (data.status === 'recebido') {
                    showToast(`Novo pedido #${data.pedido_id} recebido!`, "info");
                } else if (data.status === 'aguardando_fechamento' || data.status === 'entregue') {
                    showToast(`Pedido #${data.pedido_id} ENTREGUE!`, "success");
                }
            }
        });

        channel.bind('novo-pedido', (data) => {
            console.log('🆕 Novo pedido via Pusher:', data);
            loadPedidos();

            const pedido = data.pedido || data;
            if (pedido.garcom_id === 'DELIVERY') {
                showToast(`Novo pedido #${pedido.id || pedido.pedido_id} recebido!`, "info");
            }
        });

        channel.bind('pedido-cancelado', (data) => {
            console.log('❌ Pedido cancelado via Pusher:', data);
            loadPedidos();

            if (String(data.garcom_id) === 'DELIVERY' || (data.mesa_numero && String(data.mesa_numero).includes('DELIVERY'))) {
                showToast(`Pedido #${data.id || data.pedido_id} foi REMOVIDO.`, "warning");
            }
        });

        channel.bind('pedido-pronto', (data) => {
            console.log('🍳 Pedido pronto via Pusher:', data);
            loadPedidos();

            if (String(data.garcom_id) === 'DELIVERY' || (data.mesa_numero && String(data.mesa_numero).includes('DELIVERY'))) {
                showToast("Pedido pronto para entrega!", "success");
            }
        });

    } catch (e) {
        console.error('Erro ao configurar Pusher:', e);
    }
}

async function loadPedidos() {
    const token = localStorage.getItem('garcom_token');
    if (!token) return;

    try {
        const res = await fetch('/api/pedidos/ativos-detalhado');
        const allPedidos = await res.json();
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

    if (contPronto) contPronto.innerHTML = '';
    if (contPendente) contPendente.innerHTML = '';
    if (contEntregues) contEntregues.innerHTML = '';

    let nPronto = 0;
    let nPendente = 0;
    let nEntregue = 0;

    pedidos.forEach(p => {
        if (p.status === 'aguardando_fechamento' || p.status === 'entregue') {
            const card = createPedidoCard(p, 'entregue');
            if (contEntregues) contEntregues.appendChild(card);
            nEntregue++;
        } else {
            const isReady = p.status === 'servido' || p.status === 'pronto' || p.status === 'saiu_entrega';
            if (isReady) {
                const card = createPedidoCard(p, 'a-caminho');
                if (contPronto) contPronto.appendChild(card);
                nPronto++;
            } else {
                const card = createPedidoCard(p, 'pendente');
                if (contPendente) contPendente.appendChild(card);
                nPendente++;
            }
        }
    });

    if (nPronto === 0 && contPronto) contPronto.innerHTML = '<div class="empty-state">Nenhum pedido pronto para entrega.</div>';
    if (nPendente === 0 && contPendente) contPendente.innerHTML = '<div class="empty-state">Nenhum pedido em preparo.</div>';
    if (nEntregue === 0 && contEntregues) contEntregues.innerHTML = '<div class="empty-state">Nenhuma entrega realizada ainda.</div>';

    if (countPronto) countPronto.innerText = nPronto;
    if (countPendente) countPendente.innerText = nPendente;
    if (countEntregues) countEntregues.innerText = nEntregue;
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
    let statusClass = displayStatus;
    let statusText = displayStatus.toUpperCase().replace('-', ' ');
    card.className = `pedido-card ${statusClass}`;
    if (displayStatus === 'entregue') card.style.opacity = '0.7';
    
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

function mostrarToast(msg, tipo = 'success', titulo = '', duracao = 5000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const t = document.createElement('div');
    let classeTipo = tipo;
    if (tipo === 'sucesso') classeTipo = 'success';
    if (tipo === 'erro') classeTipo = 'error';
    t.className = `toast-notificacao ${classeTipo}`;
    
    const icones = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
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

    if (typeof exibirNotificacaoNativa === 'function') {
        exibirNotificacaoNativa(titulo || (classeTipo.toUpperCase() + ": " + (icones[classeTipo] || "")), msg, 'toast-' + Date.now());
    }

    setTimeout(() => t.classList.add('show'), 10);
    const autoClose = setTimeout(() => fecharToast(t), duracao);

    if (typeof audioNotificacao !== 'undefined') {
        audioNotificacao.play().catch(e => console.log('Áudio bloqueado:', e));
    }

    t.querySelector('.toast-close').onclick = () => {
        clearTimeout(autoClose);
        fecharToast(t);
    };
}

function fecharToast(el) {
    el.classList.remove('show');
    setTimeout(() => { if (el.parentNode) el.remove(); }, 400);
}

function showToast(msg, type = 'info') {
    mostrarToast(msg, type);
}
