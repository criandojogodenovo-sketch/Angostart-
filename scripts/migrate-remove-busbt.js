/**
 * AngoStart — Migração: remoção do Busbt + sistema de Publicações (feed social).
 *
 * PARTE 1 — Remoção do Busbt (publicidade em vídeo):
 *   DROP TABLE videos  — o sistema de vídeo/Mux foi totalmente removido
 *   do código (rotas, componentes, deps). A tabela deixa de ter leitores.
 *
 * PARTE 2 — Feed social de Publicações:
 *
 *   posts          — publicações dos vendedores (título + conteúdo +
 *                    imagem opcional). contact_code guarda o código do
 *                    vendedor no momento da publicação (cópia
 *                    informativa; a fonte de verdade é users.contact_code).
 *
 *   post_likes     — «gostar» por utilizador (UNIQUE(post_id,user_id),
 *                    toggle no cliente/API).
 *
 *   post_comments  — comentários em publicações.
 *
 *   users.contact_code — código único de contacto do vendedor
 *                    (CONTATO-XXXXXX): quem o recebe abre /contato/CODIGO
 *                    e chega ao perfil público. Gerado on-demand pela API.
 *
 * Idempotente: IF NOT EXISTS / IF EXISTS — pode correr 2× sem efeito.
 * Uso: node scripts/migrate-remove-busbt.js  (lê DATABASE_URL do .env/env)
 */
const { neon } = require('@neondatabase/serverless');

// Carrega .env simples (sem dependência externa)
try {
  require('fs')
    .readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8')
    .split('\n')
    .forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      const key = m ? m[1] : null;
      if (key && !process.env[key]) {
        process.env[key] = m[2].replace(/^["']|["']$/g, '');
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
  console.log('— Remoção do Busbt + Publicações (feed social) —');

  /* ══ PARTE 1: remover o sistema de vídeos (Busbt) ══ */

  const before = await sql`
    SELECT COUNT(*)::int AS total FROM videos
  `.catch(() => [{ total: 0 }]);

  await sql`
    DROP TABLE IF EXISTS videos CASCADE
  `;
  console.log(
    `✅ Tabela videos removida (${before[0]?.total ?? 0} linhas — sistema Busbt/Mux já fora do código).`
  );

  /* ══ PARTE 2: feed social de publicações ══ */

  /* 1. Publicações. */
  await sql`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      image_url TEXT,
      contact_code TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_posts_created_at
      ON posts (created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_posts_user_id
      ON posts (user_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_posts_contact_code
      ON posts (contact_code)
  `;

  /* 2. Gostos (um por utilizador/post — toggle). */
  await sql`
    CREATE TABLE IF NOT EXISTS post_likes (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(post_id, user_id)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_post_likes_post_id
      ON post_likes (post_id)
  `;

  /* 3. Comentários. */
  await sql`
    CREATE TABLE IF NOT EXISTS post_comments (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_post_comments_post_id
      ON post_comments (post_id, created_at ASC)
  `;

  /* 4. Código de contacto único por vendedor (users). */
  await sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_code TEXT
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_contact_code
      ON users (contact_code)
  `;

  /* Confirmação */
  const tables = await sql`
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('posts', 'post_likes', 'post_comments', 'videos')
     ORDER BY table_name
  `;
  const col = await sql`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name = 'contact_code'
  `;
  console.log(
    '✅ Tabelas presentes:',
    tables.map((t) => t.table_name).join(', ') || '(nenhuma)'
  );
  console.log(
    '✅ users.contact_code:',
    col.length > 0 ? 'presente' : 'AUSENTE (verifica!)'
  );
}

main()
  .then(() => {
    console.log('✅ Migração «remove-busbt + publicações» concluída.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Falha na migração:', error.message || error);
    process.exit(1);
  });
