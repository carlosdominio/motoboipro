const axios = require('axios');

async function debugKitchen() {
  try {
    const res = await axios.get('http://localhost:3001/api/pedidos/cozinha');
    console.log('--- ITENS NA COZINHA ---');
    console.log(JSON.stringify(res.data, null, 2));
    console.log('------------------------');
  } catch (e) {
    console.error(e.message);
  }
}

debugKitchen();