// Teste do driver serverless da Neon (funciona sobre HTTPS:443)
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

(async () => {
  try {
    const rows = await sql`SELECT NOW() as now, version() as version`;
    console.log('✅ NEON SERVERLESS DRIVER OK (HTTPS:443)');
    console.log('   Hora do servidor:', rows[0].now);
    console.log('   Versão:', rows[0].version.split(',')[0]);
  } catch (err) {
    console.error('❌ ERRO:', err.message);
    process.exit(1);
  }
})();
