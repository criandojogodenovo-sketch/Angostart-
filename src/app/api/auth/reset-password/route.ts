import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { clientKey, rateLimit } from '@/lib/security';
import { signToken } from '@/lib/auth';
import { validatePassword } from '@/lib/password';

export const dynamic = 'force-dynamic';

/** Mascara o token para logs (diagnóstico sem expor o segredo). */
function maskToken(token: string): string {
  return token.length > 12 ? `${token.slice(0, 8)}…${token.slice(-4)}` : '***';
}

/**
 * POST /api/auth/reset-password — redefinir senha com token do email.
 * Corpo: { token, password }
 *
 * Auditoria (bug "1º link inválido"):
 *  - O token só é consumido AQUI (POST com a nova senha). Abrir o link
 *    (GET da página) NÃO invalida nada — não existe handler GET.
 *  - O token é de uso único e agora expira em 2 horas (antes: 1 h).
 *  - Erros diferenciados (utilizado/expirado/inválido) para diagnóstico.
 *  - Logs mascarados (nunca o token completo — é um segredo).
 *  - Nova senha valida com a política forte da Fase 9 (validatePassword).
 */
export async function POST(request: NextRequest) {
  if (!rateLimit(clientKey(request, 'reset-password'), 10, 15 * 60_000)) {
    return NextResponse.json({ error: 'Demasiados pedidos. Aguarda alguns minutos.' }, { status: 429 });
  }

  let body: { token?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!/^[a-f0-9]{64}$/.test(token)) {
    return NextResponse.json({ error: 'Link de recuperação inválido.' }, { status: 400 });
  }

  // Política forte da Fase 9 — mesma regra do registo e da troca de senha
  const passwordCheck = validatePassword(password);
  if (!passwordCheck.ok) {
    return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
  }

  try {
    const bcrypt = await import('bcryptjs');
    const tokenHash = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
    ).toString('hex');

    // Diagnóstico: procura a linha SEM filtrar used/expiração para
    // distinguir "inválido" de "já utilizado" e "expirado".
    const candidates = (await sql`
      SELECT r.id, r.user_id, r.used::boolean, r.expires_at,
             u.email, u.role, u.blocked::boolean
      FROM password_resets r
      JOIN users u ON u.id = r.user_id
      WHERE r.token_hash = ${tokenHash}
      ORDER BY r.created_at DESC
      LIMIT 1
    `) as unknown as {
      id: number;
      user_id: number;
      used: boolean;
      expires_at: string | Date;
      email: string;
      role: string;
      blocked: boolean;
    }[];

    const reset = candidates[0];
    if (!reset || reset.blocked) {
      console.log(`[reset-password] Token validado: NÃO (${maskToken(token)}) — motivo: inexistente`);
      return NextResponse.json(
        { error: 'Link inválido ou expirado — pede um novo em "Esqueci a senha".' },
        { status: 400 }
      );
    }
    if (reset.used) {
      console.log(`[reset-password] Token validado: NÃO (${maskToken(token)}) — motivo: já utilizado/substituído — user: ${reset.user_id}`);
      return NextResponse.json(
        {
          error:
            'Este link já foi utilizado ou foi substituído por um pedido mais recente — ' +
            'usa o email de recuperação mais recente ou pede um novo em "Esqueci a senha".',
        },
        { status: 400 }
      );
    }
    if (new Date(reset.expires_at).getTime() <= Date.now()) {
      console.log(`[reset-password] Token validado: NÃO (${maskToken(token)}) — motivo: expirado — user: ${reset.user_id}`);
      return NextResponse.json(
        { error: 'Este link expirou (validade de 2 horas) — pede um novo em "Esqueci a senha".' },
        { status: 400 }
      );
    }

    console.log(`[reset-password] Token validado: SIM (${maskToken(token)}) — user: ${reset.user_id}`);

    const passwordHash = await bcrypt.hash(password, 12);

    // Uso único: marca primeiro (evita corridas), depois atualiza a senha
    const used = (await sql`
      UPDATE password_resets SET used = TRUE
      WHERE id = ${reset.id} AND used = FALSE
      RETURNING id
    `) as unknown as { id: number }[];
    if (!used[0]) {
      return NextResponse.json({ error: 'Este link já foi utilizado.' }, { status: 400 });
    }

    await sql`
      UPDATE users SET password_hash = ${passwordHash} WHERE id = ${reset.user_id}
    `;
    // Invalida outros tokens pendentes da conta
    await sql`
      UPDATE password_resets SET used = TRUE
      WHERE user_id = ${reset.user_id} AND used = FALSE
    `;

    const jwtToken = signToken({
      id: reset.user_id,
      email: reset.email,
      role: reset.role as Parameters<typeof signToken>[0]['role'],
    });

    return NextResponse.json({ ok: true, token: jwtToken });
  } catch (error) {
    console.error('[API reset-password] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível redefinir agora. Tenta novamente.' }, { status: 503 });
  }
}
