import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { requireSeller, clientKey, rateLimit } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/products/upload — upload do PDF de um infoproduto (Fase 5).
 *
 * - 🔒 Apenas vendedores autenticados.
 * - Valida MIME (application/pdf) + magic bytes (%PDF-) + tamanho (20 MB).
 * - Guarda no Vercel Blob com path aleatório.
 * - Devolve { url } — guardado em products.file_url ao publicar.
 *
 * ⚠️ Requer BLOB_READ_WRITE_TOKEN (Vercel Blob Store). Sem o token,
 * devolve 503 com instrução clara (não quebra a app).
 */

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB

export async function POST(request: NextRequest) {
  const auth = await requireSeller(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // 8 uploads / 10 minutos por IP
  if (!rateLimit(clientKey(request, 'pdf-upload'), 8, 10 * 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados uploads seguidos. Aguarda alguns minutos.' },
      { status: 429 }
    );
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return NextResponse.json(
      {
        error:
          'Armazenamento de PDFs ainda não configurado. O administrador deve criar um Blob Store na Vercel e definir BLOB_READ_WRITE_TOKEN.',
      },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Formulário inválido (multipart esperado).' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Seleciona o ficheiro PDF do teu infoproduto.' }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      { error: `O PDF deve ter entre 1 byte e ${Math.floor(MAX_PDF_BYTES / (1024 * 1024))} MB.` },
      { status: 400 }
    );
  }

  const mimeOk =
    file.type === 'application/pdf' || file.type === 'application/x-pdf' || file.type === '';
  if (!mimeOk) {
    return NextResponse.json({ error: 'Formato inválido — envia apenas ficheiros PDF.' }, { status: 400 });
  }

  // Magic bytes: %PDF-
  const head = Buffer.from(await file.slice(0, 5).arrayBuffer()).toString('latin1');
  if (!head.startsWith('%PDF-')) {
    return NextResponse.json(
      { error: 'O ficheiro não é um PDF válido (assinatura %PDF- ausente).' },
      { status: 400 }
    );
  }

  try {
    const safeName = (file.name || 'infoproduto.pdf')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(0, 80);
    const pathname = `ebooks/${auth.user.id}/${Date.now()}-${safeName}`;

    const blob = await put(pathname, file, {
      access: 'public', // URL opaco (hash aleatório); a venda valida-se na rota de download
      addRandomSuffix: true,
      token: blobToken,
      contentType: 'application/pdf',
    });

    return NextResponse.json(
      { ok: true, url: blob.url, pathname: blob.pathname, size: file.size },
      { status: 201 }
    );
  } catch (error) {
    console.error('[API products/upload] Erro no Blob:', error);
    return NextResponse.json(
      { error: 'Não foi possível enviar o PDF agora. Tenta novamente.' },
      { status: 503 }
    );
  }
}
