'use client';

/**
 * AngoStart — Redefinir senha (Fase 5).
 * Consome o token do email (1 h, uso único) e define a nova senha.
 */

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';

function RedefinirForm() {
  const { toast } = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const { applySession } = useAuth();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const validation =
    password.length === 0
      ? null
      : password.length < 8
        ? 'A senha deve ter pelo menos 8 caracteres.'
        : !/[a-zA-Z]/.test(password) || !/\d/.test(password)
          ? 'Mistura letras e números para uma senha mais forte.'
          : null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!token) {
      toast({ title: 'Link inválido', description: 'Falta o token de recuperação.' });
      return;
    }
    if (validation) {
      toast({ title: 'Senha fraca', description: validation });
      return;
    }
    if (password !== confirm) {
      toast({ title: 'As senhas não coincidem' });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json()) as { ok?: boolean; token?: string; error?: string };
      if (!res.ok || !data.ok || !data.token) {
        toast({ title: 'Não foi possível redefinir', description: data.error });
        return;
      }
      // Sessão imediata com a nova senha
      const meRes = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      if (meRes.ok) {
        const me = (await meRes.json()) as { user: Parameters<typeof applySession>[1] };
        applySession(data.token, me.user);
      }
      toast({ title: 'Senha redefinida!', description: 'Já estás a navegar com a nova senha.' });
      router.push('/perfil');
    } finally {
      setSaving(false);
    }
  }

  if (!token) {
    return (
      <div className="text-center">
        <h1 className="text-xl font-bold text-slate-900">Link inválido</h1>
        <p className="mt-2 text-sm text-slate-500">
          Este link de recuperação não tem token. Pede um novo em{' '}
          <Link href="/recuperar-senha" className="font-semibold text-emerald-600 hover:underline">
            Recuperar senha
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-500/30">
          <LockKeyhole className="h-6 w-6 text-white" />
        </span>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Nova senha</h1>
        <p className="mt-2 text-sm text-slate-500">
          Define uma senha forte — pelo menos 8 caracteres, com letras e números.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="new-password">Nova senha</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11"
            required
          />
          {validation && <p className="text-xs text-amber-600">{validation}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirmar nova senha</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="h-11"
            required
          />
          {confirm.length > 0 && confirm !== password && (
            <p className="text-xs text-red-500">As senhas não coincidem.</p>
          )}
        </div>
        <Button
          type="submit"
          disabled={saving || !!validation || password !== confirm}
          className="h-11 w-full bg-emerald-500 hover:bg-emerald-600"
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> A guardar…
            </>
          ) : (
            'Guardar nova senha'
          )}
        </Button>
      </form>
    </>
  );
}

export default function RedefinirSenhaPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <Suspense
          fallback={
            <p className="flex items-center justify-center text-sm text-slate-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> A carregar…
            </p>
          }
        >
          <RedefinirForm />
        </Suspense>
      </div>
    </div>
  );
}
