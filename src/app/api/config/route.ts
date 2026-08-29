import { NextResponse } from 'next/server';
import { momenuEnabled, momenuSandbox } from '@/lib/momenu';

export const dynamic = 'force-dynamic';

/**
 * GET /api/config — flags públicas de configuração (Fase 6, ponto 9).
 * Não expõe segredos — apenas booleanos derivados da presença das chaves.
 */
export async function GET() {
  return NextResponse.json({
    momenuEnabled: momenuEnabled(),
    momenuSandbox: momenuSandbox(),
  });
}
