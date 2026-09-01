'use client';

/**
 * AngoStart — Porta de entrada dos painéis de administração.
 *
 * Dois modos de autenticação:
 *  - 'password' (Admin Total /admin): email + palavra-passe → 2FA.
 *  - 'code' (Admin Limitado /admin-limitado): SEM palavra-passe fixa.
 *      · Primeiro acesso: email + código de convite (recebido por email)
 *        → cria a conta → 2FA.
 *      · Acesso diário: email + código diário de 6 dígitos (enviado por
 *        email, muda a cada 24 h, uso único) → 2FA.
 *
 * Passo final partilhado: código TOTP (Google Authenticator etc.) →
 * cookie de sessão admin (8 h) emitido pelo servidor.
 */

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CalendarClock, Gift, KeyRound, Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { getToken, useAuth, type AuthUser } from '@/context/AuthContext';

interface AdminGateProps {
  /** Título do painel (ex.: "Administração Total"). */
  title: string;
  /** 'password' = admin total · 'code' = admin limitado (convite + código diário). */
  authMode?: 'password' | 'code';
  /** Sessão válida carregada → renderiza o painel. */
  children: (ctx: { role: 'admin' | 'admin_limitado' }) => ReactNode;
}

interface CodeLoginResponse {
  ok?: boolean;
  pending?: boolean;
  token?: string;
  user?: AuthUser;
  code?: string;
  message?: string;
  error?: string;
  delivered?: boolean;
}

export default function AdminGate({ title, authMode = 'password', children }: AdminGateProps) {
  const { toast } = useToast();
  const { login: authLogin, applySession } = useAuth();

  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [role, setRole] = useState<'admin' | 'admin_limitado'>('admin');

  // Passo 1 — identidade
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'daily' | 'invite'>('daily');
  const [accessCode, setAccessCode] = useState('');
  const [logging, setLogging] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Passo 2 — 2FA (QR na primeira ativação + código TOTP)
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [qrData, setQrData] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);

  async function checkSession() {
    try {
      const res = await fetch('/api/auth/2fa/session');
      if (res.ok) {
        const data = (await res.json()) as { role?: 'admin' | 'admin_limitado' };
        setRole(data.role ?? 'admin');
        setAuthenticated(true);
      } else {
        setAuthenticated(false);
      }
    } catch {
      setAuthenticated(false);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    checkSession();
  }, []);

  async function beginTwoFactor(newToken: string) {
    setToken(newToken);
    // Prepara o passo 2FA: sem segredo TOTP → QR de ativação; com segredo → código
    try {
      const setupRes = await fetch('/api/auth/2fa/setup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${newToken}` },
      });
      const setupData = (await setupRes.json()) as { qr?: string; otpauth?: string };
      if (setupRes.ok && setupData.qr) {
        setQrData(setupData.qr);
        setOtpauthUrl(setupData.otpauth ?? null);
      }
    } catch {
      /* se o setup falhar mas o 2FA já estiver ativo, seguimos para o código */
    }
  }

  async function handlePasswordLogin(event: React.FormEvent) {
    event.preventDefault();
    setLogging(true);
    try {
      // login() do AuthContext persiste token+user (localStorage) —
      // assim os pedidos do painel com authHeaders() levam o Bearer.
      let user;
      try {
        user = await authLogin(email, password);
      } catch (error) {
        toast({
          title: 'Entrada recusada',
          description: error instanceof Error ? error.message : 'Credenciais inválidas.',
        });
        return;
      }
      if (user.role !== 'admin' && user.role !== 'admin_limitado') {
        toast({
          title: 'Sem acesso',
          description: 'Esta conta não tem permissões de administração.',
        });
        return;
      }
      const saved = getToken();
      if (!saved) {
        toast({ title: 'Erro interno', description: 'Sessão não persistida.' });
        return;
      }
      setRole(user.role);
      await beginTwoFactor(saved);
    } catch {
      toast({ title: 'Erro de ligação' });
    } finally {
      setLogging(false);
    }
  }

  async function handleCodeLogin(event: React.FormEvent) {
    event.preventDefault();
    setLogging(true);
    setHint(null);
    try {
      const endpoint =
        mode === 'invite' ? '/api/admin/invites/accept' : '/api/admin/daily-code/verify';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: accessCode }),
      });
      const data = (await res.json()) as CodeLoginResponse;

      if (res.status === 202 && data.pending) {
        // Código diário gerado e enviado por email agora
        setHint(
          data.delivered === false
            ? data.message ?? 'Email indisponível — código mostrado.'
            : 'Código diário enviado para o teu email. Introduz-o aqui para continuar.'
        );
        if (data.code) setAccessCode(data.code);
        toast({ title: 'Código enviado', description: data.message });
        return;
      }
      if (!res.ok || !data.ok || !data.token || !data.user) {
        toast({
          title: mode === 'invite' ? 'Convite recusado' : 'Código recusado',
          description: data.error ?? 'Verifica os dados e tenta novamente.',
        });
        return;
      }

      // Carrega o utilizador completo (mesma forma do login por senha)
      const meRes = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      if (!meRes.ok) {
        toast({ title: 'Erro interno', description: 'Sessão criada mas incompleta — tenta entrar de novo.' });
        return;
      }
      const meData = (await meRes.json()) as { user?: AuthUser };
      if (!meData.user) {
        toast({ title: 'Erro interno', description: 'Sessão criada mas incompleta — tenta entrar de novo.' });
        return;
      }
      applySession(data.token, meData.user);
      setRole(meData.user.role as 'admin' | 'admin_limitado');
      toast({
        title: mode === 'invite' ? 'Conta criada' : 'Código validado',
        description: data.message,
      });
      await beginTwoFactor(data.token);
    } catch {
      toast({ title: 'Erro de ligação' });
    } finally {
      setLogging(false);
    }
  }

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    setVerifying(true);
    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Código recusado', description: data.error });
        return;
      }
      toast({ title: data.message ?? 'Sessão admin ativa' });
      await checkSession();
    } catch {
      toast({ title: 'Erro de ligação' });
    } finally {
      setVerifying(false);
    }
  }

  /* ── Verificar sessão ── */
  if (checking) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-slate-950 text-slate-400">
        <Loader2 className="mr-3 h-5 w-5 animate-spin text-blue-300" />
        <span className="text-sm">A verificar sessão…</span>
      </div>
    );
  }

  /* ── Autenticado → painel ── */
  if (authenticated) {
    return <>{children({ role })}</>;
  }

  /* ── Gate: identidade + 2FA ── */
  return (
    <div className="flex min-h-[80vh] items-center justify-center bg-slate-950 px-4 py-16">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600/15">
              <ShieldCheck className="h-6 w-6 text-emerald-400" />
            </span>
            <div>
              <h1 className="text-lg font-bold text-white">{title}</h1>
              <p className="text-xs text-slate-400">Área protegida — 2FA obrigatório</p>
            </div>
          </div>

          {!token ? (
            authMode === 'password' ? (
              /* ── Admin Total: email + palavra-passe ── */
              <form onSubmit={handlePasswordLogin} className="mt-6 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="admin-email" className="text-slate-300">Email de administrador</Label>
                  <Input
                    id="admin-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                    placeholder="o teu email de administração"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="admin-pass" className="text-slate-300">Palavra-passe</Label>
                  <Input
                    id="admin-pass"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 border-slate-700 bg-slate-800 text-white"
                    required
                  />
                </div>
                <Button
                  type="submit"
                  disabled={logging}
                  className="h-12 w-full bg-blue-600 font-semibold text-white hover:bg-blue-700"
                >
                  {logging ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
                  Entrar
                </Button>
              </form>
            ) : (
              /* ── Admin Limitado: código diário OU convite ── */
              <div className="mt-6">
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-800 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('daily');
                      setHint(null);
                    }}
                    className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                      mode === 'daily' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    <CalendarClock className="h-4 w-4" /> Acesso diário
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('invite');
                      setHint(null);
                    }}
                    className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                      mode === 'invite' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    <Gift className="h-4 w-4" /> Primeiro acesso
                  </button>
                </div>

                <form onSubmit={handleCodeLogin} className="mt-5 space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="lim-email" className="text-slate-300">O teu email</Label>
                    <Input
                      id="lim-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-11 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                      placeholder="email convidado pela administração"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lim-code" className="text-slate-300">
                      {mode === 'daily' ? 'Código diário (6 dígitos)' : 'Código de convite (8 caracteres)'}
                    </Label>
                    <Input
                      id="lim-code"
                      value={accessCode}
                      onChange={(e) =>
                        setAccessCode(
                          mode === 'daily'
                            ? e.target.value.replace(/\D/g, '').slice(0, 6)
                            : e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
                        )
                      }
                      className="h-12 border-slate-700 bg-slate-800 text-center text-xl font-bold tracking-[0.4em] text-white"
                      placeholder={mode === 'daily' ? '000000' : 'XXXXXXXX'}
                      required
                    />
                    <p className="text-[11px] leading-relaxed text-slate-500">
                      {mode === 'daily'
                        ? 'Enviado para este email hoje — muda a cada 24 h e só serve uma vez.'
                        : 'Recebido por email quando o administrador te convidou (vale 24 h).'}
                    </p>
                  </div>
                  {hint && (
                    <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
                      {hint}
                    </p>
                  )}
                  <Button
                    type="submit"
                    disabled={logging}
                    className="h-12 w-full bg-blue-600 font-semibold text-white hover:bg-blue-700"
                  >
                    {logging ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
                    {mode === 'invite' ? 'Ativar conta com o convite' : 'Validar código diário'}
                  </Button>
                </form>
              </div>
            )
          ) : (
            <form onSubmit={handleVerify} className="mt-6 space-y-4">
              {qrData ? (
                <div className="rounded-xl border border-blue-500/30 bg-blue-600/10 p-4 text-center">
                  <p className="text-xs font-semibold text-blue-300">
                    Primeira ativação do 2FA — lê este QR na tua app autenticadora
                    (Google Authenticator, Aegis, Authy…) e depois introduz o código.
                  </p>
                  <img src={qrData} alt="QR Code 2FA" className="mx-auto mt-3 rounded-lg bg-white p-2" width={200} height={200} />
                  {otpauthUrl && (
                    <p className="mt-2 break-all text-[10px] text-slate-500">{otpauthUrl}</p>
                  )}
                </div>
              ) : (
                <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
                  Introduz o código de 6 dígitos da tua app autenticadora (TOTP).
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="admin-2fa" className="text-slate-300">Código TOTP</Label>
                <div className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-slate-500" />
                  <Input
                    id="admin-2fa"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    className="h-12 border-slate-700 bg-slate-800 text-center text-2xl font-bold tracking-[0.5em] text-white"
                    placeholder="000000"
                    required
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={verifying || code.length !== 6}
                className="h-12 w-full bg-blue-600 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {verifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Validar código e entrar
              </Button>
            </form>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-slate-600">
          AngoStart — painel oculto (não indexado). <Link href="/" className="underline hover:text-slate-400">Voltar ao site</Link>
        </p>
      </div>
    </div>
  );
}
