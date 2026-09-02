/**
 * AngoStart — Migração: Fase 20 — Aba Busbt (publicidade em vídeo, Mux).
 *
 * Cria a tabela `videos` que guarda o estado de cada vídeo de publicidade:
 *   uploading → processing → ready | errored
 *
 * Referências ao Mux:
 *   - mux_upload_id  : ID do Direct Upload (POST /api/upload/video)
 *   - mux_asset_id   : ID do Asset criado pelo Mux quando o PUT termina
 *   - playback_id    : ID de playback (o webhook video.asset.ready entrega-o)
 *
 * Idempotente: IF NOT EXISTS — pode correr 2× sem efeito.
 * Uso: node scripts/migrate-fase20-busbt.js  (lê DATABASE_URL do .env/local env)
 */
const { neon } = require('@neondatabase/serverless');

// Carrega .env simples (sem dependência externa)
try {
  require('fs')
    .readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8')
    .split('\n')
    .forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    });
} catch {
  /* .env opcional */
}

const databaseUrl =
  process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl || !databaseUrl.startsWith('postgres')) {
  console.error(
    '❌ Define DATABASE_URL (postgresql://…) antes de correr esta migração.'
  );
  process.exit(1);
}

const sql = neon(databaseUrl);

async function main() {
  console.log('— Fase 20: tabela videos (Busbt / Mux) —');

  await sql`
    CREATE TABLE IF NOT EXISTS videos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'uploading',
      mux_upload_id TEXT,
      mux_asset_id TEXT,
      playback_id TEXT,
      duration_seconds NUMERIC(10, 2),
      max_stored_resolution TEXT,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  console.log('  ✓ tabela videos garantida (IF NOT EXISTS)');

  await sql`
    CREATE INDEX IF NOT EXISTS idx_videos_user_id ON videos (user_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_videos_status ON videos (status)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos (created_at DESC)
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_mux_asset_id
    ON videos (mux_asset_id) WHERE mux_asset_id IS NOT NULL
  `;
  console.log('  ✓ índices garantidos (user_id, status, created_at, mux_asset_id)');

  /* Expira uploads abandonados: linhas em 'uploading' com mais de 24h
     passam a 'errored' — assim a grelha do utilizador não acumula
     estados pendentes de uploads que nunca terminaram. Idempotente. */
  const expired = await sql`
    UPDATE videos
    SET status = 'errored',
        error_message = 'Upload expirado (não concluído em 24h).',
        updated_at = now()
    WHERE status = 'uploading'
      AND created_at < now() - INTERVAL '24 hours'
    RETURNING id
  `;
  console.log(`  ✓ uploads expirados marcados: ${expired.length}`);

  console.log('✅ Migração Fase 20 concluída.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Erro na migração:', error);
    process.exit(1);
  });
