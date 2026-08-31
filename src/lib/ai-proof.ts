import 'server-only';

/**
 * AngoStart — Fase 14: verificação de comprovativos de pagamento por IA
 * de visão (VLM multi-provider com fallback).
 *
 * Fluxo: cliente anexa comprovativo à encomenda → o VLM extrai
 * {valor, data, referencia} → regra de segurança decide:
 *
 *  - `aprovado`   : confiança ALTA + valor coincide com o total da
 *                   encomenda (±1 Kz) + referência contém o n.º da
 *                   encomenda → status passa a `pago` automaticamente.
 *  - `revisao`    : qualquer discrepância OU confiança média/baixa →
 *                   status mantém `aguardando_validacao` e o admin é
 *                   avisado (email + a fila mostra o parecer da IA).
 *
 * Tudo é auditado em orders.ai_verification (JSONB): extração, valores
 * esperados, comparações, veredito, modelo e data. A IA NUNCA rejeita —
 * no pior caso deixa em revisão (o admin decide sempre).
 */

import { sql } from '@/lib/db';
import { aiAvailable } from '@/lib/ai/chat';
import { aiVisionJSON } from '@/lib/ai/vision';
import { sendAdminAlertEmail, sendOrderValidatedEmail } from '@/lib/email';

export interface ProofExtraction {
  /** Valor transferido em Kz (número) — null se ilegível. */
  valor: number | null;
  /** Data da transferência (AAAA-MM-DD se possível) — null se ilegível. */
  data: string | null;
  /** Referência / ID da operação visível no comprovativo — null se ausente. */
  referencia: string | null;
  /** Qualidade geral da leitura. */
  confianca: 'alta' | 'media' | 'baixa';
  /** Notas do modelo (nome do banco/app, destinatário, etc.). */
  notas: string;
}

export interface ProofVerdict {
  /** 'aprovado' | 'revisao' */
  verdict: 'aprovado' | 'revisao';
  motivo: string;
  valorCoincide: boolean;
  referenciaCoincide: boolean;
}

const VISION_SYSTEM = `És um extrator de dados de comprovativos de transferência bancária/mobile money angolanos (KWiK, PayPay, Afrimoney, UNITEL Money, Multicaixa Express, BAI, BFA…).

Da imagem extrai EXATAMENTE:
- "valor": número em Kz transferido (sem moeda, sem separadores de milhar; usa ponto para decimais). null se não estiver legível.
- "data": data da operação no formato AAAA-MM-DD. null se ilegível.
- "referencia": a referência/ID/n.º de operação da transação EXATAMENTE como aparece (texto curto). Se houver uma descrição/motivo com um número de encomenda (ex.: "#123", "AS-123", "encomenda 123"), inclui-o. null se não houver.
- "confianca": "alta" se a imagem é nítida e os campos são óbvios; "media" se precisa de algum esforço de leitura; "baixa" se borrada, cortada, parcial ou parece print editado.
- "notas": até 2 frases curtas (nome do app/banco, destinatário, qualquer discrepância suspeita).

NÃO inventes valores. É estritamente proibido adivinhar dígitos ilegíveis.
Responde APENAS com JSON válido:
{"valor": <número|null>, "data": "<AAAA-MM-DD>"|null, "referencia": "<texto>"|null, "confianca": "alta"|"media"|"baixa", "notas": "<texto>"}`;

/* ────────────── Regra de decisão (função PURA — testável) ────────────── */

/** Tolerância do valor: ±1 Kz ou ±0,5% (taxas de arredondamento). */
export function valorCoincide(extracted: number | null, esperado: number): boolean {
  if (extracted === null || !Number.isFinite(extracted)) return false;
  const tol = Math.max(1, esperado * 0.005);
  return Math.abs(extracted - esperado) <= tol;
}

/**
 * A referência visível menciona o n.º da encomenda?
 * Compara numericamente cada grupo de dígitos — apanha «#123», «AS-123»,
 * «AngoStart-ORD-00123» (zero-padded) e «encomenda 123», sem falsos
 * positivos tipo «1234» ≠ «123».
 */
export function referenciaCoincide(referencia: string | null, orderId: number): boolean {
  if (!referencia) return false;
  const grupos = referencia.match(/\d+/g);
  if (!grupos) return false;
  return grupos.some((g) => Number(g) === orderId);
}

/**
 * Decisão FINAL (função pura): só aprova com confiança alta + valor certo +
 * referência com o n.º da encomenda. Qualquer falha → revisão humana.
 */
export function decideProofVerdict(
  extracted: ProofExtraction,
  expectedTotalKz: number,
  orderId: number
): ProofVerdict {
  const valorOk = valorCoincide(extracted.valor, expectedTotalKz);
  const refOk = referenciaCoincide(extracted.referencia, orderId);

  if (extracted.confianca !== 'alta') {
    return {
      verdict: 'revisao',
      motivo: `Confiança da leitura "${extracted.confianca}" — admin valida manualmente.`,
      valorCoincide: valorOk,
      referenciaCoincide: refOk,
    };
  }
  if (!valorOk) {
    return {
      verdict: 'revisao',
      motivo: `Valor no comprovativo (${extracted.valor ?? 'ilegível'} Kz) difere do total da encomenda (${expectedTotalKz} Kz).`,
      valorCoincide: false,
      referenciaCoincide: refOk,
    };
  }
  if (!refOk) {
    return {
      verdict: 'revisao',
      motivo: 'Valor coincide, mas a referência não menciona o n.º da encomenda — admin confirma.',
      valorCoincide: true,
      referenciaCoincide: false,
    };
  }
  return {
    verdict: 'aprovado',
    motivo: 'Valor e referência coincidem com a encomenda (confiança alta).',
    valorCoincide: true,
    referenciaCoincide: true,
  };
}

/* ────────────── Orquestração: verificar + decidir + agir ────────────── */

export interface OrderForProof {
  id: number;
  total_kz: number;
  status: string;
  customer_email: string | null;
}

/** Carrega a encomenda mínima para verificar o comprovativo. */
export async function loadOrderForProof(orderId: number): Promise<OrderForProof | null> {
  const rows = (await sql`
    SELECT id, total_kz::float8 AS total_kz, status, customer_email
      FROM orders WHERE id = ${orderId} LIMIT 1
  `) as unknown as OrderForProof[];
  return rows[0] ?? null;
}

/**
 * Verifica o comprovativo (data-URL) de uma encomenda:
 * 1. Extrai dados com o VLM; 2. decide; 3. grava auditoria JSONB;
 * 4. se `aprovado` → status `pago` + email ao cliente; se `revisao` →
 * mantém `aguardando_validacao` + alerta ao admin.
 *
 * Nunca lança — devolve `{ ok:false }` em falhas de IA/BD (o fluxo de
 * compra do cliente NUNCA depende da IA).
 */
export async function verifyOrderProof(
  orderId: number,
  proofDataUrl: string
): Promise<
  | { ok: true; verdict: ProofVerdict; extraction: ProofExtraction; autoApproved: boolean }
  | { ok: false; error: string }
> {
  if (!aiAvailable()) return { ok: false, error: 'IA indisponível.' };

  const order = await loadOrderForProof(orderId);
  if (!order) return { ok: false, error: 'Encomenda não encontrada.' };

  /* Data-URL → valida tamanho (o upload já validou MIME/magic bytes). */
  if (!proofDataUrl.startsWith('data:image/')) {
    return { ok: false, error: 'Comprovativo não é uma imagem (PDF exige revisão humana).' };
  }
  if (proofDataUrl.length > 3_500_000) {
    return { ok: false, error: 'Imagem demasiado grande para análise.' };
  }

  const vision = await aiVisionJSON<ProofExtraction>(
    VISION_SYSTEM,
    proofDataUrl,
    { maxTokens: 350 }
  );
  if (!vision) return { ok: false, error: 'Falha na extração.' };
  const extraction = vision.data;

  /* Normaliza campos (o modelo pode desobedecer ao schema). */
  const clean: ProofExtraction = {
    valor:
      typeof extraction.valor === 'number' && Number.isFinite(extraction.valor)
        ? extraction.valor
        : null,
    data:
      typeof extraction.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(extraction.data)
        ? extraction.data
        : null,
    referencia: typeof extraction.referencia === 'string' ? extraction.referencia.slice(0, 120) : null,
    confianca: ['alta', 'media', 'baixa'].includes(extraction.confianca)
      ? extraction.confianca
      : 'baixa',
    notas: typeof extraction.notas === 'string' ? extraction.notas.slice(0, 300) : '',
  };

  const verdict = decideProofVerdict(clean, order.total_kz, order.id);
  const audit = {
    extracted: clean,
    expected: { total_kz: order.total_kz, order_id: order.id },
    matched: { valor: verdict.valorCoincide, referencia: verdict.referenciaCoincide },
    verdict: verdict.verdict,
    motivo: verdict.motivo,
    model: vision.model,
    provider: vision.provider,
    at: new Date().toISOString(),
  };

  let autoApproved = false;

  try {
    if (verdict.verdict === 'aprovado' && order.status === 'aguardando_validacao') {
      const upd = (await sql`
        UPDATE orders
           SET status = 'pago',
               ai_verification = ${JSON.stringify(audit)}::jsonb
         WHERE id = ${order.id}
           AND status = 'aguardando_validacao'
        RETURNING id
      `) as unknown as { id: number }[];
      if (upd[0]) {
        autoApproved = true;
        /* Email ao cliente com downloads (melhor-esforço). */
        try {
          await sendOrderValidatedEmail(order.id, order.customer_email, true);
        } catch { /* best-effort */ }
      } else {
        /* Estado mudou entretanto — grava só a auditoria. */
        await saveAuditOnly(order.id, audit);
      }
    } else {
      await saveAuditOnly(order.id, audit);
      /* Revisão → alerta ao admin (apenas quando há discrepância real). */
      if (verdict.verdict === 'revisao' && order.status === 'aguardando_validacao') {
        try {
          await sendAdminAlertEmail(
            `IA: comprovativo da encomenda #${order.id} precisa de revisão`,
            `<p>O comprovativo da encomenda <strong>#${order.id}</strong> foi analisado pela IA e ficou em <strong>revisão manual</strong>.</p>
             <p><strong>Motivo:</strong> ${verdict.motivo}</p>
             <p><strong>Extraído:</strong> valor ${clean.valor ?? '—'} Kz · referência ${clean.referencia ?? '—'} · confiança ${clean.confianca}.</p>
             <p><strong>Esperado:</strong> ${order.total_kz} Kz · encomenda #${order.id}.</p>
             <p>Valida em <a href="/admin">/admin → Encomendas</a>.</p>`
          );
        } catch { /* best-effort */ }
      }
    }
  } catch (error) {
    console.error('[lib/ai-proof] Falha ao persistir verificação:', error);
    return { ok: false, error: 'Falha ao gravar a verificação.' };
  }

  return { ok: true, verdict, extraction: clean, autoApproved };
}

async function saveAuditOnly(orderId: number, audit: unknown): Promise<void> {
  await sql`
    UPDATE orders SET ai_verification = ${JSON.stringify(audit)}::jsonb
     WHERE id = ${orderId}
  `;
}
