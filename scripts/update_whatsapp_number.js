const { Client } = require('pg');
const Database = require('better-sqlite3');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

async function updateConfig() {
    const isPostgres = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);
    const novoNumero = '558293157048'; // Formato funcional (sem o 9 extra)

    if (isPostgres) {
        let connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
        const client = new Client({ 
            connectionString,
            ssl: { rejectUnauthorized: false }
        });
        await client.connect();
        await client.query("UPDATE sistema_config SET valor = $1 WHERE chave = 'whatsapp_notify_numbers'", [novoNumero]);
        await client.end();
    } else {
        const db = new Database(path.join(__dirname, 'garconnexpress.db'));
        db.prepare("UPDATE sistema_config SET valor = ? WHERE chave = 'whatsapp_notify_numbers'").run(novoNumero);
        db.close();
    }
    console.log(`✅ Configuração atualizada com SUCESSO para o número: ${novoNumero}`);
}

updateConfig().catch(console.error);
