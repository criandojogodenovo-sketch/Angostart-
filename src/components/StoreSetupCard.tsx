'use client';

/**
 * AngoStart — Cartão «Criar a minha loja» (Fase 17).
 *
 * Passo opcional mostrado logo APÓS o registo de vendedor (e reutilizável
 * no dashboard): a loja já foi criada automaticamente com o nome da conta
 * (POST /api/auth/register/vendedor → getOrCreateStoreForUser) — aqui o
 * vendedor personalize-a em 30 segundos: nome, descrição e logo (upload
 * opcional para o Vercel Blob via /api/upload/image + PATCH /api/stores).
 *
 * Não altera lógica de negócio: usa apenas GET ?minha=1 (garante a loja)
 * e PATCH /api/stores (edição) — os mesmos endpoints do StoreEditorCard.
 */

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Rocket, Store as StoreIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { authHeaders, type AuthUser } from '@/context/AuthContext';
import { uploadFileSmart, safeFileName } from '@/lib/upload-client';

interface StoreRow {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
}

export default function StoreSetupCard({
  user,
  onDone,
}: {
  user: AuthUser;
  /** Chamado ao terminar (skip ou guardar) — o fluxo continua. */
  onDone: () => void;
}) {
  const { toast } = useToast();
  const logoRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  /* A loja é criada automaticamente no registo; o GET ?minha=1 devolve-a
     (e cria-a se por alguma razão ainda não existir). Prefill do form. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/stores?minha=1', {
          headers: authHeaders(),
          cache: 'no-store',
        });
        const data = (await res.json()) as { store?: StoreRow; error?: string };
        if (cancelled) return;
        if (res.ok && data.store) {
          setName(data.store.name ?? '');
          setDescription(data.store.description ?? '');
          setLogoUrl(data.store.logo_url ?? null);
        }
      } catch {
        /* rede — o form fica editável na mesma; o PATCH cria/garante depois */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function pickLogo(file: File) {
    setUploadingLogo(true);
    try {
      const result = await uploadFileSmart({
        file,
        pathname: `produtos/${user.id}/${safeFileName(file.name, 'logo.jpg')}`,
        handleUploadUrl: '/api/upload/image',
        maxBytes: 5 * 1024 * 1024,
        allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
        acceptExtensions: ['jpg', 'jpeg', 'png', 'webp'],
        makeUrl: (pathname) => `/api/media/${pathname}`,
      });
      if (!result.ok) {
        toast({
          title: result.kind === 'too-large' ? 'Imagem demasiado grande' : 'Upload falhou',
          description: result.error,
          variant: 'destructive',
        });
        return;
      }
      setLogoUrl(result.url);
      toast({ title: 'Logo carregado ✓', description: 'Não te esqueças de guardar.' });
    } finally {
      setUploadingLogo(false);
    }
  }

  async function save() {
    if (saving) return;
    if (name.trim() && name.trim().length < 3) {
      toast({
        title: 'Nome muito curto',
        description: 'O nome da loja deve ter pelo menos 3 letras.',
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/stores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          logo_url: logoUrl ?? '',
          /* PATCH /api/stores exige ambas as chaves de imagem (undefined
             é rejeitado com 400) — banner fica vazio neste passo. */
          banner_url: '',
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível guardar', description: data.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Loja pronta! 🎉', description: 'A tua página pública já está configurada.' });
      onDone();
    } catch {
      toast({ title: 'Sem ligação', description: 'Tenta novamente em instantes.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-lg shadow-blue-500/30">
          <StoreIcon className="h-7 w-7" />
        </span>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">A tua loja já existe!</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
          Dá-lhe um nome, uma descrição e um logo — os clientes confiam mais em
          lojas completas. Podes também fazer isto mais tarde no painel.
        </p>
      </div>

      {loading ? (
        <div className="mt-8 flex items-center justify-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> A preparar a tua loja…
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="loja-nome">Nome da loja</Label>
            <Input
              id="loja-nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Doces da Kianda"
              maxLength={80}
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="loja-descricao">Descrição (opcional)</Label>
            <textarea
              id="loja-descricao"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="O que vendes? O que torna a tua loja especial?"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <p className="text-right text-xs text-slate-400">{description.length}/500</p>
          </div>

          <div className="space-y-2">
            <Label>Logo da loja (opcional)</Label>
            <div className="flex items-center gap-3">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Logo da loja"
                  className="h-14 w-14 rounded-xl border border-slate-200 object-cover"
                />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-slate-400">
                  <StoreIcon className="h-6 w-6" />
                </span>
              )}
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploadingLogo}
                  onClick={() => logoRef.current?.click()}
                  className="gap-1.5"
                >
                  {uploadingLogo ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ImagePlus className="h-4 w-4" />
                  )}
                  {logoUrl ? 'Trocar logo' : 'Carregar logo'}
                </Button>
                <p className="text-xs text-slate-500">JPG, PNG ou WebP — máx. 5 MB.</p>
              </div>
            </div>
            <input
              ref={logoRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={uploadingLogo}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pickLogo(f);
                e.target.value = '';
              }}
            />
          </div>

          <div className="flex flex-col gap-2 pt-2 sm:flex-row">
            <Button
              onClick={save}
              disabled={saving}
              className="h-11 flex-1 bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
              Guardar e continuar
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onDone}
              disabled={saving}
              className="h-11 border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Agora não
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
