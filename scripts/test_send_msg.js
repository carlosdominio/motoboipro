const io = require('socket.io-client');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const url = process.env.WHATSAPP_BOT_URL;
const number = '558293157048'; // Número fornecido pelo usuário

console.log('🔗 Conectando a:', url);
const socket = io(url);

socket.on('connect', () => {
    console.log('✅ Conectado! Enviando mensagem de teste para:', number);
    
    socket.emit('send_msg', {
        number: number,
        text: '🤖 *TESTE DO SISTEMA*\n\nOlá! Esta é uma mensagem de teste do sistema Garçom Express para validar seu número.'
    });

    console.log('📤 Mensagem emitida. Aguardando 5 segundos...');
    setTimeout(() => {
        console.log('🏁 Fim do teste.');
        process.exit(0);
    }, 5000);
});

socket.on('connect_error', (err) => {
    console.error('❌ Erro:', err.message);
    process.exit(1);
});
