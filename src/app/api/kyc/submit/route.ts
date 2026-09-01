import { NextRequest, NextResponse } from 'next/server';
import { head } from '@vercel/blob';
import { sql } from '@/lib/db';
import {
  requireSeller,
  sanitizeText,
  clientKey,
  rateLimit,
} from '@/lib/security';
import { isKycDocumentUrl, KYC_DOCUMENT_TYPES, type KycDocumentType } from '@/lib/kyc';
import { BI_REGEX, calcularIdade } from '@/lib/password';
import { sendAdminAlertEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * POST /api/kyc/submit (Fase 12) — submissão (ou reenvio) do documento de
 * identidade para verificação KYC.
 *
 * Corpo: { kyc_document_url, kyc_document_type?, bi_number?, birth_date? }
 *  - kyc_document_url: URL devolvido por POST /api/kyc/upload e que tem de
 *    pertencer ao PRÓPRIO vendedor (formato /api/kyc/document/<meu-id>/…).
 *  - kyc_document_type: 'bi' | 'passaporte' | 'cartao_eleitor' (opcional).
 *  - bi_number/birth_date: opcionais — completam o perfil (BI validado no
 *    formato angolano; idade ≥ 15 se data preenchida).
 *
 * Efeito: kyc_status → 'pending' (revisão do admin), kyc_submitted_at
 * carimba a submissão e limpa o motivo de rejeição anterior. Enquanto
 * 'pending' o vendedor continua a poder vender; só 'rejected' bloqueia.
 *
 * 🔒 Apenas vendedores autenticados · 10 pedidos/min.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSeller(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!rateLimit(clientKey(request, 'kyc-submit'), 10, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas submissões seguidas. Aguarda um momento.' },
      { status: 429 }
    );
  }

  let body: {
    kyc_document_url?: unknown;
    kyc_document_type?: unknown;
    bi_number?: unknown;
    birth_date?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  /* ── URL do documento: obrigatório, interno e do próprio utilizador ── */
  const docUrlRaw =
    typeof body.kyc_document_url === 'string' ? body.kyc_document_url.trim() : '';
  if (!docUrlRaw) {
    return NextResponse.json(
      { error: 'Envia primeiro a foto do documento (upload) e volta a submeter.' },
      { status: 400 }
    );
  }
  if (!isKycDocumentUrl(docUrlRaw, auth.user.id)) {
    return NextResponse.json(
      { error: 'O documento deve ser enviado pelo upload da AngoStart (foto tua, do teu login).' },
      { status: 400 }
    );
  }

  /* ── Tipo de documento (opcional) ── */
  const docType =
    typeof body.kyc_document_type === 'string' &&
    (KYC_DOCUMENT_TYPES as readonly string[]).includes(body.kyc_document_type)
      ? (body.kyc_document_type as KycDocumentType)
      : null;

  /* ── BI opcional (formato angolano) ── */
  const biRaw =
    sanitizeText(body.bi_number, 20).toUpperCase().replace(/[\s-]/g, '') || null;
  if (biRaw && !BI_REGEX.test(biRaw)) {
    return NextResponse.json(
      { error: 'BI inválido — usa o formato do documento (ex.: 004587896LA038).' },
      { status: 400 }
    );
  }

  /* ── Data de nascimento opcional (idade ≥ 15 se preenchida) ── */
  const birthRaw = sanitizeText(body.birth_date, 10).trim() || null;
  if (birthRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthRaw) || Number.isNaN(new Date(`${birthRaw}T00:00:00Z`).getTime())) {
      return NextResponse.json(
        { error: 'Data de nascimento inválida — usa o formato AAAA-MM-DD.' },
        { status: 400 }
      );
    }
    const idade = calcularIdade(birthRaw);
    if (idade < 0 || idade > 120) {
      return NextResponse.json(
        { error: 'Data de nascimento inválida — verifica o ano.' },
        { status: 400 }
      );
    }
    if (idade < 15) {
      return NextResponse.json(
        { error: 'Idade mínima para vender na AngoStart é 15 anos.' },
        { status: 400 }
      );
    }
  }

  /* ── Verificação best-effort de que o documento existe no Blob.
        Sem BLOB token (dev local) salta — a submissão continua válida. ── */
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (blobToken) {
    try {
      const blobPath = docUrlRaw.replace(/^\/api\/kyc\/document\//, 'kyc/');
      const meta = await head(blobPath, { token: blobToken });
      if (!meta) {
        return NextResponse.json(
          { error: 'O documento enviado não foi encontrado — envia a foto novamente.' },
          { status: 400 }
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found|does not exist|404/i.test(message)) {
        return NextResponse.json(
          { error: 'O documento enviado não foi encontrado — envia a foto novamente.' },
          { status: 400 }
        );
      }
      // Outros erros de rede do Blob não bloqueiam a submissão (best-effort)
      console.warn('[API kyc/submit] head() falhou (não bloqueante):', message);
    }
  }

  try {
    const updated = (await sql`
      UPDATE users
      SET kyc_document_url = ${docUrlRaw},
          kyc_document_type = ${docType},
          kyc_status = 'pending',
          kyc_submitted_at = NOW(),
          kyc_rejection_reason = NULL,
          bi_number = COALESCE(${biRaw}, bi_number),
          birth_date = COALESCE(${birthRaw}, birth_date),
          /* Fase 13: documento submetido = carência cumprida — o prazo deixa
             de correr (o cron nunca marca 'overdue' quem já submeteu) e a
             marca de aviso é limpa para um ciclo futuro poder reavisar. */
          kyc_deadline = NULL,
          kyc_overdue_notified_at = NULL
      WHERE id = ${auth.user.id}
      RETURNING id, kyc_status
    `) as unknown as { id: number; kyc_status: string }[];

    if (!updated[0]) {
      return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 });
    }

    /* Aviso best-effort para a equipa de revisão (fila do admin). */
    try {
      const admins = (await sql`
        SELECT id FROM users WHERE role IN ('admin', 'admin_limitado')
      `) as unknown as { id: number }[];
      for (const admin of admins) {
        await sql`
          INSERT INTO notifications (user_id, title, body, link)
          VALUES (
            ${admin.id},
            'Novo documento KYC para rever',
            ${`${auth.user.name} submeteu um documento de identidade para verificação.`},
            '/admin'
          )`;
      }
      if (admins.length > 0) {
        /* Nome/email são texto do utilizador: escapar para HTML antes de
           interpolar no corpo do email (defesa contra header/mail injection). */
        const esc = (s: string) =>
          s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        await sendAdminAlertEmail(
          'Novo documento KYC para rever',
          `<p style="color:#0f172a">${esc(auth.user.name)} (${esc(auth.user.email)}) submeteu um documento de identidade.</p>
           <p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ''}/admin" style="color:#059669;font-weight:bold">Rever no painel admin →</a></p>`
        ).catch(() => {});
      }
    } catch (notifyError) {
      console.error('[API kyc/submit] Notificação ao admin falhou (não crítico):', notifyError);
    }

    return NextResponse.json({
      ok: true,
      message:
        'Documento submetido! A equipa AngoStart vai analisá-lo — avisamos-te por email e aqui na plataforma.',
      kyc_status: updated[0].kyc_status,
    });
  } catch (error) {
    console.error('[API kyc/submit] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível submeter o documento agora. Tenta novamente.' },
      { status: 503 }
    );
  }
}
