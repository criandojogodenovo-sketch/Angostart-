'use client';

/**
 * AngoStart — Recuperar senha (Fase 5).
 * Envia um link de redefinição (1 h, uso único) para o email da conta.
 */

import { useState } from 'react';
import Link from 'next/link';
import { KeyRound, Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

export default function RecuperarSenhaPage() {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível enviar', description: data.error });
        return;
      }
      setSent(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        {sent ? (
          <div className="text-center">
            <MailCheck className="mx-auto h-12 w-12 text-emerald-500" />
            <h1 className="mt-4 text-xl font-bold text-slate-900">Verifica o teu email</h1>
            <p className="mt-2 text-sm text-slate-500">
              Se <strong>{email}</strong> existir na AngoStart, enviámos um link para
              redefinires a senha. O link expira em 1 hora.
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Não recebeste? Verifica o spam ou tenta novamente em alguns minutos.
            </p>
            <Link
              href="/perfil"
              className="mt-6 inline-block text-sm font-semibold text-emerald-600 hover:text-emerald-700"
            >
              ← Voltar ao início de sessão
            </Link>
          </div>
        ) : (
          <>
            <div className="text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-500/30">
                <KeyRound className="h-6 w-6 text-white" />
              </span>
              <h1 className="mt-4 text-2xl font-bold text-slate-900">Recuperar senha</h1>
              <p className="mt-2 text-sm text-slate-500">
                Escreve o email da tua conta e enviamos um link de redefinição.
              </p>
            </div>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="reset-email">Email</Label>
                <Input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  placeholder="ana@exemplo.ao"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11"
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={sending || email.trim().length === 0}
                className="h-11 w-full bg-emerald-500 hover:bg-emerald-600"
              >
                {sending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> A enviar…
                  </>
                ) : (
                  'Enviar link de recuperação'
                )}
              </Button>
            </form>
            <Link
              href="/perfil"
              className="mt-4 block text-center text-sm font-medium text-slate-500 hover:text-emerald-600"
            >
              ← Voltar ao início de sessão
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
