// Teste rápido de conectividade ao Neon PostgreSQL
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    const res = await pool.query('SELECT NOW() as now, version() as version');
    console.log('✅ LIGAÇÃO AO NEON OK');
    console.log('   Hora do servidor:', res.rows[0].now);
    console.log('   Versão:', res.rows[0].version.split(',')[0]);
  } catch (err) {
    console.error('❌ ERRO NA LIGAÇÃO:', err.message);
    console.error('Código:', err.code, '| Erro completo:', JSON.stringify(err, Object.getOwnPropertyNames(err)).slice(0, 500));
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
