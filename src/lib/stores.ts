import 'server-only';
import { sql } from '@/lib/db';

/**
 * AngoStart — Lojas virtuais (Fase 9) — server-side.
 *
 * Cada vendedor/prestador tem automaticamente uma loja (criada no registo
 * ou por backfill). A loja agrupa os produtos do vendedor em /loja/[slug],
 * com logo/banner editáveis no painel e seguidores notificados de novidades.
 */

export interface StoreRow {
  id: number;
  owner_id: number;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  banner_url: string | null;
  created_at: string;
}

/** Slug URL-safe a partir do nome (minúsculas, sem acentos, hífens). */
export function slugifyName(name: string): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Gera um slug único a partir do nome (verifica colisões na BD). */
export async function generateUniqueStoreSlug(name: string): Promise<string> {
  const base = slugifyName(name) || 'loja';
  let slug = base;
  for (let i = 2; i <= 60; i += 1) {
    const taken = (await sql`
      SELECT 1 FROM stores WHERE slug = ${slug} LIMIT 1
    `) as unknown as { 1: number }[];
    if (taken.length === 0) return slug;
    slug = `${base}-${i}`;
  }
  // Improvável — fallback com sufixo aleatório
  return `${base}-${Date.now().toString(36)}`;
}

/** Cria (ou devolve) a loja do vendedor. Idempotente. */
export async function getOrCreateStoreForUser(
  ownerId: number,
  ownerName: string
): Promise<StoreRow> {
  const existing = (await sql`
    SELECT id, owner_id, name, slug, description, logo_url, banner_url, created_at
    FROM stores WHERE owner_id = ${ownerId} LIMIT 1
  `) as unknown as StoreRow[];
  if (existing[0]) return existing[0];

  const slug = await generateUniqueStoreSlug(ownerName);
  const inserted = (await sql`
    INSERT INTO stores (owner_id, name, slug)
    VALUES (${ownerId}, ${ownerName}, ${slug})
    ON CONFLICT (owner_id) DO NOTHING
    RETURNING id, owner_id, name, slug, description, logo_url, banner_url, created_at
  `) as unknown as StoreRow[];
  if (inserted[0]) return inserted[0];

  const race = (await sql`
    SELECT id, owner_id, name, slug, description, logo_url, banner_url, created_at
    FROM stores WHERE owner_id = ${ownerId} LIMIT 1
  `) as unknown as StoreRow[];
  if (!race[0]) throw new Error('Não foi possível criar a loja.');
  return race[0];
}

/** Loja pública por slug (com dados do proprietário + selo de verificação). */
export async function getStoreBySlug(
  slug: string
): Promise<(StoreRow & { owner_name: string; owner_username: string | null; verified: boolean; owner_role: string }) | null> {
  const rows = (await sql`
    SELECT s.id, s.owner_id, s.name, s.slug, s.description, s.logo_url, s.banner_url, s.created_at,
           u.name AS owner_name, u.username AS owner_username,
           u.is_verified_bi::boolean AS verified, u.role AS owner_role
    FROM stores s
    JOIN users u ON u.id = s.owner_id
    WHERE s.slug = ${slug} AND u.blocked = FALSE
    LIMIT 1
  `) as unknown as (StoreRow & { owner_name: string; owner_username: string | null; verified: boolean; owner_role: string })[];
  return rows[0] ?? null;
}

/** Produtos publicados da loja (catálogo público). */
export async function listStoreProducts(storeOwnerId: number) {
  return (await sql`
    SELECT p.id, p.name, p.description, p.price_kz, p.type, p.image_url, p.rating::float8,
           (COALESCE(p.stock, -1) <> 0)::boolean AS available, p.created_at
    FROM products p
    WHERE p.user_id = ${storeOwnerId}
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT 100
  `) as unknown as {
    id: number;
    name: string;
    description: string;
    price_kz: number;
    type: string;
    image_url: string | null;
    rating: number;
    available: boolean;
    created_at: string;
  }[];
}

/** Contagem de seguidores da loja. */
export async function countStoreFollowers(storeId: number): Promise<number> {
  const rows = (await sql`
    SELECT COUNT(*)::int AS n FROM store_followers WHERE store_id = ${storeId}
  `) as unknown as { n: number }[];
  return rows[0]?.n ?? 0;
}

/** Segue/deixa de seguir (toggle). Devolve true se agora segue. */
export async function toggleStoreFollow(
  storeId: number,
  userId: number
): Promise<boolean> {
  const existing = (await sql`
    SELECT 1 FROM store_followers WHERE store_id = ${storeId} AND user_id = ${userId} LIMIT 1
  `) as unknown as { 1: number }[];
  if (existing[0]) {
    await sql`
      DELETE FROM store_followers WHERE store_id = ${storeId} AND user_id = ${userId}
    `;
    return false;
  }
  await sql`
    INSERT INTO store_followers (store_id, user_id)
    VALUES (${storeId}, ${userId})
    ON CONFLICT (store_id, user_id) DO NOTHING
  `;
  return true;
}

/** O utilizador segue a loja? */
export async function isFollowingStore(
  storeId: number,
  userId: number
): Promise<boolean> {
  const rows = (await sql`
    SELECT 1 FROM store_followers WHERE store_id = ${storeId} AND user_id = ${userId} LIMIT 1
  `) as unknown as { 1: number }[];
  return Boolean(rows[0]);
}

/** Notifica os seguidores da loja de um novo produto (Fase 9, "Seguir"). */
export async function notifyFollowersNewProduct(
  storeOwnerId: number,
  productName: string,
  productId: number
): Promise<void> {
  try {
    const store = (await sql`
      SELECT id, name FROM stores WHERE owner_id = ${storeOwnerId} LIMIT 1
    `) as unknown as { id: number; name: string }[];
    if (!store[0]) return;

    const followers = (await sql`
      SELECT user_id FROM store_followers WHERE store_id = ${store[0].id}
    `) as unknown as { user_id: number }[];

    for (const f of followers) {
      await sql`
        INSERT INTO notifications (user_id, title, body, link)
        VALUES (${f.user_id}, ${`Nova publicação em ${store[0].name}`}, ${productName}, ${`/produtos/${productId}`})
      `;
      try {
        const { pushNotification } = await import('@/lib/notifications');
        await pushNotification(
          f.user_id,
          `Novidade em ${store[0].name}`,
          `${productName} — vem ver!`,
          `/produtos/${productId}`
        );
      } catch {
        /* push é melhor-esforço */
      }
    }
  } catch (error) {
    console.error('[stores] Notificação a seguidores falhou (não crítico):', error);
  }
}
