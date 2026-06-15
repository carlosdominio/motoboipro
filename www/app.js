/**
 * Motoboy Express - Aplicativo Nativo (Remake Pro)
 * Focado em estabilidade de notificações e experiência de entrega.
 */

const API_BASE_URL = 'https://garconnexpress.vercel.app';
const NOTIFICATION_CHANNEL_ID = 'pedidos';

const App = {
    state: {
        token: localStorage.getItem('motoboy_token'),
        user: JSON.parse(localStorage.getItem('motoboy_user') || '{}'),
        pedidos: [],
        caixaAberto: true,
        lastPushToken: null
    },

    async init() {
        console.log('🛵 Inicializando Motoboy App...');
        
        if (!this.checkAuth()) return;

        // Inicialização de componentes
        await this.notifications.init();
        await this.pusher.init();
        
        // Loop de verificação de caixa
        this.checkCaixaStatus();
        setInterval(() => this.checkCaixaStatus(), 30000);

        // Carregamento inicial
        this.loadPedidos();

        // Solicita áudio ao usuário
        this.ui.requestAudioUnlock();
    },

    checkAuth() {
        const screen = document.getElementById('login-screen');
        if (!this.state.token) {
            screen.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            this.setupLoginForm();
            return false;
        }
        screen.style.display = 'none';
        document.body.style.overflow = '';
        return true;
    },

    setupLoginForm() {
        const form = document.getElementById('login-form');
        form.onsubmit = async (e) => {
            e.preventDefault();
            const usuario = document.getElementById('login-user').value;
            const senha = document.getElementById('login-pass').value;
            const btn = form.querySelector('button');

            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> AUTENTICANDO...';

            try {
                const res = await fetch(`${API_BASE_URL}/api/login`, {
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
    },

    async loadPedidos() {
        try {
            const res = await fetch(`${API_BASE_URL}/api/pedidos/ativos-detalhado`, {
                headers: { 'Authorization': `Bearer ${this.state.token}` }
            });
            
            if (res.status === 401 || res.status === 403) {
                this.logout();
                return;
            }

            const allPedidos = await res.json();
            // Filtra apenas os pedidos de DELIVERY
            this.state.pedidos = allPedidos.filter(p => p.garcom_id === 'DELIVERY');
            this.ui.renderPedidos();
        } catch (e) {
            console.error('Erro ao carregar pedidos:', e);
        }
    },

    async checkCaixaStatus() {
        try {
            const res = await fetch(`${API_BASE_URL}/api/caixa/status`);
            const status = await res.json();
            const screen = document.getElementById('closed-screen');
            
            this.state.caixaAberto = !!status;
            screen.style.display = this.state.caixaAberto ? 'none' : 'flex';
            document.body.style.overflow = this.state.caixaAberto ? '' : 'hidden';
        } catch (e) { console.error("Erro status caixa:", e); }
    },

    logout() {
        localStorage.removeItem('motoboy_token');
        localStorage.removeItem('motoboy_user');
        location.reload();
    },

    // --- GERENCIADOR DE NOTIFICAÇÕES ---
    notifications: {
        audio: new Audio(`${API_BASE_URL}/notificacao.mp3`),

        async init() {
            if (!window.Capacitor || !window.Capacitor.isNativePlatform()) {
                console.log('🌐 Ambiente Web: Usando notificações do navegador.');
                if ("Notification" in window) Notification.requestPermission();
                return;
            }

            const { PushNotifications, LocalNotifications } = Capacitor.Plugins;

            // 1. Permissões
            let perm = await PushNotifications.checkPermissions();
            if (perm.receive !== 'granted') {
                perm = await PushNotifications.requestPermissions();
            }

            if (perm.receive === 'granted') {
                // 2. Criar canal Android
                await PushNotifications.createChannel({
                    id: NOTIFICATION_CHANNEL_ID,
                    name: 'Pedidos e Alertas',
                    description: 'Notificações de novos pedidos e atualizações de status',
                    sound: 'notificacao.mp3', // deve estar em res/raw
                    importance: 5,
                    visibility: 1,
                    vibration: true
                });

                // 3. Registrar para Push
                await PushNotifications.register();
            }

            // Listeners Push
            PushNotifications.addListener('registration', (token) => {
                console.log('✅ FCM Token:', token.value);
                App.state.lastPushToken = token.value;
                this.syncToken(token.value);
            });

            PushNotifications.addListener('pushNotificationReceived', (notification) => {
                console.log('📩 Push recebido:', notification);
                App.loadPedidos();
                // Se o app estiver aberto, o Capacitor não mostra a notificação no tray por padrão.
                // Usamos LocalNotifications para garantir o alerta visual e sonoro.
                this.showLocal(notification.title, notification.body, notification.data);
            });

            PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
                console.log('🖱️ Ação em push:', action);
                App.loadPedidos();
            });

            // Listeners Local
            LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
                console.log('🖱️ Ação em local:', action);
                App.loadPedidos();
            });
        },

        async syncToken(token) {
            try {
                await fetch(`${API_BASE_URL}/api/subscribe-motoboy`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${App.state.token}`
                    },
                    body: JSON.stringify({ endpoint: token })
                });
                console.log('✅ Token sincronizado com o servidor');
            } catch (e) {
                console.error('❌ Erro ao sincronizar token:', e);
            }
        },

        async showLocal(title, body, data = {}) {
            // Toca áudio manualmente se possível
            this.playAlert();

            if (window.Capacitor && window.Capacitor.isNativePlatform()) {
                const { LocalNotifications } = Capacitor.Plugins;
                await LocalNotifications.schedule({
                    notifications: [{
                        title,
                        body,
                        id: Date.now(),
                        schedule: { at: new Date(Date.now() + 100) },
                        sound: 'notificacao.mp3',
                        attachments: null,
                        actionTypeId: '',
                        extra: data,
                        channelId: NOTIFICATION_CHANNEL_ID
                    }]
                });
            } else {
                // Fallback Browser
                if ("Notification" in window && Notification.permission === "granted") {
                    new Notification(title, { body, icon: 'favicon.svg' });
                }
            }
            
            // Mostra toast visual no app
            App.ui.showToast(body, 'info', title);
        },

        playAlert() {
            this.audio.play().catch(e => console.log('Áudio bloqueado:', e));
        }
    },

    // --- GERENCIADOR DE EVENTOS REAL-TIME ---
    pusher: {
        instance: null,
        channel: null,

        async init() {
            try {
                const res = await fetch(`${API_BASE_URL}/api/pusher-config`);
                const config = await res.json();
                
                this.instance = new Pusher(config.key, {
                    cluster: config.cluster,
                    forceTLS: true
                });

                this.channel = this.instance.subscribe('garconnexpress');
                
                // Evento de Caixa
                this.channel.bind('status-caixa-atualizado', (data) => {
                    App.checkCaixaStatus();
                    if (data.status === 'fechado') {
                        App.ui.showToast("O expediente foi encerrado.", "warning");
                    }
                });

                // Eventos de Pedido
                this.channel.bind('status-atualizado', (data) => {
                    if (data.garcom_id !== 'DELIVERY') return;
                    App.loadPedidos();
                    
                    if (data.status === 'cancelado') {
                        App.notifications.showLocal(`❌ PEDIDO CANCELADO`, `O pedido #${data.pedido_id} foi cancelado.`);
                    } else if (data.status === 'pronto' || data.status === 'servido') {
                        App.notifications.showLocal(`🍳 PEDIDO PRONTO`, `O pedido #${data.pedido_id} está pronto para entrega.`);
                    }
                });

                this.channel.bind('novo-pedido', (data) => {
                    const pedido = data.pedido || data;
                    if (pedido.garcom_id !== 'DELIVERY') return;
                    App.loadPedidos();
                    App.notifications.showLocal(`🆕 NOVO DELIVERY`, `Pedido #${pedido.id || pedido.pedido_id} recebido!`);
                });

                this.channel.bind('pedido-cancelado', (data) => {
                    if (String(data.garcom_id) !== 'DELIVERY') return;
                    App.loadPedidos();
                    App.notifications.showLocal(`❌ PEDIDO REMOVIDO`, `Pedido #${data.id || data.pedido_id} foi cancelado.`);
                });

                this.channel.bind('pedido-pronto', (data) => {
                    if (String(data.garcom_id) !== 'DELIVERY') return;
                    App.loadPedidos();
                    App.notifications.showLocal(`🍳 COZINHA: PRONTO`, `O pedido de delivery está pronto!`);
                });

            } catch (e) {
                console.error('Erro Pusher:', e);
            }
        }
    },

    // --- INTERFACE DO USUÁRIO ---
    ui: {
        requestAudioUnlock() {
            Swal.fire({
                title: 'Ativar Alertas?',
                text: 'Clique para ativar o som de novos pedidos e notificações.',
                icon: 'info',
                confirmButtonText: '<i class="fas fa-volume-up"></i> ATIVAR ÁUDIO',
                confirmButtonColor: '#e67e22',
                allowOutsideClick: false
            }).then((result) => {
                if (result.isConfirmed) {
                    App.notifications.playAlert();
                    this.showToast("Áudio e notificações ativos!", "success");
                }
            });
        },

        renderPedidos() {
            const contPronto = document.getElementById('container-a-caminho');
            const contPendente = document.getElementById('container-pendentes');
            const contEntregues = document.getElementById('container-entregues');
            
            const countPronto = document.getElementById('count-pronto');
            const countPendente = document.getElementById('count-pendente');
            const countEntregues = document.getElementById('count-entregues');

            contPronto.innerHTML = '';
            contPendente.innerHTML = '';
            contEntregues.innerHTML = '';

            let nPronto = 0, nPendente = 0, nEntregue = 0;

            App.state.pedidos.forEach(p => {
                const status = p.status.toLowerCase();
                if (status === 'aguardando_fechamento' || status === 'entregue') {
                    contEntregues.appendChild(this.createCard(p, 'entregue'));
                    nEntregue++;
                } else if (status === 'servido' || status === 'pronto' || status === 'saiu_entrega') {
                    contPronto.appendChild(this.createCard(p, 'a-caminho'));
                    nPronto++;
                } else {
                    contPendente.appendChild(this.createCard(p, 'pendente'));
                    nPendente++;
                }
            });

            if (nPronto === 0) contPronto.innerHTML = '<div class="empty-state">Nenhum pedido pronto.</div>';
            if (nPendente === 0) contPendente.innerHTML = '<div class="empty-state">Nenhum pedido em preparo.</div>';
            if (nEntregue === 0) contEntregues.innerHTML = '<div class="empty-state">Nenhuma entrega realizada hoje.</div>';

            countPronto.innerText = nPronto;
            countPendente.innerText = nPendente;
            countEntregues.innerText = nEntregue;
        },

        createCard(p, displayStatus) {
            const card = document.createElement('div');
            card.className = `pedido-card ${displayStatus}`;
            
            let cliente = "Consumidor";
            let endereco = "Entrega no balcão/Local";
            if (p.observacao) {
                const lines = p.observacao.split('\n');
                const lNome = lines.find(l => l.includes('👤 Cliente:'));
                const lEnd = lines.find(l => l.includes('🏠 End:'));
                if (lNome) cliente = lNome.replace('👤 Cliente:', '').trim();
                if (lEnd) endereco = lEnd.replace('🏠 End:', '').trim();
            }

            const time = new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const isReady = displayStatus === 'a-caminho';
            const isDone = displayStatus === 'entregue';

            card.innerHTML = `
                <div class="pedido-header">
                    <div>
                        <span class="pedido-id">#${p.id}</span>
                        <span class="status-badge ${displayStatus}">${displayStatus.replace('-', ' ')}</span>
                    </div>
                    <div style="text-align: right;">
                        <div class="pedido-total">R$ ${parseFloat(p.total).toFixed(2).replace('.', ',')}</div>
                        <span class="pedido-time">${time}</span>
                    </div>
                </div>
                <div class="pedido-body">
                    <span class="cliente-info">${cliente}</span>
                    <span class="endereco-info"><i class="fas fa-map-marker-alt"></i> ${endereco}</span>
                    <div class="pedido-itens">
                        ${p.itens.map(i => `<div class="item-row"><span>${i.quantidade}x ${i.nome}</span></div>`).join('')}
                    </div>
                </div>
                ${!isDone ? `
                    <button class="btn-entregar" ${!isReady ? 'disabled' : ''} onclick="App.ui.confirmarEntrega(${p.id}, this)">
                        ${isReady ? '<i class="fas fa-check"></i> CONFIRMAR ENTREGA' : '<i class="fas fa-clock"></i> EM PREPARO'}
                    </button>
                ` : `
                    <button class="btn-entregar" style="background:#95a5a6; box-shadow:none;" disabled>
                        <i class="fas fa-check-double"></i> ENTREGUE
                    </button>
                `}
            `;
            return card;
        },

        async confirmarEntrega(id, btn) {
            const { isConfirmed } = await Swal.fire({
                title: 'Confirmar Entrega?',
                text: `Pedido #${id} foi entregue?`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#27ae60',
                confirmButtonText: 'Sim, entregue!'
            });

            if (!isConfirmed) return;

            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>...';

            try {
                const res = await fetch(`${API_BASE_URL}/api/pedidos/${id}/status`, {
                    method: 'PUT',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${App.state.token}`
                    },
                    body: JSON.stringify({ status: 'aguardando_fechamento' })
                });

                if (res.ok) {
                    this.showToast(`Pedido #${id} entregue!`);
                    App.loadPedidos();
                } else {
                    this.showToast("Erro ao confirmar.", "error");
                    btn.disabled = false;
                    btn.innerHTML = 'CONFIRMAR ENTREGA';
                }
            } catch (e) {
                this.showToast("Erro de conexão.", "error");
                btn.disabled = false;
            }
        },

        showToast(msg, tipo = 'success', titulo = '') {
            let container = document.getElementById('toast-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'toast-container';
                document.body.appendChild(container);
            }

            const t = document.createElement('div');
            t.className = `toast-notificacao ${tipo}`;
            
            const icones = { success: '✅', error: '❌', warning: '⚠️', info: '🔔' };
            t.innerHTML = `
                <div class="toast-icon">${icones[tipo] || '🔔'}</div>
                <div class="toast-content">
                    ${titulo ? `<strong class="toast-title">${titulo}</strong>` : ''}
                    <span class="toast-msg">${msg}</span>
                </div>
                <button class="toast-close">&times;</button>
            `;

            container.appendChild(t);
            setTimeout(() => t.classList.add('show'), 10);
            const autoClose = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 5000);

            t.querySelector('.toast-close').onclick = () => {
                clearTimeout(autoClose);
                t.classList.remove('show');
                setTimeout(() => t.remove(), 400);
            };
        }
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
window.App = App; // Para acesso via onclick
