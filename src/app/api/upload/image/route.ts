import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { requireSeller, clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/upload/image — upload de FOTO de produto/serviço (galeria real).
 *
 * Substitui o antigo campo «Link da imagem»: o vendedor escolhe um ficheiro
 * do telemóvel/galeria (JPG, PNG ou WebP, máx. 5 MB) e o ficheiro vai para
 * o Vercel Blob.
 *
 * ⚠️ O store Vercel Blob desta app é **PRIVADO** — `access: 'public'`
 * falha com "Cannot use public access on a private store" (fix anterior
 * 19d94d0 nos PDFs). As imagens de catálogo ficam então PRIVADAS no Blob
 * e são servidas publicamente por GET /api/media/[...path], que:
 *  - só expõe o namespace `produtos/` (nunca `ebooks/` nem comprovativos);
 *  - faz stream server-side com cache imutável (path contém timestamp).
 * Resultado prático: imagem visível a todos, sem depender de store público.
 *
 * 🔒 SEGURANÇA:
 * - Apenas vendedores autenticados.
 * - MIME whitelist (jpeg/png/webp) + magic bytes — não confia no cliente.
 * - Máx. 5 MB; nome sanitizado; path namespaced por utilizador.
 * - Rate limit: 20 uploads / 10 min por IP.
 * - Devolve URL RELATIVO (/api/media/produtos/…) — evita dependência do
 *   domínio (funciona em preview deployments da Vercel).
 */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

export async function POST(request: NextRequest) {
  const auth = await requireSeller(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // 20 uploads / 10 minutos por IP
  if (!rateLimit(clientKey(request, 'image-upload'), 20, 10 * 60_000)) {
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
      { error: 'Seleciona uma foto do produto (JPG, PNG ou WebP).' },
      { status: 400 }
    );
  }
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: 'A foto deve ter entre 1 byte e 5 MB.' },
      { status: 400 }
    );
  }

  const mime = (file.type || '').toLowerCase();
  if (!IMAGE_MIME_TYPES.has(mime)) {
    return NextResponse.json(
      { error: 'Formato inválido — usa JPG, PNG ou WebP.' },
      { status: 400 }
    );
  }

  const extension = (file.name.split('.').pop() || '').toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) {
    return NextResponse.json(
      { error: 'Extensão inválida — usa .jpg, .jpeg, .png ou .webp.' },
      { status: 400 }
    );
  }

  /* ── Magic bytes: valida a assinatura real do ficheiro ── */
  const headBuffer = Buffer.from(await file.slice(0, 12).arrayBuffer());
  const startsWith = (sig: number[]) =>
    sig.every((b, i) => headBuffer[i] === b);
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

  // Auditoria: a validação de segurança ANTES do check de infraestrutura —
  // sem BLOB token o vendedor recebe 400 de ficheiro inválido em vez de 503.
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return NextResponse.json(
      {
        error:
          'Armazenamento de imagens ainda não configurado. O administrador deve definir BLOB_READ_WRITE_TOKEN na Vercel.',
      },
      { status: 503 }
    );
  }

  try {
    const safeName = (file.name || 'produto.jpg')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(0, 80);
    const pathname = `produtos/${auth.user.id}/${Date.now()}-${safeName}`;

    const blob = await put(pathname, file, {
      access: 'private', // store privado — servido publicamente via /api/media
      addRandomSuffix: true,
      token: blobToken,
      contentType: mime,
    });

    return NextResponse.json(
      {
        ok: true,
        // URL relativo público (via rota de media) — guardado em image_url
        url: `/api/media/${blob.pathname}`,
        pathname: blob.pathname,
        size: file.size,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[API upload/image] Erro no Blob:', error);
    return NextResponse.json(
      { error: 'Não foi possível enviar a foto agora. Tenta novamente.' },
      { status: 503 }
    );
  }
}
