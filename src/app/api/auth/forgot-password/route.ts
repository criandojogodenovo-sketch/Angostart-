import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { clientKey, rateLimit } from '@/lib/security';
import { getAppUrl } from '@/lib/env';
import { sendPasswordResetEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/forgot-password — "Esqueci a senha" (Fase 5).
 *
 * Cria um token de uso único (1 h) e envia o link por email (Brevo).
 * Por segurança a resposta é SEMPRE { ok: true } — nunca revela se o
 * email existe na plataforma (anti-enumerção de contas).
 */
export async function POST(request: NextRequest) {
  if (!rateLimit(clientKey(request, 'forgot-password'), 5, 15 * 60_000)) {
    return NextResponse.json(
      { error: 'Demasiados pedidos. Aguarda alguns minutos.' },
      { status: 429 }
    );
  }

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Escreve um email válido.' }, { status: 400 });
  }

  try {
    const rows = (await sql`
      SELECT id, name FROM users
      WHERE email = ${email} AND blocked = FALSE
      LIMIT 1
    `) as unknown as { id: number; name: string }[];

    const user = rows[0];
    if (user) {
      // Token aleatório de 32 bytes → guardamos apenas o HASH na BD
      const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
      const tokenHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');

      await sql`
        INSERT INTO password_resets (user_id, token_hash, expires_at)
        VALUES (${user.id}, ${tokenHash}, now() + interval '1 hour')
      `;

      const link = `${getAppUrl()}/redefinir-senha?token=${token}`;
      try {
        await sendPasswordResetEmail(email, link);
      } catch {
        /* email opcional — modo dev regista na consola */
      }
    }

    // Resposta idêntica com ou sem conta (anti-enumerção)
    return NextResponse.json({
      ok: true,
      message: 'Se este email existir na AngoStart, receberás um link de recuperação dentro de minutos. Verifica também a caixa de spam.',
    });
  } catch (error) {
    console.error('[API forgot-password] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível processar agora. Tenta novamente.' }, { status: 503 });
  }
}
