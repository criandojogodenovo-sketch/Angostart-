'use client';

/**
 * AngoStart — Cartões de segurança do perfil (Fase 9).
 *
 * 1. MustChangePassword — utilizadores antigos (flag da migração) têm de
 *    trocar a senha para uma forte antes de continuar a comprar/vender.
 * 2. BiVerificationCard — vendedores submetem a FOTO do BI (Vercel Blob);
 *    o admin aprova em /admin → Verificação de Identidade. Sem aprovação,
 *    a publicação de novos produtos fica bloqueada.
 */

import { useRef, useState } from 'react';
import { ShieldAlert, BadgeCheck, Clock, XCircle, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { authHeaders, type AuthUser } from '@/context/AuthContext';
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

/* ─────────────── Verificação de identidade (BI + foto) ─────────────── */

interface KycState {
  bi_number: string | null;
  tem_bi: boolean;
  tem_foto: boolean;
  bi_document_url: string | null;
  kyc_status: string;
  is_verified_bi: boolean;
}

export function BiVerificationCard({
  user,
  onUpdated,
}: {
  user: AuthUser;
  /** Atualiza o utilizador no contexto após submissão bem-sucedida. */
  onUpdated: (patch: Partial<AuthUser>) => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [biNumber, setBiNumber] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [kyc, setKyc] = useState<Partial<KycState>>({
    kyc_status: user.kyc_status ?? 'none',
    is_verified_bi: user.is_verified_bi ?? false,
  });

  async function loadKyc() {
    try {
      const res = await fetch('/api/perfil/kyc', { headers: authHeaders(), cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as KycState;
        setKyc(data);
        setPhotoUrl(data.tem_foto ? data.bi_document_url : null);
        onUpdated({
          kyc_status: data.kyc_status,
          is_verified_bi: data.is_verified_bi,
        });
      }
    } catch {
      /* silencioso */
    }
  }

  async function pickPhoto(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload/image', {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        toast({ title: 'Upload falhou', description: data.error ?? 'Tenta outra imagem.', variant: 'destructive' });
        return;
      }
      setPhotoUrl(data.url);
    } catch {
      toast({ title: 'Erro de rede no upload', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/perfil/kyc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          bi_number: biNumber.trim(),
          bi_document_url: photoUrl ?? undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível guardar', description: data.error, variant: 'destructive' });
        return;
      }
      toast({
        title: 'Documento enviado!',
        description: 'A equipa AngoStart vai validar o teu BI — avisamos-te aqui no perfil.',
      });
      setBiNumber('');
      await loadKyc();
    } catch {
      toast({ title: 'Erro de rede', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  /* Estados: verificado ✓ · pendente ⏳ · recusado ✗ · sem documento */
  const verified = kyc.is_verified_bi === true || kyc.kyc_status === 'verified';
  const rejected = kyc.kyc_status === 'rejected';
  const pending = !verified && !rejected && (kyc.kyc_status === 'pending' || kyc.tem_bi === true);
  const podeEditar = rejected || (!verified && !pending);

  return (
    <div className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
        <BadgeCheck className="h-5 w-5 text-sky-500" /> Verificação de identidade
      </h2>

      {verified ? (
        <p className="mt-2 flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2.5 text-sm font-semibold text-sky-700">
          <BadgeCheck className="h-4 w-4" /> Identidade verificada — tens o selo azul e podes publicar!
        </p>
      ) : rejected ? (
        <p className="mt-2 flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-700">
          <XCircle className="h-4 w-4" /> O BI anterior foi recusado — reenvia o documento abaixo.
        </p>
      ) : pending ? (
        <p className="mt-2 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-700">
          <Clock className="h-4 w-4" /> BI {kyc.bi_number ?? ''} em análise pela equipa — a publicação de
          novos produtos desbloqueia após a aprovação.
        </p>
      ) : (
        <p className="mt-2 text-sm text-slate-500">
          Submete o teu BI para receber o selo azul de vendedor verificado — é
          obrigatório para publicar novos produtos.
        </p>
      )}

      {!verified && podeEditar && (
        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="kyc-bi-number">N.º do Bilhete de Identidade</Label>
            <Input
              id="kyc-bi-number"
              type="text"
              placeholder="Ex.: 004587896LA038"
              value={biNumber}
              onChange={(e) => setBiNumber(e.target.value.toUpperCase())}
              className="h-10"
            />
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickPhoto(f);
              e.target.value = '';
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="gap-2"
            >
              <Upload className="h-4 w-4" />
              {uploading ? 'A carregar…' : photoUrl ? 'Trocar foto do BI' : 'Foto do BI (frente)'}
            </Button>
            {photoUrl && (
               
              <img src={photoUrl} alt="BI" className="h-12 w-16 rounded-lg border border-slate-200 object-cover" />
            )}
          </div>

          <Button
            type="button"
            onClick={save}
            disabled={saving || uploading || biNumber.trim().length < 8}
            className="h-10 w-full bg-emerald-500 font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
          >
            {saving ? 'A enviar…' : 'Enviar para verificação'}
          </Button>
          <p className="text-xs text-slate-400">
            A foto é guardada em segurança e só é vista pela equipa de verificação AngoStart.
          </p>
        </div>
      )}
    </div>
  );
}
