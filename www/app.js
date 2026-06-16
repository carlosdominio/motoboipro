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
        lastPushToken: null,
        soundEnabled: localStorage.getItem('motoboy_sound') !== 'false',
        // Conjunto de IDs já notificados para evitar duplicidade (Pusher + FCM)
        notifiedIds: new Set()
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

        // Solicita áudio ao usuário se for o primeiro acesso
        if (!localStorage.getItem('audio_unlocked')) {
            this.ui.requestAudioUnlock();
        }
        
        this.ui.updateSoundIcon();
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
        if (!form) return;
        
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
                        title: 'Acesso Autorizado',
                        text: `Olá ${data.garcom.nome}, bom trabalho!`,
                        icon: 'success',
                        timer: 2000,
                        showConfirmButton: false
                    });

                    setTimeout(() => location.reload(), 2000);
                } else {
                    console.log('❌ Falha no login: Dados inválidos');
                    Swal.fire({
                        title: 'Acesso Negado',
                        text: 'Usuário ou senha incorretos. Tente novamente.',
                        icon: 'error',
                        confirmButtonColor: '#e74c3c'
                    });
                    btn.disabled = false;
                    btn.innerHTML = 'ENTRAR NO APP <i class="fas fa-arrow-right"></i>';
                }
            } catch (e) {
                console.error('❌ Erro na requisição de login:', e);
                Swal.fire('Erro de Conexão', 'Verifique sua internet.', 'warning');
                btn.disabled = false;
                btn.innerHTML = 'ENTRAR NO APP <i class="fas fa-arrow-right"></i>';
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
            if (screen) {
                screen.style.display = this.state.caixaAberto ? 'none' : 'flex';
                document.body.style.overflow = this.state.caixaAberto ? '' : 'hidden';
            }
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
            if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;

            const { PushNotifications, LocalNotifications } = Capacitor.Plugins;

            let perm = await PushNotifications.checkPermissions();
            if (perm.receive !== 'granted') {
                perm = await PushNotifications.requestPermissions();
            }

            if (perm.receive === 'granted') {
                await PushNotifications.createChannel({
                    id: NOTIFICATION_CHANNEL_ID,
                    name: 'Pedidos e Alertas',
                    description: 'Notificações de novos pedidos',
                    sound: 'notificacao.mp3',
                    importance: 5,
                    visibility: 1,
                    vibration: true
                });
                await PushNotifications.register();
            }

            PushNotifications.addListener('registration', (token) => {
                App.state.lastPushToken = token.value;
                this.syncToken(token.value);
            });

            PushNotifications.addListener('pushNotificationReceived', (notification) => {
                App.loadPedidos();
                // Deduplicação por ID e Timestamp (evita eco de milissegundos)
                const pId = String(notification.id || notification.data?.pedido_id || '');
                if (pId && !App.state.notifiedIds.has(pId)) {
                    App.state.notifiedIds.add(pId);
                    setTimeout(() => App.state.notifiedIds.delete(pId), 10000); // Limpa após 10s
                    this.showLocal(notification.title, notification.body, notification.data);
                }
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
            } catch (e) {}
        },

        async showLocal(title, body, data = {}) {
            this.playAlert();

            if (window.Capacitor && window.Capacitor.isNativePlatform()) {
                try {
                    const { LocalNotifications } = Capacitor.Plugins;
                    const notificationId = Math.floor(Math.random() * 1000000);
                    await LocalNotifications.schedule({
                        notifications: [{
                            title: title || 'GarçomExpress',
                            body: body || '',
                            id: notificationId,
                            schedule: { at: new Date(Date.now() + 100) },
                            sound: 'notificacao.mp3',
                            smallIcon: 'ic_stat_notification',
                            channelId: NOTIFICATION_CHANNEL_ID,
                            extra: data
                        }]
                    });
                } catch (err) { console.error(err); }
            }
            App.ui.showToast(body, 'info', title);
        },

        playAlert() {
            if (!App.state.soundEnabled) return;
            this.audio.play().catch(e => console.log('Áudio bloqueado:', e));
        },

        toggleSound() {
            App.state.soundEnabled = !App.state.soundEnabled;
            localStorage.setItem('motoboy_sound', App.state.soundEnabled);
            App.ui.updateSoundIcon();
            
            if (App.state.soundEnabled) {
                this.playAlert();
                App.ui.showToast("Som ativado!", "success");
            } else {
                App.ui.showToast("Som silenciado.", "warning");
            }
        }
    },

    // --- REAL-TIME ---
    pusher: {
        instance: null,
        channel: null,

        async init() {
            try {
                const res = await fetch(`${API_BASE_URL}/api/pusher-config`);
                const config = await res.json();
                this.instance = new Pusher(config.key, { cluster: config.cluster, forceTLS: true });
                this.channel = this.instance.subscribe('garconnexpress');
                
                this.channel.bind('status-caixa-atualizado', (data) => App.checkCaixaStatus());

                this.channel.bind('status-atualizado', (data) => {
                    if (data.garcom_id !== 'DELIVERY') return;
                    App.loadPedidos();
                    const pId = String(data.pedido_id || '');
                    if (['cancelado', 'pronto'].includes(data.status) && pId && !App.state.notifiedIds.has(pId)) {
                        App.state.notifiedIds.add(pId);
                        setTimeout(() => App.state.notifiedIds.delete(pId), 10000);
                        
                        const title = data.status === 'cancelado' ? '❌ PEDIDO CANCELADO' : '🍳 PEDIDO PRONTO';
                        const body = `Pedido #${pId} ${data.status === 'cancelado' ? 'cancelado' : 'pronto'}!`;
                        App.notifications.showLocal(title, body);
                    }
                });

                this.channel.bind('novo-pedido', (data) => {
                    const p = data.pedido || data;
                    if (p.garcom_id !== 'DELIVERY') return;
                    App.loadPedidos();
                    const pId = String(p.id || p.pedido_id || '');
                    if (pId && !App.state.notifiedIds.has(pId)) {
                        App.state.notifiedIds.add(pId);
                        setTimeout(() => App.state.notifiedIds.delete(pId), 10000);
                        App.notifications.showLocal(`🆕 NOVO DELIVERY`, `Pedido #${pId} recebido!`);
                    }
                });

                this.channel.bind('pedido-cancelado', (data) => {
                    const pId = String(data.pedido_id || data.id || (data.pedido ? data.pedido.id : '') || '');
                    if (String(data.garcom_id) !== 'DELIVERY' && !(data.pedido && String(data.pedido.garcom_id) === 'DELIVERY')) return;
                    App.loadPedidos();
                    if (pId && !App.state.notifiedIds.has(pId)) {
                        App.state.notifiedIds.add(pId);
                        setTimeout(() => App.state.notifiedIds.delete(pId), 10000);
                        App.notifications.showLocal(`❌ PEDIDO REMOVIDO`, `O pedido #${pId} foi cancelado.`);
                    }
                });
            } catch (e) {}
        }
    },

    // --- UI ---
    ui: {
        updateSoundIcon() {
            const btn = document.getElementById('btn-toggle-sound');
            if (!btn) return;
            btn.innerHTML = App.state.soundEnabled ? '<i class="fas fa-bell"></i>' : '<i class="fas fa-bell-slash"></i>';
            if (App.state.soundEnabled) btn.classList.remove('muted'); else btn.classList.add('muted');
        },

        requestAudioUnlock() {
            Swal.fire({
                title: 'Ativar Alertas?',
                text: 'Clique para ativar o som de notificações.',
                icon: 'info',
                confirmButtonText: 'ATIVAR ÁUDIO',
                confirmButtonColor: '#e67e22'
            }).then((r) => {
                if (r.isConfirmed) {
                    localStorage.setItem('audio_unlocked', 'true');
                    App.notifications.playAlert();
                }
            });
        },

        renderPedidos() {
            const sections = {
                'a-caminho': document.getElementById('container-a-caminho'),
                'pendente': document.getElementById('container-pendentes'),
                'entregue': document.getElementById('container-entregues')
            };
            const counts = {
                'a-caminho': document.getElementById('count-pronto'),
                'pendente': document.getElementById('count-pendente'),
                'entregue': document.getElementById('count-entregues')
            };

            if (!sections['a-caminho']) return;

            // Limpa tudo para evitar duplicados
            Object.values(sections).forEach(s => { if(s) s.innerHTML = ''; });
            const n = { 'a-caminho': 0, 'pendente': 0, 'entregue': 0 };

            App.state.pedidos.forEach(p => {
                const s = p.status.toLowerCase();
                let cat = 'pendente';
                if (s === 'entregue' || s === 'aguardando_fechamento') cat = 'entregue';
                else if (['pronto', 'servido', 'saiu_entrega'].includes(s)) cat = 'a-caminho';
                
                if (sections[cat]) {
                    sections[cat].appendChild(this.createCard(p, cat));
                    n[cat]++;
                }
            });

            Object.keys(sections).forEach(k => {
                if (sections[k] && n[k] === 0) sections[k].innerHTML = '<div class="empty-state">Nenhum pedido.</div>';
                if (counts[k]) counts[k].innerText = n[k];
            });
        },

        createCard(p, cat) {
            const card = document.createElement('div');
            card.className = `pedido-card ${cat}`;
            const time = new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const isDone = cat === 'entregue';
            
            card.innerHTML = `
                <div class="pedido-header">
                    <span class="pedido-id">#${p.id}</span>
                    <span class="pedido-total">R$ ${parseFloat(p.total).toFixed(2).replace('.', ',')}</span>
                </div>
                <div class="pedido-body">
                    <div class="endereco-info"><i class="fas fa-map-marker-alt"></i> Pedido Delivery</div>
                    <div class="pedido-itens">${p.itens.map(i => `${i.quantidade}x ${i.nome}`).join(', ')}</div>
                </div>
                ${!isDone ? `<button class="btn-entregar" onclick="App.ui.confirmarEntrega(${p.id}, this)">CONFIRMAR ENTREGA</button>` : ''}
            `;
            return card;
        },

        async confirmarEntrega(id, btn) {
            const { isConfirmed } = await Swal.fire({ title: 'Entregue?', text: `Pedido #${id}`, icon: 'question', showCancelButton: true });
            if (!isConfirmed) return;
            btn.disabled = true;
            try {
                const res = await fetch(`${API_BASE_URL}/api/pedidos/${id}/status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.state.token}` },
                    body: JSON.stringify({ status: 'aguardando_fechamento' })
                });
                if (res.ok) App.loadPedidos(); else btn.disabled = false;
            } catch (e) { btn.disabled = false; }
        },

        showToast(msg, tipo = 'success', titulo = '') {
            let c = document.getElementById('toast-container');
            if (!c) { c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); }
            const t = document.createElement('div');
            t.className = `toast-notificacao ${tipo}`;
            t.innerHTML = `<div class="toast-content"><strong>${titulo}</strong><br>${msg}</div>`;
            c.appendChild(t);
            setTimeout(() => t.classList.add('show'), 10);
            setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 4000);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
window.App = App;
