import 'server-only';
import type { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser, type AuthUser } from '@/lib/auth';

/**
 * AngoStart — Camada de dados das Publicações (feed social).
 *
 * Substitui o antigo Busbt (vídeo/Mux — removido por completo).
 *
 * 📦 TABELAS (criadas por scripts/migrate-remove-busbt.js OU
 *    auto-criadas idempotentemente no 1.º acesso — ensurePublicacoesTables):
 *
 *   posts          — publicações dos vendedores (título+conteúdo+imagem).
 *   post_likes     — gostos (UNIQUE(post_id,user_id) → toggle).
 *   post_comments  — comentários.
 *   users.contact_code — código único de contacto (CONTATO-XXXXXX):
 *                    quem o recebe abre /contato/CODIGO e chega ao perfil.
 *
 * ⛑️ DEGRADAÇÃO GRACIOSA (padrão do projecto): se a BD estiver
 *    inacessível/sem tabelas, as queries devolvem listas vazias em vez
 *    de rebentar a página — o feed mostra o estado vazio.
 */

/* ─────────────────────────── Tipos ─────────────────────────── */

export interface PostAuthor {
  id: number;
  name: string;
  username: string | null;
  role: string;
  profile_image: string | null;
}

export interface FeedPost {
  id: number;
  title: string;
  content: string;
  image_url: string | null;
  contact_code: string | null;
  created_at: string;
  author: PostAuthor;
  likes: number;
  comments: number;
  liked_by_me: boolean;
  is_mine: boolean;
}

export interface PostCommentRow {
  id: number;
  content: string;
  created_at: string;
  user_id: number | null;
  user_name: string | null;
  user_username: string | null;
  user_image: string | null;
}

/* ────────────────── Auto-migração (idempotente) ────────────────── */

const globalForPosts = globalThis as unknown as {
  angostartPublicacoesEnsure?: Promise<boolean>;
};

/**
 * Cria as tabelas das publicações SE ainda não existirem (IF NOT EXISTS)
 * e remove a tabela `videos` do extinto Busbt (DROP IF EXISTS — nada no
 * código a lê desde a migração estratégica).
 *
 * Corre UMA vez por instância serverless (memoizada em globalThis);
 * em corrida entre instâncias, os erros de «já existe» são engolidos
 * (a segunda chamada vê as tabelas presentes e segue).
 */
export function ensurePublicacoesTables(): Promise<boolean> {
  globalForPosts.angostartPublicacoesEnsure ??= (async () => {
    try {
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
        CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts (user_id)
      `;
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
        CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON post_likes (post_id)
      `;
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
      await sql`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_code TEXT
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_contact_code
          ON users (contact_code)
      `;
      // Busbt extinto: a tabela de vídeos já não tem leitores no código.
      await sql`DROP TABLE IF EXISTS videos CASCADE`;
      return true;
    } catch (error) {
      console.error('[publicacoes-db] ensure falhou:', error);
      return false;
    }
  })();
  return globalForPosts.angostartPublicacoesEnsure;
}

/* ─────────────────── Código de contacto ─────────────────── */

/** Alfabeto sem caracteres ambíguos (sem O/0/I/1). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Valida o formato de um código personalizado pedido pelo vendedor. */
export function isValidContactCode(code: unknown): code is string {
  return typeof code === 'string' && /^CONTATO-[A-Z0-9]{4,12}$/.test(code);
}

function randomCode(): string {
  let suffix = '';
  const cryptoObj = globalThis.crypto;
  const bytes = new Uint8Array(6);
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 6; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < 6; i++) suffix += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `CONTATO-${suffix}`;
}

/**
 * Devolve o código de contacto do utilizador, criando um se ainda não
 * existir. Com `custom`, tenta atribuir um código escolhido pelo
 * vendedor (409 se já pertence a outro utilizador).
 */
export async function ensureContactCode(
  userId: number,
  custom?: string
): Promise<{ code: string; conflict: boolean }> {
  const current = (await sql`
    SELECT contact_code FROM users WHERE id = ${userId} LIMIT 1
  `) as unknown as { contact_code: string | null }[];
  const existing = current[0]?.contact_code ?? null;

  if (custom) {
    if (existing === custom) return { code: custom, conflict: false };
    const taken = (await sql`
      SELECT 1 FROM users WHERE contact_code = ${custom} AND id <> ${userId} LIMIT 1
    `) as unknown as unknown[];
    if (taken.length > 0) return { code: existing ?? randomCode(), conflict: true };
    await sql`
      UPDATE users SET contact_code = ${custom} WHERE id = ${userId}
    `;
    return { code: custom, conflict: false };
  }

  if (existing) return { code: existing, conflict: false };

  // Gera um único garantido (retry em colisão raríssima)
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = randomCode();
    const clash = (await sql`
      SELECT 1 FROM users WHERE contact_code = ${candidate} LIMIT 1
    `) as unknown as unknown[];
    if (clash.length === 0) {
      await sql`
        UPDATE users SET contact_code = ${candidate} WHERE id = ${userId}
      `;
      return { code: candidate, conflict: false };
    }
  }
  const fallback = `${randomCode()}-${userId}`;
  await sql`
    UPDATE users SET contact_code = ${fallback} WHERE id = ${userId}
  `;
  return { code: fallback, conflict: false };
}

/** Resolve um código de contacto → dados públicos do vendedor. */
export async function resolveContactCode(
  code: string
): Promise<PostAuthor | null> {
  const rows = (await sql`
    SELECT id, name, role, username, profile_image
      FROM users
     WHERE contact_code = ${code}
       AND role IN ('criador', 'prestador_domicilio', 'prestador_remoto')
       AND blocked = FALSE
     LIMIT 1
  `) as unknown as PostAuthor[];
  return rows[0] ?? null;
}

/* ─────────────────────────── Feed ─────────────────────────── */

const FEED_PAGE_SIZE = 30;

/**
 * Lista publicações (mais recentes primeiro) com autor, contadores e
 * flags do visitante (liked_by_me / is_mine). `viewerId=null` → público.
 */
export async function listPosts(
  viewerId: number | null,
  options: { onlyMine?: boolean } = {}
): Promise<FeedPost[]> {
  const ready = await ensurePublicacoesTables();
  if (!ready) return [];

  try {
    const viewer = viewerId ?? 0;
    const mine = options.onlyMine ?? false;
    const rows = (await sql`
      SELECT p.id, p.title, p.content, p.image_url, p.contact_code, p.created_at,
             u.id AS author_id, u.name AS author_name, u.username AS author_username,
             u.role AS author_role, u.profile_image AS author_image,
             (SELECT COUNT(*)::int FROM post_likes l WHERE l.post_id = p.id) AS likes,
             (SELECT COUNT(*)::int FROM post_comments c WHERE c.post_id = p.id) AS comments,
             EXISTS(
               SELECT 1 FROM post_likes l
                WHERE l.post_id = p.id AND l.user_id = ${viewer}
             ) AS liked_by_me
        FROM posts p
        JOIN users u ON u.id = p.user_id AND u.blocked = FALSE
       WHERE (${mine} = FALSE OR p.user_id = ${viewer})
       ORDER BY p.created_at DESC
       LIMIT ${FEED_PAGE_SIZE}
    `) as unknown as Record<string, unknown>[];

    return rows.map((r) => ({
      id: Number(r.id),
      title: String(r.title ?? ''),
      content: String(r.content ?? ''),
      image_url: (r.image_url as string | null) ?? null,
      contact_code: (r.contact_code as string | null) ?? null,
      created_at: new Date(String(r.created_at)).toISOString(),
      author: {
        id: Number(r.author_id),
        name: String(r.author_name ?? 'Vendedor'),
        username: (r.author_username as string | null) ?? null,
        role: String(r.author_role ?? 'criador'),
        profile_image: (r.author_image as string | null) ?? null,
      },
      likes: Number(r.likes ?? 0),
      comments: Number(r.comments ?? 0),
      liked_by_me: r.liked_by_me === true,
      is_mine: viewerId !== null && Number(r.author_id) === viewerId,
    }));
  } catch (error) {
    console.error('[publicacoes-db] listPosts falhou:', error);
    return [];
  }
}

/** Uma publicação pelo id (dono/admin) — null se não existir. */
export async function getPostById(id: number): Promise<{
  id: number;
  user_id: number;
  image_url: string | null;
} | null> {
  try {
    const rows = (await sql`
      SELECT id, user_id, image_url FROM posts WHERE id = ${id} LIMIT 1
    `) as unknown as { id: number; user_id: number; image_url: string | null }[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/** Apaga uma publicação (likes/comentários caem por CASCADE). */
export async function deletePost(id: number): Promise<void> {
  await sql`DELETE FROM posts WHERE id = ${id}`;
}

/* ───────────────────── Gostos (toggle) ───────────────────── */

export async function toggleLike(
  postId: number,
  userId: number
): Promise<{ liked: boolean; likes: number }> {
  await ensurePublicacoesTables();
  const existing = (await sql`
    SELECT 1 FROM post_likes WHERE post_id = ${postId} AND user_id = ${userId} LIMIT 1
  `) as unknown as unknown[];

  if (existing.length > 0) {
    await sql`
      DELETE FROM post_likes WHERE post_id = ${postId} AND user_id = ${userId}
    `;
  } else {
    await sql`
      INSERT INTO post_likes (post_id, user_id)
      VALUES (${postId}, ${userId})
      ON CONFLICT (post_id, user_id) DO NOTHING
    `;
    // Notifica o autor (fire-and-forget — nunca bloqueia o like)
    try {
      const { pushNotification } = await import('@/lib/notifications');
      const author = (await sql`
        SELECT user_id FROM posts WHERE id = ${postId} LIMIT 1
      `) as unknown as { user_id: number }[];
      if (author[0] && author[0].user_id !== userId) {
        await pushNotification(
          author[0].user_id,
          'Nova reação à tua publicação',
          'Alguém gostou da tua publicação no feed.',
          '/publicacoes'
        );
      }
    } catch {
      /* notificação é best-effort */
    }
  }

  const count = (await sql`
    SELECT COUNT(*)::int AS total FROM post_likes WHERE post_id = ${postId}
  `) as unknown as { total: number }[];
  return {
    liked: existing.length === 0,
    likes: Number(count[0]?.total ?? 0),
  };
}

/* ──────────────────────── Comentários ──────────────────────── */

export async function listComments(postId: number): Promise<PostCommentRow[]> {
  try {
    const rows = (await sql`
      SELECT c.id, c.content, c.created_at, c.user_id,
             u.name AS user_name, u.username AS user_username, u.profile_image AS user_image
        FROM post_comments c
        JOIN users u ON u.id = c.user_id AND u.blocked = FALSE
       WHERE c.post_id = ${postId}
       ORDER BY c.created_at ASC
       LIMIT 100
    `) as unknown as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r.id),
      content: String(r.content ?? ''),
      created_at: new Date(String(r.created_at)).toISOString(),
      user_id: r.user_id === null ? null : Number(r.user_id),
      user_name: (r.user_name as string | null) ?? null,
      user_username: (r.user_username as string | null) ?? null,
      user_image: (r.user_image as string | null) ?? null,
    }));
  } catch (error) {
    console.error('[publicacoes-db] listComments falhou:', error);
    return [];
  }
}

export async function addComment(
  postId: number,
  userId: number,
  content: string
): Promise<PostCommentRow> {
  const inserted = (await sql`
    INSERT INTO post_comments (post_id, user_id, content)
    VALUES (${postId}, ${userId}, ${content})
    RETURNING id, content, created_at, user_id
  `) as unknown as Record<string, unknown>[];
  const row = inserted[0];

  // Notifica o autor (fire-and-forget)
  try {
    const { pushNotification } = await import('@/lib/notifications');
    const author = (await sql`
      SELECT user_id FROM posts WHERE id = ${postId} LIMIT 1
    `) as unknown as { user_id: number }[];
    if (author[0] && author[0].user_id !== userId) {
      await pushNotification(
        author[0].user_id,
        'Novo comentário na tua publicação',
        'Alguém comentou a tua publicação no feed.',
        '/publicacoes'
      );
    }
  } catch {
    /* best-effort */
  }

  const me = (await sql`
    SELECT name, username, profile_image FROM users WHERE id = ${userId} LIMIT 1
  `) as unknown as { name: string; username: string; profile_image: string | null }[];

  return {
    id: Number(row.id),
    content: String(row.content),
    created_at: new Date(String(row.created_at)).toISOString(),
    user_id: userId,
    user_name: me[0]?.name ?? null,
    user_username: me[0]?.username ?? null,
    user_image: me[0]?.profile_image ?? null,
  };
}

/** Utilizador autenticado opcional (Bearer se presente) — para o feed público. */
export async function optionalAuthUser(
  request: NextRequest
): Promise<AuthUser | null> {
  try {
    return await getAuthUser(request);
  } catch {
    return null;
  }
}
