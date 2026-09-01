'use client';

/**
 * AngoStart — Editor de Estabelecimento (Fase 16) no dashboard.
 *
 * Permite ao vendedor publicar o seu espaço (loja, hotel, empresa…) com:
 *  - nome, categoria, descrição, morada e horário;
 *  - localização FIXA no mapa (como Google Business);
 *  - logo + galeria de fotos (upload CLIENT-SIDE via Vercel Blob);
 *  - ligado/desligado.
 *
 * A página pública (mini-loja) mostra o estabelecimento + os produtos/
 * serviços à venda do responsável.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  Camera,
  ExternalLink,
  Loader2,
  MapPin,
  Plus,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth, authHeaders } from '@/context/AuthContext';
import ServiceMap from '@/components/ServiceMap';
import { uploadFileSmart, safeFileName } from '@/lib/upload-client';
import { BUSINESS_CATEGORIES, type BusinessProfile } from '@/lib/business';

export default function BusinessProfileCard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const fotoInputRef = useRef<HTMLInputElement>(null);

  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('loja');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [horario, setHorario] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [fotos, setFotos] = useState<string[]>([]);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [active, setActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingFoto, setUploadingFoto] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/estabelecimentos?meu=1', {
        headers: authHeaders(),
        cache: 'no-store',
      });
      const data = (await res.json()) as { business?: BusinessProfile | null };
      if (res.ok && data.business) {
        const b = data.business;
        setBusiness(b);
        setName(b.name);
        setCategory(b.category);
        setDescription(b.description ?? '');
        setAddress(b.address ?? '');
        setHorario(b.horario ?? '');
        setLogoUrl(b.logo_url);
        setFotos(Array.isArray(b.fotos) ? b.fotos : []);
        setLat(b.latitude);
        setLng(b.longitude);
        setActive(b.active);
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

  async function uploadLogo(file: File) {
    if (!user?.id) return;
    setUploadingLogo(true);
    const result = await uploadFileSmart({
      file,
      pathname: `produtos/${user.id}/${safeFileName(file.name, 'logo-estabelecimento.jpg')}`,
      handleUploadUrl: '/api/upload/image',
      maxBytes: 5 * 1024 * 1024,
      allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
      acceptExtensions: ['jpg', 'jpeg', 'png', 'webp'],
      makeUrl: (pathname) => `/api/media/${pathname}`,
    });
    setUploadingLogo(false);
    if (!result.ok) {
      toast({ title: 'Upload falhou', description: result.error, variant: 'destructive' });
      return;
    }
    setLogoUrl(result.url);
    toast({ title: 'Logo carregado ✓' });
  }

  async function uploadFoto(file: File) {
    if (!user?.id) return;
    if (fotos.length >= 6) {
      toast({ title: 'Galeria cheia', description: 'Máximo de 6 fotos — remove uma antes de adicionar outra.' });
      return;
    }
    setUploadingFoto(true);
    const result = await uploadFileSmart({
      file,
      pathname: `produtos/${user.id}/${safeFileName(file.name, 'foto-estabelecimento.jpg')}`,
      handleUploadUrl: '/api/upload/image',
      maxBytes: 5 * 1024 * 1024,
      allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
      acceptExtensions: ['jpg', 'jpeg', 'png', 'webp'],
      makeUrl: (pathname) => `/api/media/${pathname}`,
    });
    setUploadingFoto(false);
    if (!result.ok) {
      toast({ title: 'Upload falhou', description: result.error, variant: 'destructive' });
      return;
    }
    setFotos((prev) => [...prev, result.url]);
    toast({ title: 'Foto adicionada ✓' });
  }

  async function save() {
    if (name.trim().length < 3) {
      toast({ title: 'Nome muito curto', description: 'Pelo menos 3 caracteres.' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/estabelecimentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          name: name.trim(),
          category,
          description: description.trim() || null,
          address: address.trim() || null,
          latitude: lat,
          longitude: lng,
          horario: horario.trim() || null,
          logo_url: logoUrl,
          fotos,
          active,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; business?: BusinessProfile; error?: string };
      if (res.ok && data.ok) {
        setBusiness(data.business ?? null);
        toast({
          title: business ? 'Estabelecimento atualizado ✓' : 'Estabelecimento publicado! 🎉',
          description: 'Já está visível no diretório público.',
        });
        load();
      } else {
        toast({ title: 'Não foi possível guardar', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Sem ligação', description: 'Tenta novamente.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5">
        <p className="text-sm text-slate-400">A carregar estabelecimento…</p>
      </div>
    );
  }

  return (
    <section
      aria-label="Estabelecimento"
      className="mt-8 rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
          <Building2 className="h-5 w-5 text-teal-400" /> O Meu Estabelecimento
        </h2>
        {business && (
          <Link
            href={`/estabelecimentos/${business.id}`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-300 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Ver página pública
          </Link>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Publica o teu espaço (loja, hotel, oficina…) com localização fixa no mapa — os
        clientes encontram-no no diretório e compram os teus serviços.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Coluna esquerda: dados */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="biz-nome" className="text-slate-300">Nome do estabelecimento</Label>
            <Input
              id="biz-nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Salão Beleza Luanda"
              maxLength={120}
              className="border-white/10 bg-slate-900/60 text-slate-100 placeholder:text-slate-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300">Categoria</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger aria-label="Categoria do estabelecimento" className="border-white/10 bg-slate-900/60 text-slate-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUSINESS_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="biz-horario" className="text-slate-300">Horário</Label>
              <Input
                id="biz-horario"
                value={horario}
                onChange={(e) => setHorario(e.target.value)}
                placeholder="Seg–Sáb 08:00–18:00"
                maxLength={200}
                className="border-white/10 bg-slate-900/60 text-slate-100 placeholder:text-slate-500"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="biz-morada" className="text-slate-300">Morada</Label>
            <Input
              id="biz-morada"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Rua, bairro, município"
              maxLength={200}
              className="border-white/10 bg-slate-900/60 text-slate-100 placeholder:text-slate-500"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="biz-desc" className="text-slate-300">Descrição</Label>
            <Textarea
              id="biz-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="O que o teu espaço oferece…"
              rows={3}
              maxLength={2000}
              className="border-white/10 bg-slate-900/60 text-slate-100 placeholder:text-slate-500"
            />
          </div>

          {/* Logo + galeria */}
          <div className="space-y-2">
            <Label className="text-slate-300">Logo e galeria (máx. 6 fotos)</Label>
            <div className="flex flex-wrap items-center gap-3">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="h-14 w-14 rounded-xl border border-white/10 object-cover" />
              ) : (
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="flex h-14 w-14 items-center justify-center rounded-xl border border-dashed border-slate-600 text-slate-500 hover:border-teal-500 hover:text-teal-400"
                  aria-label="Enviar logo"
                >
                  {uploadingLogo ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
                </button>
              )}
              <label
                htmlFor="biz-foto-upload"
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-teal-600/20 px-3 text-xs font-semibold text-teal-300 ring-1 ring-teal-500/40 hover:bg-teal-600/30"
              >
                {uploadingFoto ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Adicionar foto
              </label>
              <input
                ref={fotoInputRef}
                id="biz-foto-upload"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadFoto(f);
                  e.target.value = '';
                }}
              />
              {logoUrl ? (
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="text-xs font-semibold text-slate-400 hover:text-slate-200"
                >
                  Trocar logo
                </button>
              ) : null}
              <input
                ref={logoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadLogo(f);
                  e.target.value = '';
                }}
              />
            </div>
            {fotos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {fotos.map((f, i) => (
                  <div key={f} className="relative">
                    <img src={f} alt={`Foto ${i + 1}`} className="h-16 w-16 rounded-lg border border-white/10 object-cover" />
                    <button
                      type="button"
                      onClick={() => setFotos((prev) => prev.filter((x) => x !== f))}
                      aria-label={`Remover foto ${i + 1}`}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-white shadow"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ativo */}
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-900/40 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-200">Estabelecimento visível</p>
              <p className="text-xs text-slate-400">Desliga para esconder do diretório sem apagar.</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} aria-label="Estabelecimento visível" />
          </div>
        </div>

        {/* Coluna direita: mapa fixo */}
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5 text-slate-300">
            <MapPin className="h-4 w-4 text-orange-400" /> Localização fixa (clica no mapa)
          </Label>
          <ServiceMap
            providerLat={lat ?? undefined}
            providerLng={lng ?? undefined}
            cidade={user?.cidade ?? undefined}
            editable
            pickedLat={lat ?? undefined}
            pickedLng={lng ?? undefined}
            onPick={(pickedLat, pickedLng) => {
              setLat(pickedLat);
              setLng(pickedLng);
            }}
            height={300}
          />
          <p className="text-[11px] text-slate-400">
            É a localização PÚBLICA do espaço comercial (como no Google Maps) — não é a
            tua localização pessoal.
          </p>
        </div>
      </div>

      <div className="mt-5">
        <Button
          onClick={save}
          disabled={saving}
          className="h-11 w-full bg-gradient-to-r from-blue-600 to-purple-600 font-semibold text-white hover:from-blue-700 hover:to-purple-700 sm:w-auto sm:px-8"
        >
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Building2 className="mr-2 h-4 w-4" />}
          {business ? 'Guardar alterações' : 'Publicar estabelecimento'}
        </Button>
      </div>
    </section>
  );
}
