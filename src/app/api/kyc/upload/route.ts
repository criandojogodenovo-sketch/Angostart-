import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { requireSeller, clientKey, rateLimit } from '@/lib/security';
import { KYC_MAX_FILE_MB } from '@/lib/kyc';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/kyc/upload (Fase 12) — upload da FOTO do documento de
 * identidade (BI, Passaporte ou Cartão de Eleitor) para verificação KYC.
 *
 * 🔒 SEGURANÇA — documento sensível, NUNCA público:
 * - Apenas vendedores autenticados.
 * - MIME whitelist (jpeg/png/webp) + magic bytes + extensão.
 * - Máx. 5 MB; nome sanitizado; path namespaced `kyc/<userId>/`.
 * - Guardado no Vercel Blob com `access: 'private'` (store privado).
 * - Servido POR UMA ROTA AUTORIZADA (GET /api/kyc/document/[...path]):
 *   só o próprio vendedor ou um admin consegue ver a imagem — sem cache
 *   pública, sem exposição no catálogo.
 * - Rate limit: 20 uploads / 10 min por IP.
 * - Devolve URL RELATIVO (`/api/kyc/document/…`) para guardar em
 *   `kyc_document_url` (POST /api/kyc/submit).
 */

const MAX_DOC_BYTES = KYC_MAX_FILE_MB * 1024 * 1024; // 5 MB

const DOC_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const DOC_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

export async function POST(request: NextRequest) {
  const auth = await requireSeller(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // 20 uploads / 10 minutos por IP
  if (!rateLimit(clientKey(request, 'kyc-upload'), 20, 10 * 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados uploads seguidos. Aguarda alguns minutos.' },
      { status: 429 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Formulário inválido (multipart esperado).' },
      { status: 400 }
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'Seleciona a foto do documento (JPG, PNG ou WebP).' },
      { status: 400 }
    );
  }
  if (file.size === 0 || file.size > MAX_DOC_BYTES) {
    return NextResponse.json(
      { error: `A foto do documento deve ter entre 1 byte e ${KYC_MAX_FILE_MB} MB.` },
      { status: 400 }
    );
  }

  const mime = (file.type || '').toLowerCase();
  if (!DOC_MIME_TYPES.has(mime)) {
    return NextResponse.json(
      { error: 'Formato inválido — usa JPG, PNG ou WebP.' },
      { status: 400 }
    );
  }

  const extension = (file.name.split('.').pop() || '').toLowerCase();
  if (!DOC_EXTENSIONS.has(extension)) {
    return NextResponse.json(
      { error: 'Extensão inválida — usa .jpg, .jpeg, .png ou .webp.' },
      { status: 400 }
    );
  }

  /* ── Magic bytes: valida a assinatura real do ficheiro ── */
  const headBuffer = Buffer.from(await file.slice(0, 12).arrayBuffer());
  const startsWith = (sig: number[]) => sig.every((b, i) => headBuffer[i] === b);
  const isJpeg = startsWith([0xff, 0xd8, 0xff]);
  const isPng = startsWith([0x89, 0x50, 0x4e, 0x47]);
  const isWebP =
    startsWith([0x52, 0x49, 0x46, 0x46]) &&
    headBuffer.slice(8, 12).toString('latin1') === 'WEBP';

  const magicOk =
    (mime === 'image/jpeg' && isJpeg) ||
    (mime === 'image/png' && isPng) ||
    (mime === 'image/webp' && isWebP);
  if (!magicOk) {
    return NextResponse.json(
      { error: 'O ficheiro não parece uma imagem válida (assinatura ausente).' },
      { status: 400 }
    );
  }

  // Validação de segurança ANTES do check de infraestrutura.
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return NextResponse.json(
      {
        error:
          'Armazenamento de documentos ainda não configurado. O administrador deve definir BLOB_READ_WRITE_TOKEN na Vercel.',
      },
      { status: 503 }
    );
  }

  try {
    const safeName = (file.name || 'documento.jpg')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(0, 80);
    const pathname = `kyc/${auth.user.id}/${Date.now()}-${safeName}`;

    const blob = await put(pathname, file, {
      access: 'private', // documento sensível — acesso só pela rota autorizada
      addRandomSuffix: true,
      token: blobToken,
      contentType: mime,
    });

    // URL relativo AUTORIZADO: /api/kyc/document/<userId>/<ficheiro>
    // (o pathname do blob é kyc/<userId>/<ficheiro> — retiramos o prefixo)
    const tail = blob.pathname.replace(/^kyc\//, '');
    return NextResponse.json(
      {
        ok: true,
        url: `/api/kyc/document/${tail}`,
        pathname: blob.pathname,
        size: file.size,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[API kyc/upload] Erro no Blob:', error);
    return NextResponse.json(
      { error: 'Não foi possível enviar o documento agora. Tenta novamente.' },
      { status: 503 }
    );
  }
}
