import { NextRequest, NextResponse } from 'next/server';
import { signToken } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/security';
import {
  logAdminAudit,
  rotateDailyCode,
  verifyDailyCode,
} from '@/lib/admin-invites';
import { sendDailyCodeEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/daily-code/verify — login diário do admin limitado.
 * Corpo: { email, code } — código de 6 dígitos recebido por email hoje.
 *
 * Regras:
 *  - Rate limit 5 tentativas/minuto por IP (especificação de segurança).
 *  - Uso único: o código é marcado como usado no primeiro acerto.
 *  - Se ainda não houver código hoje, gera e envia por email (202 pending)
 *    — o utilizador repete o pedido com o código recebido.
 *  - Sucesso → JWT Bearer; o gate exige de seguida o 2FA (TOTP).
 *
 * 🌐 Público (é o "login"), com auditoria de tentativas falhadas.
 */
export async function POST(request: NextRequest) {
  if (!rateLimit(clientKey(request, 'daily-code-verify'), 5, 60_000)) {
    return NextResponse.json(
      { error: 'Demasiadas tentativas. Aguarda 1 minuto antes de voltar a tentar.' },
      { status: 429 }
    );
  }

  let body: { email?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo inválido (JSON esperado).' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const code = (body.code ?? '').replace(/\D/g, '');
  if (!email || code.length !== 6) {
    return NextResponse.json(
      { error: 'Introduz o email e o código diário de 6 dígitos.' },
      { status: 400 }
    );
  }

  try {
    const result = await verifyDailyCode(email, code);

    if (!result.ok) {
      if (result.reason === 'no_code') {
        // Primeira tentativa do dia sem código gerado: gera, envia e pede repetição
        const users = (await sqlUserByEmail(email)) as { id: number }[] | null;
        if (users && users[0]) {
          const { code: newCode, expiresAt } = await rotateDailyCode(users[0].id);
          const delivered = await sendDailyCodeEmail(email, newCode, expiresAt);
          await logAdminAudit({
            userId: users[0].id,
            email,
            event: 'daily_code_generated',
            detail: 'lazy (pedido de login sem código hoje)',
            ip: clientKey(request, 'audit'),
          });
          if (delivered) {
            return NextResponse.json(
              {
                pending: true,
                message: 'Código diário enviado para o teu email. Verifica a caixa de entrada.',
              },
              { status: 202 }
            );
          }
          // Email indisponível (dev) → entrega o código na resposta
          return NextResponse.json(
            {
              pending: true,
              delivered: false,
              code: newCode,
              message: `Email não entregue (modo dev). Código diário: ${newCode}`,
            },
            { status: 202 }
          );
        }
      }

      await logAdminAudit({
        email,
        event: 'daily_code_failed',
        detail: `motivo: ${result.reason}`,
        ip: clientKey(request, 'audit'),
      });
      const messages: Record<string, string> = {
        no_account: 'Email ou código incorretos.',
        blocked: 'A conta foi bloqueada. Contacta o administrador.',
        no_code: 'Email ou código incorretos.',
        invalid: 'Código diário inválido. Verifica o email recebido hoje.',
        used: 'Este código já foi usado hoje. Pede um novo ao administrador.',
        expired: 'O código diário expirou — espera pelo código do dia seguinte.',
      };
      return NextResponse.json({ error: messages[result.reason] }, { status: 401 });
    }

    await logAdminAudit({
      userId: result.user.id,
      email: result.user.email,
      event: 'daily_code_verified',
      detail: 'login diário OK',
      ip: clientKey(request, 'audit'),
    });

    const token = signToken({
      id: result.user.id,
      email: result.user.email,
      role: result.user.role,
    });
    return NextResponse.json({
      ok: true,
      token,
      user: result.user,
      message: 'Código validado — confirma agora o 2FA.',
    });
  } catch (error) {
    console.error('[API daily-code/verify] Erro:', error);
    return NextResponse.json({ error: 'Não foi possível validar o código agora.' }, { status: 503 });
  }
}

/** Lookup mínimo por email (evita import circular com auth/db em duas rotas). */
async function sqlUserByEmail(email: string) {
  const { sql } = await import('@/lib/db');
  return (await sql`
    SELECT id FROM users
    WHERE email = ${email} AND role = 'admin_limitado' AND blocked = FALSE
    LIMIT 1
  `) as unknown as { id: number }[];
}
