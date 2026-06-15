const io = require('socket.io-client');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const url = process.env.WHATSAPP_BOT_URL;
console.log('🔗 Tentando conectar a:', url);

if (!url) {
    console.error('❌ Erro: WHATSAPP_BOT_URL não definida no .env');
    process.exit(1);
}

const socket = io(url, {
    reconnection: false,
    timeout: 5000
});

socket.on('connect', () => {
    console.log('✅ CONECTADO com sucesso ao Bot!');
    socket.emit('check_status', (res) => {
        console.log('📊 Status do Bot:', res);
        process.exit(0);
    });
    
    // Se não receber resposta em 3 segundos, encerra
    setTimeout(() => {
        console.log('⚠️ Conectado, mas o Bot não respondeu ao check_status.');
        process.exit(0);
    }, 3000);
});

socket.on('connect_error', (err) => {
    console.error('❌ Erro de conexão:', err.message);
    process.exit(1);
});

setTimeout(() => {
    console.error('⏰ Timeout ao tentar conectar.');
    process.exit(1);
}, 10000);
