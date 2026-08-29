import { NextRequest, NextResponse } from 'next/server';
import { generateSecret, generateURI } from 'otplib';
import QRCode from 'qrcode';
import { sql } from '@/lib/db';
import { clientKey, rateLimit, requireAnyAdmin } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/2fa/setup — gera o segredo TOTP do admin (passo 1 do 2FA).
 * Retorna o URL `otpauth://` + QR code (data URL) para configurar
 * Google Authenticator / Authy / Aegis.
 * O segredo só fica ATIVO depois de um código válido em /2fa/verify.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAnyAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!rateLimit(clientKey(request, '2fa-setup'), 10, 60_000)) {
    return NextResponse.json({ error: 'Demasiadas tentativas. Aguarda um minuto.' }, { status: 429 });
  }

  try {
    const secret = generateSecret();
    const otpauthUrl = generateURI({
      secret,
      label: auth.user.email,
      issuer: 'AngoStart',
    });
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 220, margin: 1 });

    // Guarda o segredo como PENDENTE — só ativa após verify com código válido
    await sql`
      UPDATE users
      SET two_factor_secret = ${secret}, two_factor_enabled = FALSE
      WHERE id = ${auth.user.id}
    `;

    return NextResponse.json({ otpauth: otpauthUrl, qr: qrDataUrl });
  } catch (error) {
    console.error('[2fa/setup] Erro:', error);
    return NextResponse.json(
      { error: 'Não foi possível gerar o 2FA agora.' },
      { status: 503 }
    );
  }
}
