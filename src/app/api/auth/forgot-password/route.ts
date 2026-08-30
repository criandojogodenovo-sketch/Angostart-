import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { clientKey, rateLimit } from '@/lib/security';
import { getAppUrl } from '@/lib/env';
import { sendPasswordResetEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

/** Mascara o token para logs (diagnóstico sem expor o segredo). */
function maskToken(token: string): string {
  return token.length > 12 ? `${token.slice(0, 8)}…${token.slice(-4)}` : '***';
}

/**
 * POST /api/auth/forgot-password — "Esqueci a senha" (Fase 5 + auditoria).
 *
 * Cria um token de uso único (2 h) e envia o link por email (Brevo).
 * Por segurança a resposta é SEMPRE { ok: true } — nunca revela se o
 * email existe na plataforma (anti-enumeração de contas).
 *
 * Auditoria (bug "1º link inválido"): ao gerar um novo token, os tokens
 * pendentes anteriores são invalidados — assim, se o utilizador clicar
 * num link antigo (ex.: Gmail agrupa os emails na mesma thread), recebe
 * a mensagem clara "foi substituído" em vez de um erro genérico.
 * O token NUNCA é consumido por abrir a página (só ao submeter a nova
 * senha em POST /api/auth/reset-password).
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
      // Token aleatório de 32 bytes → guardamos apenas o HASH (SHA-256) na BD
      const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
      const tokenHash = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
      ).toString('hex');

      // Auditoria: tokens pendentes anteriores deixam de valer —
      // evita confusão entre links antigos (thread de email) e o atual.
      const invalidated = (await sql`
        UPDATE password_resets SET used = TRUE
        WHERE user_id = ${user.id} AND used = FALSE
        RETURNING id
      `) as unknown as { id: number }[];

      await sql`
        INSERT INTO password_resets (user_id, token_hash, expires_at)
        VALUES (${user.id}, ${tokenHash}, now() + interval '2 hours')
      `;

      // Diagnóstico (mascarado — o token completo NUNCA vai para logs)
      console.log(
        `[forgot-password] Token gerado: ${maskToken(token)} — user: ${user.id} — ` +
          `validade: 2h — links anteriores invalidados: ${invalidated.length}`
      );

      const link = `${getAppUrl()}/redefinir-senha?token=${token}`;
      try {
        await sendPasswordResetEmail(email, link);
      } catch {
        /* email opcional — modo dev regista na consola */
      }
    }

    // Resposta idêntica com ou sem conta (anti-enumeração)
    return NextResponse.json({
      ok: true,
      message: 'Se este email existir na AngoStart, receberás um link de recuperação dentro de minutos. Verifica também a caixa de spam.',
    });
  } catch (error) {
    console.error('[API forgot-password] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível processar agora. Tenta novamente.' }, { status: 503 });
  }
}
