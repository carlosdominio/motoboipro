const http = require('http');

async function request(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3002,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', (e) => reject(e));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  console.log('🚀 Iniciando teste de cancelamento na porta 3002...');

  try {
    const menu = await request('/api/menu');
    const item = menu.find(i => i.id === 4) || menu[0];

    console.log(`📝 Criando pedido com item: ${item.nome}`);
    const resPedido = await request('/api/pedidos', 'POST', {
      garcom_id: 'admin',
      itens: [{ menu_id: item.id, quantidade: 1, preco: item.preco }]
    });

    const pedidoId = resPedido.id;
    console.log(`✅ Pedido #${pedidoId} criado.`);

    let cozinha = await request('/api/pedidos/cozinha');
    let estaNaCozinha = cozinha.some(i => i.pedido_id === pedidoId);
    console.log(`🍳 Pedido está na cozinha? ${estaNaCozinha ? 'SIM' : 'NÃO'}`);

    if (!estaNaCozinha) {
      console.log('❌ Erro: O pedido deveria estar na cozinha.');
      return;
    }

    console.log(`🗑️ Cancelando pedido #${pedidoId}...`);
    await request(`/api/pedidos/${pedidoId}/status`, 'PUT', { status: 'cancelado' });

    cozinha = await request('/api/pedidos/cozinha');
    estaNaCozinha = cozinha.some(i => i.pedido_id === pedidoId);
    console.log(`🍳 Pedido ainda está na cozinha? ${estaNaCozinha ? 'SIM (ERRO)' : 'NÃO (SUCESSO!)'}`);

    if (estaNaCozinha) {
      console.log('❌ FALHA: O pedido cancelado ainda aparece na cozinha!');
    } else {
      console.log('✨ SUCESSO: O pedido foi removido corretamente da cozinha.');
    }

  } catch (e) {
    console.error('❌ Erro durante o teste:', e.message);
  }
}

setTimeout(test, 2000); // Espera o servidor subir
