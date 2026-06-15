const axios = require('axios');

const BASE_URL = 'http://localhost:3001/api';

async function testBalcao() {
  console.log('🏪 Iniciando Teste de Pedido de BALCÃO...\n');

  try {
    // 1. Criar Pedido de Balcão (mesa_id null)
    console.log('📝 1. Lançando Pedido de Balcão...');
    const pedidoRes = await axios.post(`${BASE_URL}/pedidos`, {
      mesa_id: null,
      garcom_id: 'ADMIN',
      itens: [
        { menu_id: 4, preco: 15, quantidade: 1, nome: 'Batata Frita', observacao: 'Sem sal' }
      ]
    });
    const pedidoId = pedidoRes.data.id;
    console.log(`✅ Pedido de Balcão #${pedidoId} criado com sucesso.\n`);

    // 2. Verificar se aparece na Cozinha
    console.log('🍳 2. Verificando se o pedido chegou na Cozinha...');
    const cozinhaRes = await axios.get(`${BASE_URL}/pedidos/cozinha`);
    const pedidoNaCozinha = cozinhaRes.data.find(p => p.pedido_id === pedidoId);
    
    if (pedidoNaCozinha) {
      console.log('✅ SUCESSO: Pedido de Balcão identificado na Cozinha.');
      console.log(`   Rótulo: ${pedidoNaCozinha.mesa_numero || 'BALCÃO'}`);
    } else {
      console.log('❌ FALHA: Pedido de Balcão não encontrado na Cozinha.');
      process.exit(1);
    }
    console.log('');

    // 3. Simular Preparo e Entrega
    console.log('🍳 3. Marcando pedido como PRONTO na Cozinha...');
    await axios.put(`${BASE_URL}/pedidos/${pedidoId}/cozinha-pronto`);
    console.log('✅ Pedido marcado como PRONTO.\n');

    // 4. Finalizar e Pagar (Fluxo de Balcão é geralmente rápido)
    console.log('💰 4. Finalizando e Pagando Pedido de Balcão...');
    await axios.put(`${BASE_URL}/pedidos/${pedidoId}/status`, { status: 'entregue' });
    console.log('✅ Pedido de Balcão finalizado e pago.\n');

    console.log('✨ TESTE DE BALCÃO FINALIZADO COM SUCESSO! ✨');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ ERRO DURANTE O TESTE DE BALCÃO:', error.message);
    process.exit(1);
  }
}

testBalcao();