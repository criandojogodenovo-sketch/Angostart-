'use client';

/**
 * AngoStart — Editor da loja virtual no dashboard do vendedor (Fase 9).
 * Nome, descrição, logo e banner (upload → Vercel Blob via /api/upload/image).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Store, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { authHeaders } from '@/context/AuthContext';

interface StoreData {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  banner_url: string | null;
}

export default function StoreEditorCard() {
  const { toast } = useToast();
  const logoRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);
  const [store, setStore] = useState<StoreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/stores?minha=1', { headers: authHeaders(), cache: 'no-store' });
      const data = (await res.json()) as { store?: StoreData; error?: string };
      if (res.ok && data.store) {
        setStore(data.store);
        setName(data.store.name);
        setDescription(data.store.description ?? '');
        setLogoUrl(data.store.logo_url);
        setBannerUrl(data.store.banner_url);
      }
    } catch {
      /* silencioso */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function uploadImage(file: File, kind: 'logo' | 'banner') {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload/image', { method: 'POST', headers: authHeaders(), body: fd });
    const data = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !data.url) {
      toast({ title: 'Upload falhou', description: data.error ?? 'Tenta outra imagem.', variant: 'destructive' });
      return;
    }
    if (kind === 'logo') setLogoUrl(data.url!);
    else setBannerUrl(data.url!);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/stores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          name,
          description,
          logo_url: logoUrl ?? '',
          banner_url: bannerUrl ?? '',
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível guardar', description: data.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Loja atualizada!', description: 'A tua página pública já mostra as novidades.' });
      load();
    } catch {
      toast({ title: 'Erro de rede', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-400">A carregar a tua loja…</p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
          <Store className="h-5 w-5 text-blue-600" /> Minha Loja
        </h2>
        {store && (
          <Link
            href={`/loja/${store.slug}`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Ver página pública
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">
        A tua loja virtual foi criada automaticamente — personaliza-a para atrair mais clientes.
      </p>

      {store && (
        <div className="mt-4 space-y-3">
          {/* Banner atual */}
          <div
            className="h-24 w-full rounded-xl bg-gradient-to-r from-blue-600 to-teal-600"
            style={bannerUrl ? { backgroundImage: `url(${bannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
          />

          <div className="space-y-1.5">
            <Label htmlFor="store-name">Nome da loja</Label>
            <Input id="store-name" value={name} onChange={(e) => setName(e.target.value)} className="h-10" maxLength={80} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="store-desc">Descrição</Label>
            <Textarea
              id="store-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Conta aos clientes o que a tua loja oferece…"
              className="min-h-16 text-sm"
              maxLength={500}
            />
          </div>

          <input
            ref={logoRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadImage(f, 'logo');
              e.target.value = '';
            }}
          />
          <input
            ref={bannerRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadImage(f, 'banner');
              e.target.value = '';
            }}
          />

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              {logoUrl ? (
                 
                <img src={logoUrl} alt="Logo" className="h-10 w-10 rounded-lg border border-slate-200 object-cover" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-400">?</div>
              )}
              <Button type="button" variant="outline" size="sm" onClick={() => logoRef.current?.click()} className="gap-1.5">
                <Upload className="h-3.5 w-3.5" /> Logo
              </Button>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => bannerRef.current?.click()} className="gap-1.5">
              <Upload className="h-3.5 w-3.5" /> Banner
            </Button>
          </div>

          <Button
            type="button"
            onClick={save}
            disabled={saving || name.trim().length < 3}
            className="h-10 w-full bg-blue-600 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? 'A guardar…' : 'Guardar alterações'}
          </Button>
        </div>
      )}
    </div>
  );
}
