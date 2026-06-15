const axios = require('axios');
require('dotenv').config();

const API_URL = 'http://localhost:3001';

async function runHealthCheck() {
  console.log('🤖 INICIANDO ROBÔ DE VERIFICAÇÃO (Health Check)...\n');
  let errors = 0;

  // 1. Verificar Servidor Online
  try {
    const res = await axios.get(`${API_URL}/api/mesas`);
    console.log('✅ API: OK (Servidor está respondendo)');
    
    // 2. Verificar Banco de Dados (Mesas)
    if (Array.isArray(res.data)) {
      console.log(`✅ BANCO DE DADOS: OK (Encontradas ${res.data.length} mesas)`);
    } else {
      console.error('❌ BANCO DE DADOS: Erro (O formato das mesas está incorreto)');
      errors++;
    }
  } catch (e) {
    console.error(`❌ API/BANCO: Erro (Não foi possível conectar: ${e.message})`);
    errors++;
  }

  // 3. Verificar Cardápio
  try {
    const res = await axios.get(`${API_URL}/api/menu`);
    if (Array.isArray(res.data) && res.data.length > 0) {
      console.log(`✅ CARDÁPIO: OK (Encontrados ${res.data.length} itens)`);
    } else {
      console.error('❌ CARDÁPIO: Erro (Não foi possível carregar os itens)');
      errors++;
    }
  } catch (e) {
    console.error(`❌ CARDÁPIO: Erro (${e.message})`);
    errors++;
  }

  // 4. Verificar Configurações do Pusher
  const pusherConfig = process.env.PUSHER_APP_ID && process.env.PUSHER_APP_KEY;
  if (pusherConfig) {
    console.log('✅ PUSHER: Configurações encontradas no .env');
  } else {
    console.error('❌ PUSHER: Erro (Credenciais ausentes no .env)');
    errors++;
  }

  console.log('\n----------------------------------------');
  if (errors === 0) {
    console.log('🎉 SISTEMA PARECE ESTAR 100% OPERACIONAL!');
  } else {
    console.log(`⚠️ FORAM ENCONTRADOS ${errors} ERROS NO SISTEMA.`);
  }
  console.log('----------------------------------------\n');
}

runHealthCheck();