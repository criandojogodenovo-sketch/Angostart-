import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminSession, ADMIN_COOKIE } from '@/lib/admin-session';

/**
 * AngoStart — Proxy de proteção dos painéis ocultos (ex-middleware, Next 16).
 *
 * /admin            → exige cookie de sessão 2FA com role='admin'
 * /admin-limitado   → exige role='admin_limitado'
 *
 * Sem sessão válida, redireciona para o MESMO URL com ?gate=1, onde a
 * página renderiza apenas o formulário de login + código 2FA (sem dados).
 * As rotas não estão linkadas em menus/sitemap e estão bloqueadas no robots.txt.
 */
export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  const isAdminPanel = pathname === '/admin' || pathname.startsWith('/admin/');
  const isLimitedPanel =
    pathname === '/admin-limitado' || pathname.startsWith('/admin-limitado/');

  if (!isAdminPanel && !isLimitedPanel) {
    return NextResponse.next();
  }

  // ?gate=1 → o middleware deixa passar; a página mostra só o gate de login+2FA
  if (searchParams.get('gate') === '1') {
    return NextResponse.next();
  }

  const session = await verifyAdminSession(request.cookies.get(ADMIN_COOKIE)?.value);

  // Hierarquia: /admin exige 'admin'; /admin-limitado aceita
  // 'admin_limitado' OU 'admin' (mais privilegiado).
  const allowedRoles =
    isLimitedPanel && !isAdminPanel
      ? (['admin_limitado', 'admin'] as const)
      : (['admin'] as const);

  if (session && (allowedRoles as readonly string[]).includes(session.role)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.searchParams.set('gate', '1');
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/admin', '/admin/:path*', '/admin-limitado', '/admin-limitado/:path*'],
};
