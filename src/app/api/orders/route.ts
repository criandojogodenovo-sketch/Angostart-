import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import {
  sanitizeText,
  sanitizeMultiline,
  isSafeHttpUrl,
  clientKey,
  rateLimit,
  requireAnyAdmin,
} from '@/lib/security';
import {
  parseAndValidateProof,
  buildKwikReference,
} from '@/lib/kwik';
import {
  payWithWallet,
  ensureWallet,
  creditSellersOnPaid,
  payAffiliateCommission,
  InsufficientFundsError,
} from '@/lib/wallet';
import { sendOrderNotifications } from '@/lib/email';

export const dynamic = 'force-dynamic';

interface CartInput {
  id: number;
  quantity: number;
}

interface OrderItemPayload {
  id?: unknown;
  quantity?: unknown;
}

interface OrderPayload {
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  items?: OrderItemPayload[];
  delivery_type?: string;
  notes?: string;
  comprovativo_url?: string;
  /** Método de pagamento: 'kwik', 'whatsapp' ou 'carteira' (saldo). */
  payment_method?: unknown;
  /** Comprovativo KWiK como data URL (data:<mime>;base64,<dados>). */
  payment_proof?: unknown;
  payment_proof_name?: unknown;
  /** Código de afiliado indicado no checkout (ex.: AFG-3K9PQX). */
  affiliate_code?: unknown;
  /** Localização do cliente (serviços ao domicílio — opcional, validada). */
  latitude?: unknown;
  longitude?: unknown;
}

interface DbProduct {
  id: number;
  name: string;
  price_kz: number;
  user_id: number | null;
  seller_email: string | null;
}

/**
 * POST /api/orders — Regista uma encomenda no Neon.
 *
 * 🔒 SEGURANÇA:
 * - Preços e nomes dos produtos são RECALCULADOS na base de dados — o
 *   cliente não pode forjar preços no corpo do pedido (anti-manipulação).
 * - Cada item fica associado ao vendedor (seller_id) para o dashboard de
 *   vendas e as notificações.
 * - Textos são sanitizados (anti-XSS armazenado) e o URL do comprovativo
 *   é validado (só http/https).
 * - Comprovativo KWiK (upload) validado: MIME whitelist, 2 MB máx.,
 *   magic bytes e nome sanitizado (ver lib/kwik.ts).
 * - Notificações por email (Resend): cliente + vendedores.
 */
export async function POST(request: NextRequest) {
  const authUser = await getAuthUser(request);
  const userId = authUser?.id ?? null;

  // 10 encomendas / minuto por IP — trava spam e floods
  if (!rateLimit(clientKey(request, 'orders-post'), 10, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados pedidos. Aguarda um minuto.' },
      { status: 429 }
    );
  }

  let body: OrderPayload;

  try {
    body = (await request.json()) as OrderPayload;
  } catch {
    return NextResponse.json(
      { error: 'Corpo do pedido inválido (JSON esperado).' },
      { status: 400 }
    );
  }

  const customerName = sanitizeText(body.customer_name, 80);
  const customerPhone = sanitizeText(body.customer_phone, 20);
  const customerEmail = body.customer_email?.trim().toLowerCase() || null;
  const deliveryType = sanitizeText(body.delivery_type, 30) || 'entrega';
  const notes = sanitizeMultiline(body.notes, 300) || null;
  const comprovativoUrl =
    body.comprovativo_url?.trim() && isSafeHttpUrl(body.comprovativo_url.trim())
      ? body.comprovativo_url.trim()
      : null;

  /* ── KWiK / carteira: método de pagamento + comprovativo (opcional) ── */
  const rawMethod = body.payment_method === 'whatsapp' ? 'whatsapp' : body.payment_method === 'carteira' ? 'carteira' : 'kwik';
  const paymentMethod = rawMethod;

  // Pagamento com a carteira exige sessão autenticada — saldo é pessoal.
  if (paymentMethod === 'carteira' && !authUser) {
    return NextResponse.json(
      { error: 'Entra na tua conta para pagar com o saldo da carteira.' },
      { status: 401 }
    );
  }

  /* ── Código de afiliado (opcional) ── */
  const affiliateCode =
    typeof body.affiliate_code === 'string'
      ? body.affiliate_code.trim().toUpperCase().slice(0, 20)
      : null;
  if (affiliateCode && !/^[A-Z0-9-]{4,20}$/.test(affiliateCode)) {
    return NextResponse.json(
      { error: 'Código de afiliado inválido — usa o formato AFG-XXXXXX.' },
      { status: 400 }
    );
  }

  /* ── Localização do cliente (Fase 5 — serviços ao domicílio, opcional) ── */
  const ANGOLA_LAT = [-18.5, -4.5] as const;
  const ANGOLA_LNG = [11.0, 25.0] as const;
  const parseCoord = (value: unknown, range: readonly [number, number]): number | null => {
    const num = Number(value);
    if (!Number.isFinite(num) || num < range[0] || num > range[1]) return null;
    return Math.round(num * 1e6) / 1e6;
  };
  const clientLat = parseCoord(body.latitude, ANGOLA_LAT);
  const clientLng = parseCoord(body.longitude, ANGOLA_LNG);

  const proof = body.payment_proof
    ? parseAndValidateProof({
        dataUrl: body.payment_proof,
        fileName: body.payment_proof_name,
      })
    : null;

  if (body.payment_proof && !proof) {
    return NextResponse.json(
      {
        error:
          'Comprovativo inválido — usa uma foto (JPG, PNG ou WebP) ou PDF até 2 MB.',
      },
      { status: 400 }
    );
  }

  if (body.comprovativo_url?.trim() && !comprovativoUrl) {
    return NextResponse.json(
      { error: 'O link do comprovativo deve começar por https://.' },
      { status: 400 }
    );
  }
  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    return NextResponse.json(
      { error: 'Email inválido — verifica o endereço escrito.' },
      { status: 400 }
    );
  }
  if (customerName.length < 3) {
    return NextResponse.json(
      { error: 'Indica o teu nome completo (mínimo 3 letras).' },
      { status: 400 }
    );
  }
  if (customerPhone.replace(/\D/g, '').length < 9) {
    return NextResponse.json(
      { error: 'Indica um número de telefone válido (mínimo 9 dígitos).' },
      { status: 400 }
    );
  }

  /* ── Validação dos artigos contra a base de dados (anti-fraude) ── */
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const wanted = new Map<number, number>();
  for (const item of rawItems as CartInput[]) {
    const id = Number(item?.id);
    const qty = Math.round(Number(item?.quantity));
    if (!Number.isInteger(id) || id <= 0) continue;
    if (!Number.isInteger(qty) || qty <= 0 || qty > 99) continue;
    wanted.set(id, Math.min((wanted.get(id) ?? 0) + qty, 99));
  }

  if (wanted.size === 0) {
    return NextResponse.json(
      { error: 'O carrinho está vazio — adiciona pelo menos um produto.' },
      { status: 400 }
    );
  }

  const ids = [...wanted.keys()];
  // ids já validados como inteiros positivos; enviamos como texto e
  // convertemos em array de inteiros na BD (o driver neon() não tem .join)
  const dbProducts = (await sql`
    SELECT p.id, p.name, p.price_kz, p.user_id, u.email AS seller_email
    FROM products p
    LEFT JOIN users u ON u.id = p.user_id
    WHERE p.id = ANY(string_to_array(${ids.join(',')}, ',')::int[])
  `) as unknown as DbProduct[];

  if (dbProducts.length !== wanted.size) {
    return NextResponse.json(
      { error: 'Alguns artigos já não estão disponíveis. Atualiza o carrinho.' },
      { status: 409 }
    );
  }

  const items = dbProducts.map((p) => ({
    id: p.id,
    name: p.name,
    price_kz: p.price_kz,
    quantity: wanted.get(p.id) ?? 1,
    seller_id: p.user_id,
  }));
  const sellerEmails = [
    ...new Set(dbProducts.map((p) => p.seller_email).filter(Boolean) as string[]),
  ];

  const totalKz = items.reduce((acc, i) => acc + i.price_kz * i.quantity, 0);
  if (totalKz <= 0) {
    return NextResponse.json({ error: 'Total da encomenda inválido.' }, { status: 400 });
  }

  // Com comprovativo anexado → aguardando validação de um admin;
  // sem comprovativo → pendente (cliente ainda pode anexar depois).
  // Carteira → pago imediatamente (débito validado no servidor, escrow).
  const initialStatus =
    paymentMethod === 'carteira' ? 'pago' : proof ? 'aguardando_validacao' : 'pendente';

  try {
    // Verificação antecipada de saldo (o débito atómico real acontece já
    // após a criação — a BD continua a recusar saldos negativos)
    if (paymentMethod === 'carteira' && userId !== null) {
      const wallet = await ensureWallet(userId);
      if (wallet.saldo < totalKz) {
        return NextResponse.json(
          {
            error: `Saldo insuficiente — tens ${Math.floor(wallet.saldo)} Kz disponíveis. Escolhe KWiK ou carrega a carteira.`,
          },
          { status: 400 }
        );
      }
    }

    const inserted = (await sql`
      INSERT INTO orders (customer_name, customer_phone, customer_email, items, total_kz, status, delivery_type, notes, user_id, comprovativo_url, payment_method, payment_proof, payment_proof_name, payment_proof_type, affiliate_code, latitude, longitude)
      VALUES (
        ${customerName},
        ${customerPhone},
        ${customerEmail},
        ${JSON.stringify(items)}::jsonb,
        ${totalKz},
        ${initialStatus},
        ${deliveryType},
        ${notes},
        ${userId},
        ${comprovativoUrl},
        ${paymentMethod},
        ${proof ? proof.dataUrl : null},
        ${proof ? proof.name : null},
        ${proof ? proof.mime : null},
        ${affiliateCode},
        ${clientLat},
        ${clientLng}
      )
      RETURNING id, created_at, total_kz, status
    `);

    const order = inserted[0];

    /* ── Carteira: débito + escrow + comissões (tudo server-side) ── */
    if (paymentMethod === 'carteira' && userId !== null) {
      try {
        await payWithWallet(userId, order.id, totalKz);
      } catch (walletError) {
        if (walletError instanceof InsufficientFundsError) {
          // Reverte a encomenda — saldo não chegou (corrida rara)
          await sql`DELETE FROM orders WHERE id = ${order.id}`;
          return NextResponse.json(
            { error: 'Saldo insuficiente — carrega a carteira ou usa KWiK.' },
            { status: 400 }
          );
        }
        throw walletError;
      }
      // Vendedores recebem em saldo_bloqueado (escrow até entrega)
      await creditSellersOnPaid(order.id);
      await payAffiliateCommission(order.id, totalKz, affiliateCode);
    }

    // Emails (não bloqueiam a encomenda em caso de falha)
    try {
      await sendOrderNotifications(
        {
          orderId: order.id,
          customerName,
          customerEmail,
          customerPhone,
          totalKz,
          items,
          paymentMethod,
          reference: buildKwikReference(order.id),
          proofAttached: Boolean(proof),
        },
        sellerEmails
      );
    } catch (emailError) {
      console.error('[API /api/orders] Email falhou (não crítico):', emailError);
    }

    return NextResponse.json(
      {
        ok: true,
        order: {
          id: order.id,
          created_at: order.created_at,
          total_kz: order.total_kz,
          status: order.status,
          payment_method: paymentMethod,
          reference: buildKwikReference(order.id),
          proof_attached: Boolean(proof),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[API /api/orders] Erro no Neon:', error);
    return NextResponse.json(
      { error: 'Não foi possível registar a encomenda agora. Tenta novamente ou fala connosco pelo WhatsApp.' },
      { status: 503 }
    );
  }
}

/**
 * GET /api/orders?mine=1 — histórico de compras do utilizador autenticado.
 * GET /api/orders (sem ?mine=1) — 🔒 apenas admin/admin_limitado.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  if (searchParams.get('mine') === '1') {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json(
        { error: 'Sessão inválida ou expirada. Entra novamente.' },
        { status: 401 }
      );
    }
    try {
      const myOrders = (await sql`
        SELECT id, items, total_kz, status, delivery_type, created_at
        FROM orders
        WHERE user_id = ${user.id}
        ORDER BY created_at DESC
        LIMIT 50
      `) as unknown as {
        id: number;
        items: { id: number; name: string; price_kz: number; quantity: number }[];
        total_kz: number;
        status: string;
        delivery_type: string;
        created_at: string;
      }[];

      /* Enriquece os itens com type + file_url (download de infoprodutos — Fase 5) */
      const productIds = [
        ...new Set(myOrders.flatMap((o) => o.items.map((i) => Number(i.id)).filter(Boolean))),
      ];
      const fileMap = new Map<number, { type: string; file_url: string | null }>();
      if (productIds.length > 0) {
        const rows = (await sql`
          SELECT id, type, file_url FROM products
          WHERE id = ANY(string_to_array(${productIds.join(',')}, ',')::int[])
        `) as unknown as { id: number; type: string; file_url: string | null }[];
        for (const r of rows) {
          fileMap.set(Number(r.id), { type: r.type, file_url: r.file_url });
        }
      }

      const orders = myOrders.map((o) => ({
        ...o,
        items: o.items.map((i) => ({
          ...i,
          type: fileMap.get(Number(i.id))?.type ?? null,
          file_url: fileMap.get(Number(i.id))?.file_url ?? null,
        })),
      }));

      return NextResponse.json({ orders });
    } catch (error) {
      console.error('[API /api/orders] Erro ao listar (mine):', error);
      return NextResponse.json({ orders: [] }, { status: 200 });
    }
  }

  // 🔒 Listagem global — antigamente pública, agora só para admins
  const auth = await requireAnyAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const rows = await sql`
      SELECT id, customer_name, total_kz, status, created_at
      FROM orders
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return NextResponse.json({ orders: rows });
  } catch (error) {
    console.error('[API /api/orders] Erro ao listar:', error);
    return NextResponse.json({ orders: [] }, { status: 200 });
  }
}
