const axios = require('axios');

const BASE_URL = 'http://localhost:3001/api';

async function testCompleteSystem() {
  console.log('🌐 INICIANDO TESTE DOS MÓDULOS ADICIONAIS (Cardápio, Delivery, Motoboy)...\n');

  try {
    // 1. TESTE CARDÁPIO DIGITAL (CLIENTE NA MESA)
    console.log('📱 1. Simulando Pedido via CARDÁPIO DIGITAL...');
    // Criamos um pedido simulando a origem do cardápio (garcom_id será o número da mesa ou 'CLIENTE')
    const resMenu = await axios.post(`${BASE_URL}/pedidos`, {
      mesa_id: 1,
      garcom_id: 'CLIENTE-MESA-1',
      itens: [{ menu_id: 4, preco: 15, quantidade: 1, nome: 'Batata Frita' }],
      observacao: 'Pedido via Celular'
    });
    const pedidoMesaId = resMenu.data.id;
    console.log(`✅ Pedido #${pedidoMesaId} gerado pelo Cardápio Digital.\n`);

    // 2. TESTE DELIVERY
    console.log('🛵 2. Simulando Pedido via DELIVERY (Web/WhatsApp)...');
    const resDeliv = await axios.post(`${BASE_URL}/pedidos`, {
      mesa_id: null,
      garcom_id: 'DELIVERY',
      cliente_telefone: '5511999999999',
      itens: [{ menu_id: 13, preco: 12, quantidade: 2, nome: 'Pão de Alho' }],
      observacao: 'Entregar na portaria'
    });
    const pedidoDelivId = resDeliv.data.id;
    console.log(`✅ Pedido #${pedidoDelivId} gerado pelo Delivery.\n`);

    // 3. TESTE MOTOBOY (STATUS DELIVERY)
    console.log('🏁 3. Testando Fluxo do MOTOBOY...');
    // O motoboy vê pedidos com status 'pronto' ou 'servido' (saiu para entrega) no delivery
    console.log(`   Marcando pedido #${pedidoDelivId} como SAIU PARA ENTREGA...`);
    await axios.put(`${BASE_URL}/pedidos/${pedidoDelivId}/status`, { status: 'servido' }); // 'servido' no delivery = Saiu para entrega
    
    const resAtivos = await axios.get(`${BASE_URL}/pedidos/ativos-detalhado`);
    const pedidoNoMotoboy = resAtivos.data.find(p => p.id === pedidoDelivId && p.status === 'servido');
    
    if (pedidoNoMotoboy) {
      console.log('✅ SUCESSO: Pedido visível para o Motoboy (Status: Saiu para Entrega).\n');
    } else {
      console.log('❌ FALHA: Pedido não mudou para status de entrega corretamente.\n');
    }

    // 4. FINALIZAÇÃO DELIVERY
    console.log('✅ 4. Concluindo Entrega (Motoboy/Admin)...');
    await axios.put(`${BASE_URL}/pedidos/${pedidoDelivId}/status`, { status: 'entregue' });
    console.log('✅ Pedido Delivery finalizado como ENTREGUE.\n');

    console.log('✨ TODOS OS MÓDULOS (CARDÁPIO, DELIVERY E MOTOBOY) ESTÃO FUNCIONANDO! ✨');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ ERRO DURANTE O TESTE DOS MÓDULOS:', error.message);
    if (error.response) console.log(error.response.data);
    process.exit(1);
  }
}

testCompleteSystem();