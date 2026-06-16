/**
 * Motoboy Express - Aplicativo Nativo (Remake Pro)
 * Versão 2.0.3 - Estabilidade Máxima
 */

const API_BASE_URL = 'https://garconnexpress.vercel.app';
const NOTIFICATION_CHANNEL_ID = 'pedidos';

const App = {
    state: {
        token: localStorage.getItem('motoboy_token'),
        user: JSON.parse(localStorage.getItem('motoboy_user') || '{}'),
        pedidos: [],
        caixaAberto: true,
        soundEnabled: localStorage.getItem('motoboy_sound') !== 'false',
        notifiedEvents: new Set() // Para evitar duplicidade estrita (evento + id)
    },

    async init() {
        console.log('🛵 Inicializando Motoboy App v2.0.3...');
        
        if (!this.checkAuth()) return;

        try {
            await this.notifications.init();
            await this.pusher.init();
        } catch (e) {
            console.error('Erro na inicialização de módulos:', e);
        }
        
        this.checkCaixaStatus();
        setInterval(() => this.checkCaixaStatus(), 30000);

        this.loadPedidos();

        this.ui.updateSoundIcon();
        if (!localStorage.getItem('audio_unlocked')) {
            this.ui.requestAudioUnlock();
        }
    },

    checkAuth() {
        const screen = document.getElementById('login-screen');
        if (!this.state.token) {
            if (screen) screen.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            this.setupLoginForm();
            return false;
        }
        if (screen) screen.style.display = 'none';
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
            const btn = document.getElementById('btn-login-submit');

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ENTRANDO...';
            }

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
                    console.log('❌ Login falhou: Resposta do servidor indicou falha.');
                    Swal.fire({
                        title: 'Acesso Negado',
                        text: 'Usuário ou senha incorretos. Verifique seus dados e tente novamente.',
                        icon: 'error',
                        confirmButtonColor: '#e74c3c',
                        confirmButtonText: 'TENTAR NOVAMENTE',
                        customClass: {
                            container: 'my-swal-container'
                        }
                    });
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = 'ENTRAR NO APP <i class="fas fa-arrow-right"></i>';
                    }
                }
            } catch (err) {
                console.error('❌ Erro na requisição de login (catch block):', err);
                Swal.fire({
                    title: 'Erro de Conexão',
                    text: 'Não foi possível conectar ao servidor. Verifique sua internet.',
                    icon: 'warning',
                    confirmButtonText: 'OK',
                    customClass: {
                        container: 'my-swal-container'
                    }
                });
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = 'ENTRAR NO APP <i class="fas fa-arrow-right"></i>';
                }
            }
        };
    },

    async loadPedidos() {
        if (!this.state.token) return;
        try {
            const res = await fetch(`${API_BASE_URL}/api/pedidos/ativos-detalhado`, {
                headers: { 'Authorization': `Bearer ${this.state.token}` }
            });
            
            if (res.status === 401 || res.status === 403) {
                this.logout();
                return;
            }

            const allPedidos = await res.json();
            this.state.pedidos = Array.isArray(allPedidos) ? allPedidos.filter(p => p.garcom_id === 'DELIVERY') : [];
            this.ui.renderPedidos();
        } catch (e) {
            console.error('Erro ao carregar pedidos:', e);
        }
    },

    async checkCaixaStatus() {
        try {
            const res = await fetch(`${API_BASE_URL}/api/caixa/status`);
            const status = await res.json();
            this.state.caixaAberto = !!status;
            const screen = document.getElementById('closed-screen');
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

            const { PushNotifications } = Capacitor.Plugins;

            let perm = await PushNotifications.checkPermissions();
            if (perm.receive !== 'granted') {
                perm = await PushNotifications.requestPermissions();
            }

            if (perm.receive === 'granted') {
                await PushNotifications.createChannel({
                    id: NOTIFICATION_CHANNEL_ID,
                    name: 'Pedidos e Alertas',
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
                // O app já mostra o banner nativo. Apenas tocamos o som extra e disparamos um Toast se estiver aberto.
                // Mas bloqueamos duplicatas.
                const pId = String(notification.id || notification.data?.pedido_id || notification.data?.id || '');
                const eventKey = `push_${pId}`;
                
                if (pId && !App.state.notifiedEvents.has(eventKey)) {
                    App.state.notifiedEvents.add(eventKey);
                    setTimeout(() => App.state.notifiedEvents.delete(eventKey), 15000);
                    
                    this.playAlert();
                    App.ui.showToast(notification.body || 'Novo alerta!', 'info', notification.title);
                }
            });
        },

        async syncToken(token) {
            try {
                await fetch(`${API_BASE_URL}/api/subscribe-motoboy`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.state.token}` },
                    body: JSON.stringify({ endpoint: token })
                });
            } catch (e) {}
        },

        async showLocal(title, body, eventKey = '') {
            // Se já notificamos este evento (via Push ou Pusher recentemente), ignoramos.
            if (eventKey && App.state.notifiedEvents.has(eventKey)) return;
            if (eventKey) {
                App.state.notifiedEvents.add(eventKey);
                setTimeout(() => App.state.notifiedEvents.delete(eventKey), 15000);
            }

            this.playAlert();

            if (window.Capacitor && window.Capacitor.isNativePlatform()) {
                try {
                    const { LocalNotifications } = Capacitor.Plugins;
                    await LocalNotifications.schedule({
                        notifications: [{
                            title: title || 'GarçomExpress',
                            body: body || '',
                            id: Math.floor(Math.random() * 1000000),
                            schedule: { at: new Date(Date.now() + 100) },
                            sound: 'notificacao.mp3',
                            smallIcon: 'ic_stat_notification',
                            channelId: NOTIFICATION_CHANNEL_ID
                        }]
                    });
                } catch (err) { console.error('Erro LocalNotif:', err); }
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

    // --- REAL-TIME (PUSHER) ---
    pusher: {
        instance: null,
        channel: null,

        async init() {
            try {
                const res = await fetch(`${API_BASE_URL}/api/pusher-config`);
                const config = await res.json();
                this.instance = new Pusher(config.key, { cluster: config.cluster, forceTLS: true });
                this.channel = this.instance.subscribe('garconnexpress');
                
                this.channel.bind('status-caixa-atualizado', () => App.checkCaixaStatus());

                this.channel.bind('status-atualizado', (data) => {
                    if (data.garcom_id !== 'DELIVERY') return;
                    App.loadPedidos();
                    const pId = String(data.pedido_id || '');
                    if (['cancelado', 'pronto', 'servido', 'saiu_entrega'].includes(data.status) && pId) {
                        let title = 'Motoboy Pro';
                        let body = `Pedido #${pId} atualizado!`;
                        if (data.status === 'cancelado') { title = '❌ PEDIDO CANCELADO'; body = `Pedido #${pId} foi cancelado.`; }
                        if (data.status === 'pronto') { title = '🍳 PEDIDO PRONTO'; body = `Pedido #${pId} pronto na cozinha.`; }
                        if (data.status === 'servido' || data.status === 'saiu_entrega') { title = '🛵 A CAMINHO'; body = `Pedido #${pId} saiu para entrega!`; }
                        
                        App.notifications.showLocal(title, body, `${data.status}_${pId}`);
                    }
                });

                this.channel.bind('novo-pedido', (data) => {
                    const p = data.pedido || data;
                    if (p.garcom_id !== 'DELIVERY') return;
                    App.loadPedidos();
                    const pId = String(p.id || p.pedido_id || '');
                    if (pId) {
                        App.notifications.showLocal(`🆕 NOVO DELIVERY`, `Pedido #${pId} recebido!`, `novo_${pId}`);
                    }
                });

                this.channel.bind('pedido-cancelado', (data) => {
                    const pId = String(data.pedido_id || data.id || (data.pedido ? data.pedido.id : '') || '');
                    if (String(data.garcom_id) !== 'DELIVERY' && !(data.pedido && String(data.pedido.garcom_id) === 'DELIVERY')) return;
                    App.loadPedidos();
                    if (pId) {
                        App.notifications.showLocal(`❌ PEDIDO REMOVIDO`, `O pedido #${pId} foi cancelado.`, `cancelado_${pId}`);
                    }
                });
            } catch (e) { console.error('Erro Pusher:', e); }
        }
    },

    // --- UI ---
    ui: {
        updateSoundIcon() {
            const btn = document.getElementById('btn-toggle-sound');
            if (!btn) return;
            btn.innerHTML = App.state.soundEnabled ? '<i class="fas fa-bell"></i>' : '<i class="fas fa-bell-slash"></i>';
            btn.className = App.state.soundEnabled ? 'btn-icon' : 'btn-icon muted';
        },

        requestAudioUnlock() {
            Swal.fire({
                title: 'Ativar Alertas?',
                text: 'Clique para permitir o som de novos pedidos.',
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

            Object.values(sections).forEach(s => { if(s) s.innerHTML = ''; });
            const n = { 'a-caminho': 0, 'pendente': 0, 'entregue': 0 };

            App.state.pedidos.forEach(p => {
                const s = String(p.status).toLowerCase();
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
            const isReady = cat === 'a-caminho';

            let cliente = "Consumidor";
            let endereco = "Entrega no balcão/Local";
            if (p.observacao) {
                const lines = p.observacao.split('\n');
                const lNome = lines.find(l => l.includes('👤 Cliente:'));
                const lEnd = lines.find(l => l.includes('🏠 End:'));
                if (lNome) cliente = lNome.replace('👤 Cliente:', '').trim();
                if (lEnd) endereco = lEnd.replace('🏠 End:', '').trim();
            }

            let displayStatus = cat.replace('-', ' ').toUpperCase();
            if (cat === 'a-caminho') displayStatus = 'PRONTO / A CAMINHO';
            else if (cat === 'pendente') displayStatus = 'PREPARANDO';

            let buttonHTML = '';
            if (isDone) {
                buttonHTML = `<button class="btn-entregar" style="background:#bdc3c7; box-shadow:none; cursor:not-allowed;" disabled><i class="fas fa-check-double"></i> ENTREGUE</button>`;
            } else if (isReady) {
                buttonHTML = `<button class="btn-entregar" onclick="App.ui.confirmarEntrega(${p.id}, this)"><i class="fas fa-motorcycle"></i> CONFIRMAR ENTREGA</button>`;
            } else {
                buttonHTML = `<button class="btn-entregar" style="background:#f39c12; box-shadow: 0 4px 0 #d68910; cursor:not-allowed;" disabled><i class="fas fa-clock"></i> AGUARDANDO COZINHA</button>`;
            }

            card.innerHTML = `
                <div class="pedido-header">
                    <div>
                        <span class="pedido-id">#${p.id}</span>
                        <span class="status-badge ${cat}">${displayStatus}</span>
                    </div>
                    <div style="text-align: right;">
                        <div class="pedido-total">R$ ${parseFloat(p.total).toFixed(2).replace('.', ',')}</div>
                        <span class="pedido-time">${time}</span>
                    </div>
                </div>
                <div class="pedido-body">
                    <strong class="cliente-info">${cliente}</strong>
                    <div class="endereco-info"><i class="fas fa-map-marker-alt"></i> ${endereco}</div>
                    <div class="pedido-itens">
                        ${p.itens ? p.itens.map(i => `<div class="item-row">${i.quantidade}x ${i.nome}</div>`).join('') : ''}
                    </div>
                </div>
                ${buttonHTML}
            `;
            return card;
        },

        async confirmarEntrega(id, btn) {
            const { isConfirmed } = await Swal.fire({ title: 'Entregue?', text: `Confirmar entrega do Pedido #${id}?`, icon: 'question', showCancelButton: true, confirmButtonText: 'Sim, entregar!' });
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
            t.innerHTML = `<div class="toast-content"><strong>${titulo || ''}</strong><br>${msg}</div>`;
            c.appendChild(t);
            setTimeout(() => t.classList.add('show'), 10);
            setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 4000);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
window.App = App;
