const io = require('socket.io-client');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const url = process.env.WHATSAPP_BOT_URL || 'https://meu-zap-bot.onrender.com/';
const number = '558293157048'; 

console.log('🔗 Conectando a:', url);
const socket = io(url);

socket.on('connect', () => {
    console.log('✅ Conectado! Enviando mensagens de teste para o contato "Você"...');
    
    // Teste 1: Formato padrão
    socket.emit('send_msg', {
        number: number,
        text: '🤖 *TESTE 1 (Padrão)*\nOlá! Testando envio para o próprio número.'
    });

    // Teste 2: Formato com sufixo interno
    socket.emit('send_msg', {
        number: `${number}@c.us`,
        text: '🤖 *TESTE 2 (@c.us)*\nOlá! Testando envio forçado para o próprio número.'
    });

    console.log('📤 Mensagens emitidas. Verifique seu WhatsApp (conversa com você mesmo).');
    setTimeout(() => {
        console.log('🏁 Fim do teste.');
        process.exit(0);
    }, 5000);
});

socket.on('connect_error', (err) => {
    console.error('❌ Erro:', err.message);
    process.exit(1);
});
