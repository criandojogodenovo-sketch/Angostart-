import 'server-only';
import { neon, NeonQueryFunction } from '@neondatabase/serverless';

/**
 * AngoStart — Ligação à base de dados Neon (PostgreSQL)
 *
 * ⚠️ SERVER-ONLY: `import 'server-only'` garante que este módulo (e o
 * DATABASE_URL que ele lê) nunca pode ser importado por um Client
 * Component — o build falha se isso acontecer.
 *
 * Usa o driver serverless oficial da Neon (@neondatabase/serverless),
 * que comunica por HTTPS:443 — ideal para ambientes serverless (Vercel,
 * Edge) e para redes que bloqueiam a porta 5432 do PostgreSQL.
 *
 * A connection string vem de DATABASE_URL (ficheiro .env.local em
 * desenvolvimento; variável de ambiente configurada na Vercel em produção).
 */

function createSqlConnection(): NeonQueryFunction<false, false> {
  // NEON_DATABASE_URL tem prioridade (permite override em sandboxes que
  // exportam DATABASE_URL com outro formato); na Vercel basta DATABASE_URL.
  const databaseUrl =
    (process.env.NEON_DATABASE_URL && process.env.NEON_DATABASE_URL.startsWith('postgres')
      ? process.env.NEON_DATABASE_URL
      : undefined) || process.env.DATABASE_URL;

  if (!databaseUrl || !databaseUrl.startsWith('postgres')) {
    throw new Error(
      'DATABASE_URL não está definida ou não é uma connection string PostgreSQL válida. ' +
        'Verifica o ficheiro .env.local (desenvolvimento) ou as Settings da Vercel (produção).'
    );
  }

  return neon(databaseUrl);
}

const globalForNeon = globalThis as unknown as {
  angostartSql: NeonQueryFunction<false, false> | undefined;
};

export const sql =
  globalForNeon.angostartSql ?? createSqlConnection();

if (process.env.NODE_ENV !== 'production') {
  globalForNeon.angostartSql = sql;
}

export default sql;
