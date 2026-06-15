const axios = require('axios');

const BASE_URL = 'http://localhost:3001/api';

async function runMasterRobot() {
    console.log('🌟 INICIANDO ROBÔ MESTRE DE VALIDAÇÃO TOTAL (PRODUÇÃO 2026) 🌟\n');
    let errors = 0;

    try {
        // 1. Limpeza de Segurança
        console.log('🧹 1. Limpando ambiente...');
        const initRes = await axios.get(`${BASE_URL}/pedidos`);
        for (const p of initRes.data) {
            await axios.delete(`${BASE_URL}/pedidos/${p.id}`);
        }
        console.log('✅ Ambiente limpo.\n');

        // 2. Teste de Sincronização de Caixa
        console.log('💰 2. Validando Status de Caixa...');
        const caixaStatus = await axios.get(`${BASE_URL}/caixa/status`);
        if (caixaStatus.data) {
            await axios.post(`${BASE_URL}/caixa/fechar`, { id: caixaStatus.data.id, valor_final: 0 });
        }
        
        try {
            await axios.post(`${BASE_URL}/pedidos`, { mesa_id: 1, itens: [{ menu_id: 1, preco: 10, quantidade: 1 }] });
            console.error('❌ ERRO: Sistema permitiu pedido com caixa FECHADO!');
            errors++;
        } catch (e) {
            console.log('✅ SUCESSO: Bloqueio de caixa fechado operacional.');
        }

        await axios.post(`${BASE_URL}/caixa/abrir`, { valor_inicial: 100 });
        console.log('✅ SUCESSO: Caixa aberto com sucesso.\n');

        // 3. Teste da Nova Funcionalidade de Promoção (Preço Original)
        console.log('🏷️ 3. Validando Novo Sistema de Preços (Promoção)...');
        // Cria item de teste
        const testItem = {
            nome: 'PROMO BOT TEST',
            categoria: 'TESTE',
            preco: 15.50,
            preco_original: 25.00,
            em_promocao: true,
            estoque: 10
        };
        const resMenu = await axios.post(`${BASE_URL}/menu`, testItem);
        
        // Verifica se salvou corretamente
        const menu = await axios.get(`${BASE_URL}/menu?admin=true`);
        const savedItem = menu.data.find(i => i.nome === 'PROMO BOT TEST');
        
        if (savedItem && savedItem.preco_original === 25.00 && savedItem.preco === 15.50) {
            console.log('✅ SUCESSO: Preço original salvo e recuperado corretamente.');
        } else {
            console.error('❌ ERRO: Falha ao persistir preco_original no banco de dados!');
            errors++;
        }
        console.log('');

        // 4. Teste de Fluxo End-to-End
        console.log('🚀 4. Testando Fluxo Completo de Pedido...');
        const pedido = await axios.post(`${BASE_URL}/pedidos`, {
            mesa_id: 2,
            garcom_id: 'master_bot',
            itens: [{ menu_id: savedItem.id, preco: savedItem.preco, quantidade: 2 }]
        });
        const pId = pedido.data.id;
        console.log(`   - Pedido #${pId} criado na Mesa 2.`);

        // Cozinha -> Pronto
        await axios.put(`${BASE_URL}/pedidos/${pId}/cozinha-pronto`);
        // Garçom -> Entregue
        await axios.put(`${BASE_URL}/pedidos/${pId}/marcar-entregue`, { apenasProntos: true });
        // Pagamento
        await axios.put(`${BASE_URL}/pedidos/${pId}/status`, { status: 'entregue' });
        
        const mesaFinal = (await axios.get(`${BASE_URL}/mesas`)).data.find(m => m.id === 2);
        if (mesaFinal.status === 'livre') {
            console.log('✅ SUCESSO: Fluxo completo concluído e mesa liberada.');
        } else {
            console.error('❌ ERRO: Mesa não foi liberada após ciclo completo!');
            errors++;
        }
        console.log('');

        // 5. Teste de Estresse e Concorrência
        console.log('🔥 5. Testando Concorrência (Múltiplas mesas simultâneas)...');
        const promessas = [3, 4, 5].map(id => {
            return axios.post(`${BASE_URL}/pedidos`, {
                mesa_id: id,
                itens: [{ menu_id: savedItem.id, preco: 15.5, quantidade: 1 }]
            });
        });
        await Promise.all(promessas);
        console.log('✅ SUCESSO: 3 pedidos criados simultaneamente sem conflitos.');

        // Limpeza do item de teste
        await axios.delete(`${BASE_URL}/menu/${savedItem.id}`);

        // 6. Verificação de Integridade das Interfaces
        console.log('\n🌐 6. Verificando Saúde das Interfaces...');
        const rotas = ['/garcom', '/admin', '/cozinha', '/cardapio'];
        for (const r of rotas) {
            try {
                await axios.get(`http://localhost:3001${r}`);
                console.log(`   - Interface ${r}: OK`);
            } catch (e) {
                console.error(`   - Interface ${r}: ERRO!`);
                errors++;
            }
        }

        console.log('\n' + '='.repeat(40));
        if (errors === 0) {
            console.log('🏆 VEREDITO: SISTEMA 100% PRONTO PARA PRODUÇÃO!');
            console.log('Tudo validado: Caixa, Promoções, Fluxo, Concorrência e UI.');
        } else {
            console.log(`🚨 VEREDITO: SISTEMA COM ${errors} FALHAS CRÍTICAS.`);
        }
        console.log('='.repeat(40) + '\n');

    } catch (err) {
        console.error('\n💥 ERRO CATASTRÓFICO NO ROBÔ:', err.message);
        if (err.response) console.error('Dados:', err.response.data);
    } finally {
        process.exit(errors === 0 ? 0 : 1);
    }
}

runMasterRobot();
