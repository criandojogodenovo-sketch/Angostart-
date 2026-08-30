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
  getRequestIp,
} from '@/lib/security';
import {
  parseAndValidateProof,
  buildKwikReference,
} from '@/lib/kwik';
import { isManualTransferMethod } from '@/lib/payments-manual';
import { parseCoord, ANGOLA_LAT, ANGOLA_LNG } from '@/lib/geo';
import { sanitizeSubId } from '@/lib/affiliate';
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
  /** Morada de entrega (produtos físicos/serviços ao domicílio). */
  delivery_address?: unknown;
  notes?: string;
  comprovativo_url?: string;
  /** Método de pagamento: 'kwik' | 'paypay' | 'multicaixa_express' |
   *  'whatsapp' | 'carteira' (saldo) | 'momenu' (desativado). */
  payment_method?: unknown;
  /** Comprovativo KWiK como data URL (data:<mime>;base64,<dados>). */
  payment_proof?: unknown;
  payment_proof_name?: unknown;
  /** Código de afiliado indicado no checkout (ex.: AFG-3K9PQX). */
  affiliate_code?: unknown;
  /** Sub-ID/campanha do link de afiliado (ex.: instagram — Fase 10). */
  affiliate_sub_id?: unknown;
  /** Localização do cliente (serviços ao domicílio — opcional, validada). */
  latitude?: unknown;
  longitude?: unknown;
}

interface DbProduct {
  id: number;
  name: string;
  price_kz: number;
  type: string;
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
 * - Notificações por email (Brevo): cliente + vendedores.
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
  // delivery_type é DERIVADO dos itens no servidor (digital/domicilio/entrega)
  const notes = sanitizeMultiline(body.notes, 300) || null;
  const comprovativoUrl =
    body.comprovativo_url?.trim() && isSafeHttpUrl(body.comprovativo_url.trim())
      ? body.comprovativo_url.trim()
      : null;

  /* ── Métodos de pagamento ──
   * Manuais por transferência (KWiK principal + PayPay + Multicaixa
   * Express): mesmo fluxo — cliente anexa comprovativo, admin valida.
   * 'carteira' = saldo interno; 'momenu' = automático (desativado).
   * 'whatsapp' FOI REMOVIDO do checkout — toda a negociação fica no chat
   * interno da plataforma (anti-burla). Por omissão → 'kwik'. */
  const rawMethod = isManualTransferMethod(body.payment_method)
    ? body.payment_method
    : body.payment_method === 'carteira'
      ? 'carteira'
      : body.payment_method === 'momenu'
        ? 'momenu' // Fase 6 (ponto 9): pagamento automático — validado depois pelo gateway
        : 'kwik';
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
  /* ── Sub-ID/campanha do afiliado (Fase 10 — ex.: instagram, whatsapp) ── */
  const affiliateSubId = sanitizeSubId(body.affiliate_sub_id);

  /* ── Localização do cliente (Fase 5 — serviços ao domicílio, opcional) ── */
  const clientLat = parseCoord(body.latitude, ANGOLA_LAT);
  const clientLng = parseCoord(body.longitude, ANGOLA_LNG);

  /* ── Morada de entrega (produtos físicos / serviços ao domicílio) ── */
  const deliveryAddress = sanitizeMultiline(body.delivery_address, 300) || null;

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
    SELECT p.id, p.name, p.price_kz, p.type, p.user_id, u.email AS seller_email
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
    type: p.type,
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

  /* ── Tipo de entrega derivado dos itens (o servidor é autoridade —
   *    o valor do cliente é ignorado):
   *    digital  → tudo infoproduto/servico_remoto (entrega sem morada)
   *    domicilio → há serviço ao domicílio (prestador desloca-se)
   *    entrega  → produto físico em Luanda */
  const hasDomicilioItem = items.some((i) => i.type === 'servico_domicilio');
  const allDigital = items.every(
    (i) => i.type === 'infoproduto' || i.type === 'servico_remoto'
  );
  const derivedDeliveryType = hasDomicilioItem
    ? 'domicilio'
    : allDigital
      ? 'digital'
      : 'entrega';

  /* ── Morada obrigatória para entregas físicas/domicílio ── */
  if (!allDigital && !deliveryAddress) {
    return NextResponse.json(
      {
        error:
          'Indica a morada de entrega (bairro, referência) — os serviços ao domicílio e produtos físicos precisam dela.',
      },
      { status: 400 }
    );
  }

  /* ── 🔒 BLOQUEIO: prestador indisponível → cliente NÃO pode pagar ──
   * Verificação server-side (a UI também bloqueia, mas isto é a fonte
   * de verdade): cada item de servico_domicilio tem de pertencer a um
   * prestador com is_available = true. */
  if (hasDomicilioItem) {
    const domicilioSellerIds = [
      ...new Set(
        items
          .filter((i) => i.type === 'servico_domicilio' && i.seller_id)
          .map((i) => Number(i.seller_id))
      ),
    ];
    if (domicilioSellerIds.length > 0) {
      const unavailable = (await sql`
        SELECT u.id, u.name
        FROM users u
        WHERE u.id = ANY(string_to_array(${domicilioSellerIds.join(',')}, ',')::int[])
          AND (u.is_available IS NOT TRUE OR u.blocked = TRUE)
      `) as unknown as { id: number; name: string }[];
      if (unavailable.length > 0) {
        return NextResponse.json(
          {
            error: `Este prestador está temporariamente indisponível. Escolha outro ou contacte no chat. (${unavailable[0].name})`,
            unavailable_sellers: unavailable.map((u) => u.name),
          },
          { status: 409 }
        );
      }
    }
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

    /* ── 🔒 Anti-duplicação (Fase 11): duplo clique / reenvio acidental ──
     * Mesmo com o botão desativado na UI, um duplo submit (rede lenta,
     * enter repetido) podia criar 2 encomendas iguais. Se o MESMO
     * utilizador criou uma encomenda com os MESMOS artigos, total e
     * método de pagamento há menos de 60 segundos, devolvemos essa
     * encomenda em vez de criar outra. Pagamentos por carteira não
     * entram (já debita à criação — repetir devia ser erro explícito). */
    if (userId !== null && paymentMethod !== 'carteira') {
      const recent = (await sql`
        SELECT id, total_kz, status, payment_method
        FROM orders
        WHERE user_id = ${userId}
          AND total_kz = ${totalKz}
          AND payment_method = ${paymentMethod}
          AND items = ${JSON.stringify(items)}::jsonb
          AND created_at > NOW() - INTERVAL '60 seconds'
        ORDER BY id DESC
        LIMIT 1
      `) as unknown as { id: number; total_kz: number; status: string; payment_method: string }[];
      if (recent[0]) {
        console.log(`[API /api/orders] Duplicado bloqueado — encomenda ${recent[0].id} reutilizada (user ${userId})`);
        return NextResponse.json({
          ok: true,
          duplicate: true,
          order: {
            id: recent[0].id,
            total_kz: Number(recent[0].total_kz),
            status: recent[0].status,
            payment_method: recent[0].payment_method,
            reference: buildKwikReference(recent[0].id),
            proof_attached: false,
          },
          message: 'Encomenda já registada há poucos segundos — a mostrar em vez de criar duplicado.',
        });
      }
    }

    const inserted = (await sql`
      INSERT INTO orders (customer_name, customer_phone, customer_email, items, total_kz, status, delivery_type, delivery_address, notes, user_id, comprovativo_url, payment_method, payment_proof, payment_proof_name, payment_proof_type, affiliate_code, affiliate_sub_id, latitude, longitude, ip_address)
      VALUES (
        ${customerName},
        ${customerPhone},
        ${customerEmail},
        ${JSON.stringify(items)}::jsonb,
        ${totalKz},
        ${initialStatus},
        ${derivedDeliveryType},
        ${allDigital ? null : deliveryAddress},
        ${notes},
        ${userId},
        ${comprovativoUrl},
        ${paymentMethod},
        ${proof ? proof.dataUrl : null},
        ${proof ? proof.name : null},
        ${proof ? proof.mime : null},
        ${affiliateCode},
        ${affiliateSubId},
        ${clientLat},
        ${clientLng},
        ${getRequestIp(request)}
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
      await payAffiliateCommission(order.id, totalKz, affiliateCode, userId, affiliateSubId);
    }

    /* Fase 9 — push "Novo Pedido" aos vendedores + notificação in-app. */
    try {
      const { pushNotification } = await import('@/lib/notifications');
      const sellerIds = new Set<number>();
      for (const item of items) {
        const sid = Number((item as { seller_id?: unknown }).seller_id);
        if (Number.isInteger(sid) && sid > 0) sellerIds.add(sid);
      }
      for (const sid of sellerIds) {
        await sql`
          INSERT INTO notifications (user_id, title, body, link)
          VALUES (${sid}, ${'Novo pedido recebido!'}, ${`${customerName} fez um pedido de ${totalKz} Kz — nº ${order.id}.`}, ${'/dashboard/vendedor'})
        `;
        await pushNotification(
          sid,
          'Novo pedido recebido!',
          `${customerName} — ${totalKz} Kz (pedido nº ${order.id}).`,
          '/dashboard/vendedor'
        );
      }
    } catch (pushError) {
      console.error('[API /api/orders] Push novo pedido falhou (não crítico):', pushError);
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
      { error: 'Não foi possível registar a encomenda agora. Tenta novamente ou fala connosco no chat.' },
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
