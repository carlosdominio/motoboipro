const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const botUrl = process.env.WHATSAPP_BOT_URL || 'https://meu-zap-bot.onrender.com/';
const targetNumber = process.env.WHATSAPP_NOTIFY_NUMBER || '558293157048';

async function testNotification() {
    console.log('🧪 Iniciando TESTE DE ENVIO via Robô...');
    console.log('🔗 Destino:', botUrl);
    console.log('📱 Para:', targetNumber);

    try {
        const url = botUrl.endsWith('/') ? botUrl : botUrl + '/';
        const res = await axios.post(`${url}api/notify-delivery`, {
            number: targetNumber,
            status: 'recebido',
            pedidoId: 'TESTE-ROBO-99',
            tempo: '10 min'
        });

        console.log('✅ SUCESSO! Resposta do Bot:', res.data);
        console.log('\n🏆 Teste concluído. Verifique seu WhatsApp!');
    } catch (e) {
        console.error('❌ FALHA NO TESTE:', e.message);
        if (e.response) console.error('Detalhes:', e.response.data);
    }
}

testNotification();
