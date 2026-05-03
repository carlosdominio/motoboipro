require('dotenv').config();
require('dotenv').config();
const Pusher = require('pusher');
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_APP_KEY,
  secret: process.env.PUSHER_APP_SECRET,
  cluster: process.env.PUSHER_CLUSTER || 'sa1',
  useTLS: true
});

console.log('📡 Enviando teste de atualização em tempo real...');
pusher.trigger('garconnexpress', 'status-atualizado', {
  mesa_id: 1,
  mesa_numero: '1',
  status: 'servido'
}).then(() => console.log('✅ Sinal enviado! Veja se o garçom atualizou.')).catch(e => console.error('❌ Erro no Pusher:', e.message));