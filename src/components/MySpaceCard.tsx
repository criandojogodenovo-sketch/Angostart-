'use client';

/**
 * AngoStart — Cartão «O meu Espaço» (perfil do vendedor/prestador).
 *
 * Um único ponto de gestão do espaço público a partir de /perfil:
 *  - Prestadores de serviços (domicílio/remoto) → ESTABELECIMENTO
 *    (loja física, escritório, salão… com endereço) — «Criar o meu Espaço».
 *  - Criadores de infoprodutos → LOJA virtual — «A minha Loja».
 *
 * Comportamento (spec Fase 18):
 *  - Sem espaço → botão «Criar a minha loja/escritório» abre o formulário.
 *  - Com espaço → mostra nome, descrição, logo e endereço + «Editar Espaço».
 *  - Formulário: nome (obrigatório), descrição, logo (upload), endereço
 *    e horário (para estabelecimentos).
 *  - Ao guardar → redireciona para a página pública (/estabelecimentos/[id]
 *    ou /loja/[slug]).
 *
 * Backend: GET/POST /api/estabelecimentos (upsert por utilizador) e
 * GET ?minha=1 + PATCH /api/stores (garante + edita a loja). Não altera
 * a lógica existente — o editor completo continua no dashboard.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowUpRight,
  Building2,
  Clock,
  ImagePlus,
  Loader2,
  MapPin,
  Pencil,
  PlusCircle,
  Store as StoreIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { authHeaders, type AuthUser } from '@/context/AuthContext';
import { uploadFileSmart, safeFileName } from '@/lib/upload-client';
import { BUSINESS_CATEGORIES, businessCategoryLabel, type BusinessProfile } from '@/lib/business';

interface StoreRow {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
}

export default function MySpaceCard({ user }: { user: AuthUser }) {
  const { toast } = useToast();
  const router = useRouter();
  const logoRef = useRef<HTMLInputElement>(null);

  const isPrestador = user.role === 'prestador_domicilio' || user.role === 'prestador_remoto';
  /* Prestadores gerem o ESTABELECIMENTO como espaço principal;
     criadores gerem a LOJA virtual. */
  const primaryIsEspaco = isPrestador;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [editing, setEditing] = useState(false);

  const [store, setStore] = useState<StoreRow | null>(null);
  const [business, setBusiness] = useState<BusinessProfile | null>(null);

  /* Campos do formulário (partilhados pelos dois tipos de espaço) */
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [category, setCategory] = useState('outro');
  const [address, setAddress] = useState('');
  const [horario, setHorario] = useState('');

  const load = useCallback(async () => {
    try {
      const [storeRes, bizRes] = await Promise.all([
        fetch('/api/stores?minha=1', { headers: authHeaders(), cache: 'no-store' }),
        fetch('/api/estabelecimentos?meu=1', { headers: authHeaders(), cache: 'no-store' }),
      ]);
      if (storeRes.ok) {
        const data = (await storeRes.json()) as { store?: StoreRow | null };
        setStore(data.store ?? null);
      }
      if (bizRes.ok) {
        const data = (await bizRes.json()) as { business?: BusinessProfile | null };
        setBusiness(data.business ?? null);
      }
    } catch {
      /* rede — o cartão mostra o estado vazio e permite criar na mesma */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Preenche o formulário com o espaço a editar. */
  function openForm() {
    if (primaryIsEspaco && business) {
      setName(business.name ?? '');
      setDescription(business.description ?? '');
      setLogoUrl(business.logo_url ?? null);
      setCategory(business.category ?? 'outro');
      setAddress(business.address ?? '');
      setHorario(business.horario ?? '');
    } else if (!primaryIsEspaco && store) {
      setName(store.name ?? '');
      setDescription(store.description ?? '');
      setLogoUrl(store.logo_url ?? null);
    } else {
      setName('');
      setDescription('');
      setLogoUrl(null);
      setCategory('outro');
      setAddress('');
      setHorario('');
    }
    setEditing(true);
  }

  async function pickLogo(file: File) {
    setUploadingLogo(true);
    try {
      const result = await uploadFileSmart({
        file,
        pathname: `produtos/${user.id}/${safeFileName(file.name, 'espaco.jpg')}`,
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
      toast({ title: 'Imagem carregada ✓', description: 'Não te esqueças de guardar.' });
    } finally {
      setUploadingLogo(false);
    }
  }

  /** Guarda o ESTABELECIMENTO (prestadores) — upsert por utilizador. */
  async function saveEspaco() {
    if (saving) return;
    if (name.trim().length < 3) {
      toast({
        title: 'Nome obrigatório',
        description: 'O nome do espaço deve ter pelo menos 3 letras.',
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    try {
      /* Preserva campos avançados geridos no dashboard (mapa, fotos) —
         o POST é upsert completo, por isso reenviamos o que já existia. */
      const res = await fetch('/api/estabelecimentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          name: name.trim(),
          category,
          description: description.trim(),
          address: address.trim(),
          horario: horario.trim(),
          logo_url: logoUrl ?? '',
          latitude: business?.latitude ?? null,
          longitude: business?.longitude ?? null,
          fotos: Array.isArray(business?.fotos) ? business.fotos : [],
          active: business?.active ?? true,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; business?: BusinessProfile; error?: string };
      if (!res.ok || !data.ok || !data.business) {
        toast({ title: 'Não foi possível guardar', description: data.error, variant: 'destructive' });
        return;
      }
      toast({
        title: 'Espaço guardado! 🎉',
        description: 'Já podes partilhar a página pública do teu espaço.',
      });
      setEditing(false);
      setBusiness(data.business);
      /* push + refresh: garante dados frescos mesmo se a página pública
         já tiver sido visitada nesta sessão (Router Cache do Next). */
      router.push(`/estabelecimentos/${data.business.id}`);
      router.refresh();
    } catch {
      toast({ title: 'Sem ligação', description: 'Tenta novamente em instantes.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  /** Guarda a LOJA virtual (criadores) — PATCH garante/cria e devolve o slug. */
  async function saveLoja() {
    if (saving) return;
    if (name.trim().length < 3) {
      toast({
        title: 'Nome obrigatório',
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
          /* PATCH exige ambas as chaves de imagem — banner fica como está. */
          banner_url: '',
        }),
      });
      const data = (await res.json()) as { ok?: boolean; store?: StoreRow; error?: string };
      if (!res.ok || !data.ok || !data.store) {
        toast({ title: 'Não foi possível guardar', description: data.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Loja guardada! 🎉', description: 'A tua página pública está atualizada.' });
      setEditing(false);
      setStore(data.store);
      router.push(`/loja/${data.store.slug}`);
      router.refresh();
    } catch {
      toast({ title: 'Sem ligação', description: 'Tenta novamente em instantes.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  /* ── Dados do espaço principal deste perfil ── */
  const hasEspaco = primaryIsEspaco ? !!business : !!store;
  const primaryName = primaryIsEspaco ? business?.name : store?.name;
  const primaryLogo = primaryIsEspaco ? business?.logo_url : store?.logo_url;
  const primaryHref = primaryIsEspaco
    ? business
      ? `/estabelecimentos/${business.id}`
      : null
    : store
      ? `/loja/${store.slug}`
      : null;
  const title = primaryIsEspaco ? 'O meu Espaço' : 'A minha Loja';
  const createLabel = primaryIsEspaco ? 'Criar o meu Espaço' : 'Criar a minha loja';
  const editLabel = primaryIsEspaco ? 'Editar Espaço' : 'Editar Loja';

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      {/* Cabeçalho do cartão */}
      <div className="flex items-start gap-4 border-b border-slate-100 bg-gradient-to-r from-blue-50 via-white to-purple-50 px-6 py-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 text-white shadow-md shadow-blue-600/25">
          {primaryIsEspaco ? <Building2 className="h-5 w-5" /> : <StoreIcon className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {primaryIsEspaco
              ? 'O teu espaço público na AngoStart — loja, escritório ou ponto de atendimento.'
              : 'A tua loja virtual com página pública em /loja.'}
          </p>
        </div>
        {hasEspaco && !editing && (
          <Button
            size="sm"
            variant="outline"
            onClick={openForm}
            className="shrink-0 border-blue-300 text-blue-700 hover:bg-blue-50"
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            {editLabel}
          </Button>
        )}
      </div>

      <div className="px-6 py-5">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> A carregar o teu espaço…
          </div>
        ) : editing ? (
          /* ── Formulário criar/editar ── */
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="espaco-nome">
                {primaryIsEspaco ? 'Nome do espaço' : 'Nome da loja'} *
              </Label>
              <Input
                id="espaco-nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={primaryIsEspaco ? 'Ex.: Oficina do Kilamba' : 'Ex.: Doces da Kianda'}
                maxLength={primaryIsEspaco ? 120 : 80}
                className="h-11"
              />
            </div>

            {primaryIsEspaco && (
              <div className="space-y-2">
                <Label htmlFor="espaco-categoria">Categoria</Label>
                <select
                  id="espaco-categoria"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                >
                  {BUSINESS_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="espaco-descricao">Descrição (opcional)</Label>
              <textarea
                id="espaco-descricao"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={primaryIsEspaco ? 2000 : 500}
                placeholder={
                  primaryIsEspaco
                    ? 'O que oferece o teu espaço? (serviços, especialidades…)'
                    : 'O que vendes? O que torna a tua loja especial?'
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {primaryIsEspaco && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="espaco-endereco">Endereço / localização</Label>
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-teal-600" />
                    <Input
                      id="espaco-endereco"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Ex.: Rua 21 de Janeiro, Luanda"
                      maxLength={200}
                      className="h-11 pl-9"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="espaco-horario">Horário (opcional)</Label>
                  <div className="relative">
                    <Clock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-500" />
                    <Input
                      id="espaco-horario"
                      value={horario}
                      onChange={(e) => setHorario(e.target.value)}
                      placeholder="Ex.: Seg–Sáb, 8h–18h"
                      maxLength={200}
                      className="h-11 pl-9"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Logo / imagem do espaço (opcional)</Label>
              <div className="flex items-center gap-3">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="Logo do espaço"
                    className="h-14 w-14 rounded-xl border border-slate-200 object-cover"
                  />
                ) : (
                  <span className="flex h-14 w-14 items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-slate-400">
                    {primaryIsEspaco ? <Building2 className="h-6 w-6" /> : <StoreIcon className="h-6 w-6" />}
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
                    {logoUrl ? 'Trocar imagem' : 'Carregar imagem'}
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

            <div className="flex flex-col gap-2 pt-1 sm:flex-row">
              <Button
                onClick={primaryIsEspaco ? saveEspaco : saveLoja}
                disabled={saving || uploadingLogo}
                className="h-11 flex-1 bg-gradient-to-r from-blue-600 to-purple-600 text-sm font-semibold text-white hover:from-blue-700 hover:to-purple-700"
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PlusCircle className="mr-2 h-4 w-4" />
                )}
                Guardar
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="h-11 border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : hasEspaco ? (
          /* ── Resumo do espaço existente ── */
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {primaryLogo ? (
              <img
                src={primaryLogo}
                alt={primaryName ?? 'Espaço'}
                className="h-16 w-16 shrink-0 rounded-2xl border border-slate-200 object-cover"
              />
            ) : (
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-100 to-purple-100 text-2xl font-black text-blue-700">
                {(primaryName ?? '?').charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-900">{primaryName}</p>
              {primaryIsEspaco && business?.category && (
                <p className="mt-0.5 text-xs font-semibold text-teal-700">
                  {businessCategoryLabel(business.category)}
                </p>
              )}
              {primaryIsEspaco && business?.address && (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                  <MapPin className="h-3 w-3 text-teal-600" /> {business.address}
                </p>
              )}
              {(primaryIsEspaco ? business?.description : store?.description) && (
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                  {primaryIsEspaco ? business?.description : store?.description}
                </p>
              )}
              {primaryHref && (
                <a
                  href={primaryHref}
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                >
                  Ver página pública <ArrowUpRight className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        ) : (
          /* ── Estado vazio — CTA de criação ── */
          <div className="rounded-2xl border border-dashed border-blue-300 bg-blue-50/50 p-5 text-center">
            <p className="text-sm font-semibold text-slate-700">
              {primaryIsEspaco
                ? 'Ainda não criaste o teu espaço'
                : 'A tua loja ainda não está personalizada'}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
              {primaryIsEspaco
                ? 'Cria o teu espaço (loja, escritório ou ponto de atendimento) para aparecer no diretório de Estabelecimentos com endereço no mapa.'
                : 'Dá um nome, descrição e logo à tua loja para ganhares a confiança dos clientes.'}
            </p>
            <Button
              onClick={openForm}
              className="mt-3 h-11 bg-gradient-to-r from-blue-600 to-purple-600 px-6 text-sm font-semibold text-white hover:from-blue-700 hover:to-purple-700"
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              {createLabel}
            </Button>
          </div>
        )}

        {/* Link secundário para o OUTRO tipo de espaço (sem confundir o principal) */}
        {!loading && !editing && primaryIsEspaco && store && (
          <a
            href={`/loja/${store.slug}`}
            className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2.5 text-xs text-slate-600 transition-colors hover:bg-slate-100"
          >
            <span className="flex items-center gap-1.5">
              <StoreIcon className="h-3.5 w-3.5 text-blue-600" />
              A tua loja virtual: <strong className="font-semibold">{store.name}</strong>
            </span>
            <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />
          </a>
        )}
      </div>
    </div>
  );
}
