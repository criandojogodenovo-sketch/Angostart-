import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { clientKey, rateLimit, sanitizeText, sanitizeMultiline } from '@/lib/security';
import { pushNotification } from '@/lib/notifications';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Fase 16 — «Entrar em Contato» (fluxo Airbnb/Booking).
 *
 * GET  /api/contact-requests?recebidos=1  — pedidos recebidos (prestador)
 * GET  /api/contact-requests?enviados=1   — pedidos enviados (cliente)
 * POST /api/contact-requests              — cliente pede contacto ao prestador
 *        { provider_id, product_id?, message? }
 *
 * Ciclo: pendente → aceite (prestador) → cliente «Ir para Chat» cria a
 * conversa. O cliente pode descartar; o prestador pode recusar.
 *
 * 🔒 PRIVACIDADE: a mensagem passa pelo `detectContactSharing` — telefones,
 * emails e WhatsApp são bloqueados (toda a comunicação pelo chat interno).
 */

interface ContactRequestRow {
  id: number;
  client_id: number;
  provider_id: number;
  product_id: number | null;
  message: string | null;
  status: 'pendente' | 'aceite' | 'recusada' | 'cancelada';
  conversation_id: number | null;
  created_at: string;
  answered_at: string | null;
  client_name: string | null;
  provider_name: string | null;
  product_name: string | null;
  client_username: string | null;
  provider_username: string | null;
}

/* ──────────────────────────── GET — listar ──────────────────────────── */

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão inválida. Entra novamente.' }, { status: 401 });
  }
  if (!rateLimit(clientKey(request, `contact-get:${user.id}`), 60, 60_000)) {
    return NextResponse.json({ error: 'Aguarda um momento.' }, { status: 429 });
  }

  const recebidos = new URL(request.url).searchParams.get('recebidos') === '1';

  try {
    const items = recebidos
      ? ((await sql`
          SELECT c.*,
                 cu.name AS client_name, pu.name AS provider_name,
                 cu.username AS client_username, pu.username AS provider_username,
                 pr.name AS product_name
          FROM contact_requests c
          JOIN users cu ON cu.id = c.client_id
          JOIN users pu ON pu.id = c.provider_id
          LEFT JOIN products pr ON pr.id = c.product_id
          WHERE c.provider_id = ${user.id}
          ORDER BY c.created_at DESC
          LIMIT 50
        `) as unknown as ContactRequestRow[])
      : ((await sql`
          SELECT c.*,
                 cu.name AS client_name, pu.name AS provider_name,
                 cu.username AS client_username, pu.username AS provider_username,
                 pr.name AS product_name
          FROM contact_requests c
          JOIN users cu ON cu.id = c.client_id
          JOIN users pu ON pu.id = c.provider_id
          LEFT JOIN products pr ON pr.id = c.product_id
          WHERE c.client_id = ${user.id}
          ORDER BY c.created_at DESC
          LIMIT 50
        `) as unknown as ContactRequestRow[]);

    return NextResponse.json({ items }, { status: 200 });
  } catch (error) {
    console.error('[API contact-requests GET] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível carregar os contactos.' }, { status: 503 });
  }
}

/* ──────────────────────────── POST — criar ──────────────────────────── */

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Entra na tua conta para entrar em contato.' },
      { status: 401 }
    );
  }
  if (!rateLimit(clientKey(request, `contact-post:${user.id}`), 6, 10 * 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados pedidos de contacto seguidos. Aguarda alguns minutos.' },
      { status: 429 }
    );
  }

  let body: { provider_id?: unknown; product_id?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const providerId = Number(body.provider_id);
  if (!Number.isInteger(providerId) || providerId <= 0) {
    return NextResponse.json({ error: 'Prestador inválido.' }, { status: 400 });
  }
  if (providerId === user.id) {
    return NextResponse.json(
      { error: 'Não podes entrar em contato contigo próprio.' },
      { status: 400 }
    );
  }

  const productId =
    body.product_id !== undefined && body.product_id !== null && body.product_id !== ''
      ? Number(body.product_id)
      : null;
  if (productId !== null && (!Number.isInteger(productId) || productId <= 0)) {
    return NextResponse.json({ error: 'Produto inválido.' }, { status: 400 });
  }

  const message = sanitizeMultiline(body.message ?? '', 500) || null;
  if (message) {
    const { detectContactSharing } = await import('@/lib/antifraud');
    const violations = detectContactSharing(message);
    if (violations.length > 0) {
      return NextResponse.json(
        {
          error:
            'Por privacidade, não envies telefones, emails ou WhatsApp na mensagem — combinam pelo chat da AngoStart.',
          blocked: 'contact_sharing',
        },
        { status: 400 }
      );
    }
  }

  try {
    // O prestador existe e está ativo?
    const providers = (await sql`
      SELECT id, name FROM users
      WHERE id = ${providerId} AND blocked = FALSE
        AND role IN ('criador', 'prestador_domicilio', 'prestador_remoto')
      LIMIT 1
    `) as unknown as { id: number; name: string }[];
    if (providers.length === 0) {
      return NextResponse.json({ error: 'Prestador não encontrado.' }, { status: 404 });
    }

    // Já existe um pedido pendente para o mesmo prestador?
    const pendentes = (await sql`
      SELECT id FROM contact_requests
      WHERE client_id = ${user.id} AND provider_id = ${providerId} AND status = 'pendente'
      LIMIT 1
    `) as unknown as { id: number }[];
    if (pendentes.length > 0) {
      return NextResponse.json(
        { error: 'Já tens um pedido de contato pendente com este prestador.' },
        { status: 409 }
      );
    }

    const rows = (await sql`
      INSERT INTO contact_requests (client_id, provider_id, product_id, message)
      VALUES (${user.id}, ${providerId}, ${productId}, ${message})
      RETURNING id
    `) as unknown as { id: number }[];

    // Notifica o prestador (sino + web push — melhor-esforço)
    await pushNotification(
      providerId,
      'Novo pedido de contacto 💬',
      `${user.name} quer falar contigo${message ? `: «${message.slice(0, 80)}»` : '.'} Aceita ou recusa na aba Contactos.`,
      '/pedidos?tab=contactos'
    );

    return NextResponse.json({ ok: true, id: rows[0].id }, { status: 201 });
  } catch (error) {
    console.error('[API contact-requests POST] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível enviar o pedido de contato agora. Tenta novamente.' },
      { status: 503 }
    );
  }
}
