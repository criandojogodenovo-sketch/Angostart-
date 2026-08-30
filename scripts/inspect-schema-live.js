/**
 * AngoStart — Dump do schema atual do Neon (information_schema).
 * Uso: DATABASE_URL=postgres://... node scripts/inspect-schema-live.js
 */
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('postgres')) {
  console.error('❌ DATABASE_URL não definida ou inválida.');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

(async () => {
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name`;
  console.log('=== TABELAS ===');
  console.log(tables.map((t) => t.table_name).join(', '));

  for (const t of tables) {
    const cols = await sql`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${t.table_name}
      ORDER BY ordinal_position`;
    console.log(`\n=== ${t.table_name} ===`);
    for (const c of cols) {
      console.log(`  ${c.column_name} | ${c.data_type} | ${c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'} | ${c.column_default ?? ''}`);
    }
  }
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
