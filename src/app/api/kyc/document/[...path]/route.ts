import { NextRequest, NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { requireRole, clientKey, rateLimit, isAdminRole } from '@/lib/security';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ path: string[] }> };

/**
 * GET /api/kyc/document/[...path] (Fase 12) — serve a FOTO do documento
 * KYC (namespace `kyc/`) APENAS a quem tem direito:
 *   - o próprio vendedor (dono do documento), ou
 *   - admin / admin_limitado (revisão da verificação).
 *
 * O store Vercel Blob é PRIVADO; os documentos enviados por
 * POST /api/kyc/upload (guardados em users.kyc_document_url como
 * `/api/kyc/document/…`) são servidos aqui, em stream server-side.
 *
 * 🔒 SEGURANÇA — documento de identidade, superfície rigorosamente limitada:
 * - Autenticação OBRIGATÓRIA (Bearer JWT) — sem token → 401.
 * - Dono do documento ou admin; qualquer outro → 403.
 * - Aceita APENAS paths `<userId>/<timestamp>-<nome>` (regex estrita,
 *   sem `..`, sem barras extra) — o resto → 404.
 * - NUNCA expõe `produtos/` nem `ebooks/` (rotas próprias).
 * - `Cache-Control: private, no-store` — documento sensível não pode
 *   ficar em cache partilhada/CDN.
 * - Content-Type restringido a imagens + nosniff.
 * - Rate limit: 60 pedidos/min por IP (prévia na fila do admin).
 */

/** Formato exato gerado por POST /api/kyc/upload (sem o prefixo kyc/). */
const DOC_PATH_RE = /^(\d+)\/(\d{13})-([A-Za-z0-9._-]{1,120})$/;

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export async function GET(request: NextRequest, context: RouteContext) {
  if (!rateLimit(clientKey(request, 'kyc-document-get'), 60, 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos.' }, { status: 429 });
  }

  /* Autenticação obrigatória — qualquer role (dono pode ser cliente? Não:
     documentos só existem para vendedores, mas o dono autentica de igual
     modo; admin revisita a fila). */
  const auth = await requireRole(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { path } = await context.params;
  const tail = (path ?? []).join('/');

  const match = tail.match(DOC_PATH_RE);
  if (!match) {
    // Path mal formado ou namespace estranho — não existe para o cliente
    return NextResponse.json({ error: 'Documento não encontrado.' }, { status: 404 });
  }

  const ownerRaw = match[1];
  const ownerId = Number(ownerRaw);
  if (!Number.isInteger(ownerId) || ownerId <= 0) {
    return NextResponse.json({ error: 'Documento não encontrado.' }, { status: 404 });
  }

  /* Autorização: dono do documento ou admin. */
  const isOwner = auth.user.id === ownerId;
  const isAdmin = isAdminRole(auth.user.role);
  if (!isOwner && !isAdmin) {
    return NextResponse.json(
      { error: 'Não tens permissão para ver este documento.' },
      { status: 403 }
    );
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return NextResponse.json(
      { error: 'Armazenamento não configurado.' },
      { status: 503 }
    );
  }

  const pathname = `kyc/${tail}`;

  try {
    // `get` aceita pathname e resolve o store a partir do token (v2.8.0)
    const result = await get(pathname, { access: 'private', token: blobToken });

    if (!result || result.statusCode !== 200) {
      console.error('[API kyc/document] Blob indisponível:', result?.statusCode);
      return NextResponse.json({ error: 'Documento indisponível.' }, { status: 502 });
    }

    const extension = (pathname.split('.').pop() || '').toLowerCase();

    return new NextResponse(result.stream, {
      status: 200,
      headers: {
        'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
        // Documento sensível: sem cache partilhada, sem CDN
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    // Blob apagado ou inexistente → 404 limpo (não 500)
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|does not exist|404/i.test(message)) {
      return NextResponse.json({ error: 'Documento não encontrado.' }, { status: 404 });
    }
    console.error('[API kyc/document] Erro:', error);
    return NextResponse.json({ error: 'Documento indisponível.' }, { status: 502 });
  }
}
