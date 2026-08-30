'use client';

/**
 * AngoStart — Cartões de segurança do perfil (Fase 9).
 *
 * MustChangePassword — utilizadores antigos (flag da migração) têm de
 * trocar a senha para uma forte antes de continuar a comprar/vender.
 *
 * (Fase 12: o cartão de verificação de identidade passou para
 * components/KycVerificationCard.tsx — KYC flexível orientado a fotos.)
 */

import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { authHeaders } from '@/context/AuthContext';
import { validatePassword, passwordStrength } from '@/lib/password';

/* ─────────── Troca de senha obrigatória (utilizadores antigos) ─────────── */

export function MustChangePasswordCard() {
  const { toast } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  const forca = passwordStrength(next);
  const valida = validatePassword(next).ok;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !valida) return;
    setBusy(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível trocar', description: data.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Palavra-passe atualizada!', description: 'Recarregamos a página…' });
      setTimeout(() => window.location.reload(), 800);
    } catch {
      toast({ title: 'Erro de rede', description: 'Tenta novamente em instantes.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 rounded-3xl border-2 border-amber-300 bg-amber-50 p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-base font-bold text-amber-900">
        <ShieldAlert className="h-5 w-5" /> Atualiza a tua palavra-passe
      </h2>
      <p className="mt-1 text-sm text-amber-800">
        Por segurança, todos os utilizadores AngoStart devem usar uma palavra-passe
        forte (mínimo 8 caracteres com maiúscula, minúscula, número e símbolo).
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="mcp-current">Palavra-passe atual</Label>
          <Input
            id="mcp-current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="h-10 bg-white"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mcp-next">Nova palavra-passe (forte)</Label>
          <Input
            id="mcp-next"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="h-10 bg-white"
            required
          />
          <div className="flex items-center gap-2">
            <div className="flex h-1.5 flex-1 gap-1">
              {[1, 2, 3].map((n) => (
                <span key={n} className={`h-full flex-1 rounded-full ${forca.score >= n ? forca.color : 'bg-slate-200'}`} />
              ))}
            </div>
            <span className="w-12 text-right text-xs font-semibold text-slate-500">
              {next ? forca.label : ''}
            </span>
          </div>
        </div>
        <Button
          type="submit"
          disabled={busy || !valida || current.length === 0}
          className="h-10 w-full bg-amber-500 font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
        >
          {busy ? 'A guardar…' : 'Guardar nova palavra-passe'}
        </Button>
      </form>
    </div>
  );
}
