import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser, isSellerRole } from '@/lib/auth';
import { getOrCreateStoreForUser } from '@/lib/stores';
import { clientKey, rateLimit, sanitizeMultiline, sanitizeText, isSafeHttpUrl } from '@/lib/security';
import { isInternalMediaUrl } from '@/lib/payments-manual';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stores — lista pública de lojas virtuais (Fase 9).
 * ?minha=1 → devolve a loja do vendedor autenticado (cria se não existir).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const minha = searchParams.get('minha') === '1';

  if (minha) {
    const user = await getAuthUser(request);
    if (!user || !isSellerRole(user.role)) {
      return NextResponse.json(
        { error: 'Apenas vendedores têm loja virtual.' },
        { status: 401 }
      );
    }
    try {
      const store = await getOrCreateStoreForUser(user.id, user.name);
      return NextResponse.json({ store });
    } catch (error) {
      console.error('[API /api/stores] Erro (minha=1):', error);
      return NextResponse.json({ error: 'Não foi possível carregar a tua loja.' }, { status: 503 });
    }
  }

  if (!rateLimit(clientKey(request, 'stores-get'), 60, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos.' }, { status: 429 });
  }

  try {
    const rows = (await sql`
      SELECT s.id, s.owner_id, s.name, s.slug, s.description, s.logo_url, s.banner_url, s.created_at,
             u.name AS owner_name, u.is_verified_bi::boolean AS verified, u.role AS owner_role,
             (SELECT COUNT(*)::int FROM products p WHERE p.user_id = s.owner_id) AS product_count,
             (SELECT COUNT(*)::int FROM store_followers f WHERE f.store_id = s.id) AS follower_count
      FROM stores s
      JOIN users u ON u.id = s.owner_id
      WHERE u.blocked = FALSE
      ORDER BY product_count DESC, s.created_at DESC
      LIMIT 100
    `) as unknown as {
      id: number;
      owner_id: number;
      name: string;
      slug: string;
      description: string | null;
      logo_url: string | null;
      banner_url: string | null;
      created_at: string;
      owner_name: string;
      verified: boolean;
      owner_role: string;
      product_count: number;
      follower_count: number;
    }[];

    return NextResponse.json({ stores: rows });
  } catch (error) {
    console.error('[API /api/stores] Erro no GET:', error);
    return NextResponse.json({ stores: [] });
  }
}

/**
 * PATCH /api/stores — o vendedor edita a própria loja (Fase 9).
 * Corpo: { name?, description?, logo_url?, banner_url? }
 * Logo/banner são URLs devolvidos por /api/upload/image (Vercel Blob).
 */
export async function PATCH(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || !isSellerRole(user.role)) {
    return NextResponse.json(
      { error: 'Apenas vendedores podem editar a loja.' },
      { status: 401 }
    );
  }

  if (!rateLimit(clientKey(request, 'stores-patch'), 20, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos. Aguarda um momento.' }, { status: 429 });
  }

  let body: {
    name?: unknown;
    description?: unknown;
    logo_url?: unknown;
    banner_url?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const name = sanitizeText(body.name, 80);
  if (name && name.length < 3) {
    return NextResponse.json(
      { error: 'O nome da loja deve ter pelo menos 3 letras.' },
      { status: 400 }
    );
  }

  const description = sanitizeMultiline(body.description, 500) || null;

  const media = (value: unknown): string | null | undefined => {
    if (value === undefined) return undefined;
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return null;
    if (!isInternalMediaUrl(raw)) return undefined; // URL inválido/externo → rejeita
    return raw;
  };

  const logoUrl = media(body.logo_url);
  const bannerUrl = media(body.banner_url);
  if (logoUrl === undefined || bannerUrl === undefined) {
    return NextResponse.json(
      { error: 'As imagens devem ser enviadas pelo upload da AngoStart (usa o botão de upload).' },
      { status: 400 }
    );
  }

  try {
    const store = await getOrCreateStoreForUser(user.id, user.name);

    const updated = (await sql`
      UPDATE stores
      SET name = COALESCE(${name || null}, name),
          description = COALESCE(${description}, description),
          logo_url = COALESCE(${logoUrl}, logo_url),
          banner_url = COALESCE(${bannerUrl}, banner_url),
          updated_at = NOW()
      WHERE id = ${store.id}
      RETURNING id, owner_id, name, slug, description, logo_url, banner_url, created_at
    `) as unknown as {
      id: number;
      owner_id: number;
      name: string;
      slug: string;
      description: string | null;
      logo_url: string | null;
      banner_url: string | null;
      created_at: string;
    }[];

    return NextResponse.json({ ok: true, store: updated[0] });
  } catch (error) {
    console.error('[API /api/stores] Erro no PATCH:', error);
    return NextResponse.json({ error: 'Não foi possível guardar a loja agora.' }, { status: 503 });
  }
}
