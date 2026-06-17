const API_BASE_URL = 'https://garconnexpress.vercel.app';

let pusher;
let channel;
const audioNotificacao = new Audio('/notificacao.mp3');
let soundEnabled = localStorage.getItem('sound_enabled') !== 'false';

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
    updateSoundUI();
    
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
            
            Swal.fire({
                title: 'Acesso Autorizado',
                text: 'Bem-vindo ao Motoboy Express!',
                icon: 'success',
                timer: 1500,
                showConfirmButton: false
            });

            await iniciarApp();
        } else {
            Swal.fire({
                title: 'Acesso Negado',
                text: 'Usuário ou senha incorretos. Verifique e tente novamente.',
                icon: 'error',
                confirmButtonColor: '#e74c3c'
            });
        }
    } catch (e) {
        console.error(e);
        Swal.fire({
            title: 'Falha na Conexão',
            text: 'Não foi possível conectar ao servidor.',
            icon: 'error',
            confirmButtonColor: '#e74c3c'
        });
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'ENTRAR NO APP <i class="fas fa-arrow-right" style="margin-left: 10px;"></i>';
    }
}

function logout() {
    localStorage.removeItem('garcom_token');
    localStorage.removeItem('garcom_logado');
    location.reload();
}

function toggleSound() {
    soundEnabled = !soundEnabled;
    localStorage.setItem('sound_enabled', soundEnabled);
    updateSoundUI();
    showToast(soundEnabled ? "Sons ativados!" : "Sons desativados.", soundEnabled ? "success" : "warning");
}

function updateSoundUI() {
    const btn = document.getElementById('btn-toggle-sound');
    if (btn) {
        if (soundEnabled) {
            btn.innerHTML = '<i class="fas fa-bell"></i>';
            btn.classList.remove('muted');
        } else {
            btn.innerHTML = '<i class="fas fa-bell-slash"></i>';
            btn.classList.add('muted');
        }
    }
}

async function iniciarApp() {
    await verificarStatusCaixa();
    setInterval(verificarStatusCaixa, 30000);

    if (!sessionStorage.getItem('audio_unlocked')) {
        Swal.fire({
            title: 'Ativar Alertas?',
            text: 'Clique para ativar o som de novos pedidos.',
            icon: 'info',
            confirmButtonText: 'ATIVAR ÁUDIO',
            confirmButtonColor: '#e67e22',
            allowOutsideClick: false
        }).then((result) => {
            if (result.isConfirmed) {
                sessionStorage.setItem('audio_unlocked', 'true');
                audioNotificacao.play().then(() => {
                    audioNotificacao.pause();
                    audioNotificacao.currentTime = 0;
                    showToast("Áudio pronto!", "success");
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

        // RESTAURAÇÃO DAS CATEGORIAS/CANAL FCM NATIVO
        try {
            await PushNotifications.createChannel({
                id: 'pedidos',
                name: 'Pedidos de Delivery',
                description: 'Notificações de novos pedidos e atualizações',
                sound: 'notificacao', // res/raw/notificacao.mp3
                importance: 5,
                visibility: 1,
                vibration: true
            });
            console.log('✅ Canal FCM "pedidos" restaurado.');
        } catch (e) {
            console.error('Erro ao criar canal FCM:', e);
        }

        let perm = await PushNotifications.checkPermissions();
        if (perm.receive !== 'granted') {
            perm = await PushNotifications.requestPermissions();
        }

        if (perm.receive === 'granted') {
            await PushNotifications.register();
            
            // CONFIGURAÇÃO CRÍTICA: Diz ao sistema para NÃO mostrar a notificação nativa (balão/som do OS)
            // se o aplicativo estiver ABERTO. Assim, usamos apenas o Toast e o som do próprio App.
            await PushNotifications.setPresentationOptions({
                presentationOptions: [] 
            });
        }

        PushNotifications.addListener('registration', (token) => {
            console.log('Push registration success, token: ' + token.value);
        });

        PushNotifications.addListener('pushNotificationReceived', (notification) => {
            console.log('Push received: ', notification);
            loadPedidos();
            // App aberto: Dispara nosso Toast interno (com som)
            showToast(notification.body || 'Novo pedido recebido!', 'info');
        });
        
        PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
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
            verificarStatusCaixa();
            if (data.status === 'fechado') {
                showToast("Expediente encerrado. Caixa FECHADO.", "warning");
            } else if (data.status === 'aberto') {
                showToast("Caixa aberto! Bom trabalho.");
            }
        });

        channel.bind('status-atualizado', (data) => {
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
            loadPedidos();
            const pedido = data.pedido || data;
            if (pedido.garcom_id === 'DELIVERY') {
                showToast(`Novo pedido #${pedido.id || pedido.pedido_id} recebido!`, "info");
            }
        });

        channel.bind('pedido-cancelado', (data) => {
            loadPedidos();
            if (String(data.garcom_id) === 'DELIVERY' || (data.mesa_numero && String(data.mesa_numero).includes('DELIVERY'))) {
                showToast(`Pedido #${data.id || data.pedido_id} foi REMOVIDO.`, "warning");
            }
        });

        channel.bind('pedido-pronto', (data) => {
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

    if (nPronto === 0 && contPronto) contPronto.innerHTML = '<div class="empty-state">Nenhum pedido pronto.</div>';
    if (nPendente === 0 && contPendente) contPendente.innerHTML = '<div class="empty-state">Nenhum pedido em preparo.</div>';
    if (nEntregue === 0 && contEntregues) contEntregues.innerHTML = '<div class="empty-state">Nenhuma entrega realizada.</div>';

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
    
    let cliente = "Consumidor";
    let endereco = "Entrega no local";
    
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
        btnHtml = `<button class="btn-entregar" style="background:#bdc3c7; box-shadow:none;" disabled>
                      <i class="fas fa-check-double"></i> CONCLUÍDO
                   </button>`;
    } else {
        const isReady = displayStatus === 'a-caminho';
        btnHtml = `<button class="btn-entregar" ${!isReady ? 'disabled' : ''} onclick="confirmarEntrega(${p.id}, this)">
                      ${isReady ? '<i class="fas fa-motorcycle"></i> CONFIRMAR ENTREGA' : '<i class="fas fa-clock"></i> EM PREPARO'}
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
            <div class="endereco-info"><i class="fas fa-map-marker-alt"></i> ${endereco}</div>
            <div class="pedido-itens">
                ${p.itens.map(i => {
                    let itemStatusLabel = translateStatus(i.status);
                    if (displayStatus === 'a-caminho' && i.status.toLowerCase() === 'entregue') {
                        itemStatusLabel = 'A CAMINHO';
                    }
                    return `<div class="item-row"><span>${i.quantidade}x ${i.nome}</span></div>`;
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
        text: `O pedido #${id} foi entregue?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#27ae60',
        cancelButtonColor: '#95a5a6',
        confirmButtonText: 'Sim, entreguei!',
        cancelButtonText: 'Cancelar'
    });

    if (!isConfirmed) return;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>...';

    try {
        const res = await fetch(`/api/pedidos/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'aguardando_fechamento' })
        });

        if (res.ok) {
            showToast(`Pedido #${id} entregue!`);
            loadPedidos();
        } else {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-motorcycle"></i> CONFIRMAR ENTREGA';
        }
    } catch (e) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-motorcycle"></i> CONFIRMAR ENTREGA';
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
    
    const icones = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle', info: 'fa-bell' };
    const html = `
        <div class="toast-icon"><i class="fas ${icones[classeTipo] || 'fa-bell'}"></i></div>
        <div class="toast-content">
            <strong>${titulo || 'Aviso'}</strong>
            <span>${msg}</span>
        </div>
    `;

    t.innerHTML = html;
    container.appendChild(t);

    setTimeout(() => t.classList.add('show'), 10);
    const autoClose = setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 500);
    }, duracao);

    if (soundEnabled && typeof audioNotificacao !== 'undefined') {
        audioNotificacao.play().catch(e => {});
    }
}

function showToast(msg, type = 'info') {
    mostrarToast(msg, type);
}
