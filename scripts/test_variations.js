const io = require('socket.io-client');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const url = process.env.WHATSAPP_BOT_URL || 'https://meu-zap-bot.onrender.com/';

// Variações para o número 82 9315-7048
const variacoes = [
    '558293157048',   // Sem o primeiro 9 (formato que FUNCIONOU)
    '5582993157048',  // Com o primeiro 9 (formato antigo/extra)
    '8293157048',     // Sem 55 e sem o primeiro 9
    '82993157048'      // Sem 55 e com o primeiro 9
];

console.log('🔗 Conectando a:', url);
const socket = io(url);

socket.on('connect', () => {
    console.log('✅ Conectado! Enviando 4 variações de teste...');
    
    variacoes.forEach((num, index) => {
        console.log(`📤 Teste ${index + 1}: Enviando para ${num}`);
        socket.emit('send_msg', {
            number: num,
            text: `🤖 *TESTE DE FORMATO ${index + 1}*\nNúmero: ${num}\nVerificando qual formato chega no seu celular.`
        });
    });

    console.log('🏁 Aguardando confirmação de envio...');
    setTimeout(() => {
        console.log('🏁 Fim do teste de variações.');
        process.exit(0);
    }, 8000);
});

socket.on('connect_error', (err) => {
    console.error('❌ Erro:', err.message);
    process.exit(1);
});
