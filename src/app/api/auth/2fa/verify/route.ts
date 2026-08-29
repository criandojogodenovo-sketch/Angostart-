import { NextRequest, NextResponse } from 'next/server';
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import { sql } from '@/lib/db';
import { clientKey, rateLimit, requireAnyAdmin } from '@/lib/security';
import { signAdminSession, ADMIN_COOKIE, adminCookieOptions } from '@/lib/admin-session';

export const dynamic = 'force-dynamic';

/** Configuração TOTP padrão do otplib v13 (plugins noble/scure). */
function createTotp(secret: string) {
  return new TOTP({
    secret,
    crypto: new NobleCryptoPlugin(),
    base32: new ScureBase32Plugin(),
  });
}

/**
 * POST /api/auth/2fa/verify — valida o código TOTP de 6 dígitos e
 * ATIVA o 2FA na primeira vez + emite o cookie da sessão admin (8 h).
 * É este cookie que o middleware exige em /admin e /admin-limitado.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAnyAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  // 8 tentativas / 5 min — bloqueia força-bruta de códigos
  if (!rateLimit(clientKey(request, '2fa-verify'), 8, 5 * 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas tentativas de código. Espera 5 minutos.' },
      { status: 429 }
    );
  }

  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const code = (body.code ?? '').replace(/\D/g, '');
  if (code.length !== 6) {
    return NextResponse.json({ error: 'Introduz o código de 6 dígitos.' }, { status: 400 });
  }

  try {
    const rows = (await sql`
      SELECT two_factor_secret FROM users WHERE id = ${auth.user.id} LIMIT 1
    `) as unknown as { two_factor_secret: string | null }[];
    const secret = rows[0]?.two_factor_secret;
    if (!secret) {
      return NextResponse.json(
        { error: 'O 2FA ainda não foi configurado. Começa por "Ativar 2FA".' },
        { status: 400 }
      );
    }

    const totp = createTotp(secret);
    const result = await totp.verify(code);
    if (!result.valid) {
      return NextResponse.json({ error: 'Código inválido ou expirado. Tenta o próximo.' }, { status: 401 });
    }

    // Ativa definitivamente o 2FA e emite o cookie de sessão privilegiada
    await sql`
      UPDATE users SET two_factor_enabled = TRUE WHERE id = ${auth.user.id}
    `;
    const token = await signAdminSession({
      sub: String(auth.user.id),
      role: auth.user.role as 'admin' | 'admin_limitado',
    });

    const response = NextResponse.json({
      ok: true,
      role: auth.user.role,
      message: '2FA validado — sessão de administração ativa por 8 horas.',
    });
    response.cookies.set(ADMIN_COOKIE, token, adminCookieOptions());
    return response;
  } catch (error) {
    console.error('[2fa/verify] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível validar o código agora.' }, { status: 503 });
  }
}
