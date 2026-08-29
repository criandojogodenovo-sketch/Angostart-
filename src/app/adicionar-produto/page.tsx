'use client';

/**
 * AngoStart — Publicar / editar produto ou serviço (apenas vendedores).
 *
 * - Sem sessão → convite a entrar em /perfil
 * - Cliente → aviso de que apenas vendedores publicam
 * - Vendedor → formulário com tipo (infoproduto, físico, domicílio, remoto),
 *   preço em Kz, imagem opcional e pré-visualização em tempo real.
 * - ?edit=<id> carrega o produto para edição (PUT em vez de POST).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  CircleDollarSign,
  FileUp,
  Globe,
  Home as HomeIcon,
  Image as ImageIcon,
  Loader2,
  Package,
  Rocket,
  GraduationCap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth, authHeaders } from '@/context/AuthContext';
import { formatKz } from '@/lib/format';
import type { Product, ProductType } from '@/lib/products-data';
import ProductIcon from '@/components/ProductIcon';
import ServiceMap, { centerForCity } from '@/components/ServiceMap';
import { MapPin } from 'lucide-react';

const TYPE_OPTIONS: {
  value: ProductType;
  label: string;
  hint: string;
  icon: typeof Package;
  iconName: string;
}[] = [
  {
    value: 'infoproduto',
    label: 'Infoproduto',
    hint: 'Cursos, eBooks, templates',
    icon: GraduationCap,
    iconName: 'graduation-cap',
  },
  {
    value: 'produto_fisico',
    label: 'Produto físico',
    hint: 'Artigos com entrega em Luanda',
    icon: Package,
    iconName: 'package',
  },
  {
    value: 'servico_domicilio',
    label: 'Serviço ao domicílio',
    hint: 'Limpeza, electricista, canalização…',
    icon: HomeIcon,
    iconName: 'home',
  },
  {
    value: 'servico_remoto',
    label: 'Serviço remoto',
    hint: 'Design, websites, marketing…',
    icon: Globe,
    iconName: 'globe',
  },
];

const GRADIENTS: Record<ProductType, string> = {
  infoproduto: 'from-emerald-500 to-teal-600',
  produto_fisico: 'from-blue-600 to-cyan-500',
  servico_domicilio: 'from-orange-500 to-amber-500',
  servico_remoto: 'from-violet-600 to-purple-500',
};

interface FormState {
  name: string;
  description: string;
  price: string;
  type: ProductType;
  image_url: string;
  service_lat: number | null;
  service_lng: number | null;
  file_url: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  price: '',
  type: 'infoproduto',
  image_url: '',
  service_lat: null,
  service_lng: null,
  file_url: '',
};

function AdicionarProdutoContent() {
  const { user, loading, isSeller } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [loadingProduct, setLoadingProduct] = useState(false);

  /* ── Fase 5: PDF de infoproduto + KYC opcional ── */
  const [pdfUploading, setPdfUploading] = useState(false);
  const [kycBi, setKycBi] = useState('');
  const [kycNif, setKycNif] = useState('');
  const [kycSaving, setKycSaving] = useState(false);

  // Carrega o produto em modo de edição
  const loadProduct = useCallback(async () => {
    if (!editId) return;
    setLoadingProduct(true);
    try {
      const res = await fetch(`/api/products/${editId}`);
      const data = (await res.json()) as { product?: Product; error?: string };
      if (!res.ok || !data.product) throw new Error(data.error || 'Produto não encontrado.');
      const p = data.product;
      setForm({
        name: p.name,
        description: p.description,
        price: String(p.price_kz),
        type: p.type,
        image_url: p.image_url ?? '',
        service_lat:
          (p as unknown as { service_lat?: number | null }).service_lat ?? null,
        service_lng:
          (p as unknown as { service_lng?: number | null }).service_lng ?? null,
        file_url: p.file_url ?? '',
      });
    } catch (error) {
      toast({
        title: 'Erro ao carregar produto',
        description: error instanceof Error ? error.message : 'Tenta novamente.',
      });
      router.push('/perfil');
    } finally {
      setLoadingProduct(false);
    }
  }, [editId, router, toast]);

  useEffect(() => {
    if (isSeller) loadProduct();
     
  }, [isSeller, editId]);

  /* ─────────── Estados de bloqueio ─────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-400">
        <Rocket className="mr-3 h-5 w-5 animate-pulse" />
        <span className="text-sm">A preparar a publicação…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center sm:px-6">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-lg shadow-amber-500/30">
          <CircleDollarSign className="h-7 w-7" />
        </span>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">
          Entra como vendedor para publicar
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          A publicação de produtos e serviços é exclusiva para contas de
          vendedor: criadores de infoprodutos, prestadores ao domicílio e
          freelancers remotos.
        </p>
        <Button
          asChild
          className="mt-6 h-12 bg-emerald-500 px-8 text-white hover:bg-emerald-600"
        >
          <Link href="/perfil">Entrar / criar conta de vendedor</Link>
        </Button>
      </div>
    );
  }

  if (!isSeller) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center sm:px-6">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
          <Package className="h-7 w-7" />
        </span>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">
          A tua conta é de cliente
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Para vender na AngoStart cria uma conta de vendedor — podes usar
          outro email ou gerir isso mais tarde.
        </p>
        <Button
          asChild
          variant="outline"
          className="mt-6 h-12 border-emerald-500 px-8 text-emerald-600 hover:bg-emerald-50"
        >
          <Link href="/perfil">Voltar ao perfil</Link>
        </Button>
      </div>
    );
  }

  /* ─────────── Submissão ─────────── */

  /** Upload do PDF do infoproduto para o Vercel Blob (Fase 5). */
  async function handlePdfUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = ''; // permite re-selecionar o mesmo ficheiro

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast({ title: 'Formato inválido', description: 'Seleciona um ficheiro PDF.' });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: 'PDF demasiado grande', description: 'O limite é 20 MB.' });
      return;
    }

    setPdfUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/products/upload', {
        method: 'POST',
        headers: authHeaders(),
        body,
      });
      const data = (await res.json()) as { ok?: boolean; url?: string; error?: string };
      if (!res.ok || !data.ok || !data.url) {
        toast({ title: 'Upload falhou', description: data.error });
        return;
      }
      setForm((prev) => ({ ...prev, file_url: data.url as string }));
      toast({ title: 'PDF carregado ✓', description: 'O comprador descarrega após o pagamento confirmado.' });
    } catch {
      toast({ title: 'Erro de ligação', description: 'Tenta enviar o PDF novamente.' });
    } finally {
      setPdfUploading(false);
    }
  }

  /** KYC opcional — BI/NIF para aumentar confiança (Fase 5). */
  async function handleKycSave() {
    if (kycBi.trim().length === 0 && kycNif.trim().length === 0) {
      toast({ title: 'Preenche o BI ou o NIF (pelo menos um).' });
      return;
    }
    setKycSaving(true);
    try {
      const res = await fetch('/api/perfil/kyc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ bi_number: kycBi, nif_number: kycNif }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível guardar', description: data.error });
        return;
      }
      toast({ title: 'Verificação guardada ✓', description: data.message });
      setKycBi('');
      setKycNif('');
    } finally {
      setKycSaving(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    const payload = {
      name: form.name,
      description: form.description,
      price: Number(form.price.replace(/[^\d]/g, '')),
      type: form.type,
      image_url: form.image_url,
      service_lat: form.type === 'servico_domicilio' ? form.service_lat : null,
      service_lng: form.type === 'servico_domicilio' ? form.service_lng : null,
      file_url: form.type === 'infoproduto' && form.file_url ? form.file_url : undefined,
    };

    if (
      form.type === 'servico_domicilio' &&
      (form.service_lat === null || form.service_lng === null)
    ) {
      toast({
        title: 'Falta o ponto de atendimento',
        description: 'Toca no mapa para escolher onde prestas o serviço.',
      });
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch(
        editId ? `/api/products/${editId}` : '/api/products',
        {
          method: editId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(payload),
        }
      );
      const data = (await res.json()) as { product?: Product; error?: string };
      if (!res.ok) throw new Error(data.error || 'Não foi possível guardar.');

      toast({
        title: editId ? 'Alterações guardadas!' : 'Produto publicado!',
        description: editId
          ? `${payload.name} foi atualizado com sucesso.`
          : `${payload.name} já está visível no catálogo.`,
      });
      router.push('/perfil');
    } catch (error) {
      toast({
        title: 'Não foi possível guardar',
        description: error instanceof Error ? error.message : 'Tenta novamente.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  const previewGradient = GRADIENTS[form.type];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <button
        onClick={() => router.push('/perfil')}
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition-colors hover:text-emerald-600"
      >
        <ArrowLeft className="h-4 w-4" /> Voltar ao perfil
      </button>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-lg shadow-amber-500/30">
            {editId ? <Package className="h-6 w-6" /> : <Rocket className="h-6 w-6" />}
          </span>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">
            {editId ? 'Editar produto/serviço' : 'Adicionar Produto'}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {editId
              ? 'Atualiza os dados e guarda as alterações.'
              : 'Publica o teu produto ou serviço — aparece no catálogo em segundos.'}
          </p>
        </div>

        {loadingProduct ? (
          <p className="py-16 text-center text-sm text-slate-400">
            A carregar o produto…
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
            <div className="space-y-2">
              <Label htmlFor="prod-nome">Nome</Label>
              <Input
                id="prod-nome"
                type="text"
                placeholder="Ex.: Curso de Excel para Negócios"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-11"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prod-descricao">Descrição</Label>
              <textarea
                id="prod-descricao"
                rows={4}
                placeholder="Explica o que inclui, para quem é e porque vale a pena. Mínimo 10 caracteres."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                required
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="prod-preco">Preço (Kz)</Label>
                <Input
                  id="prod-preco"
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  placeholder="Ex.: 25000"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  className="h-11"
                  required
                />
                {form.price && Number(form.price) > 0 && (
                  <p className="text-xs font-medium text-emerald-600">
                    {formatKz(Number(form.price))}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="prod-imagem">
                  Link da imagem <span className="text-slate-400">(opcional)</span>
                </Label>
                <div className="relative">
                  <ImageIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="prod-imagem"
                    type="url"
                    placeholder="https://exemplo.ao/foto.jpg"
                    value={form.image_url}
                    onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                    className="h-11 pl-9"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Tipo</Label>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de produto">
                {TYPE_OPTIONS.map(({ value, label, hint, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={form.type === value}
                    onClick={() => setForm({ ...form, type: value })}
                    className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                      form.type === value
                        ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
                        : 'border-slate-200 bg-white hover:border-emerald-300'
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white ${
                        form.type === value ? 'bg-emerald-500' : 'bg-slate-300'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">{label}</span>
                      <span className="block text-xs text-slate-500">{hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* PDF do infoproduto (Fase 5) */}
            {form.type === 'infoproduto' && (
              <div className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
                <Label className="flex items-center gap-1.5">
                  <FileUp className="h-4 w-4 text-emerald-600" />
                  Ficheiro PDF do teu eBook/curso{' '}
                  <span className="font-normal text-slate-400">(opcional, máx. 20 MB)</span>
                </Label>
                <p className="text-xs text-slate-500">
                  O comprador recebe o botão «Descarregar» em “Minhas Compras” assim que o
                  pagamento for confirmado — entrega automática, sem esforço.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <label
                    htmlFor="prod-pdf"
                    className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-600"
                  >
                    {pdfUploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileUp className="h-4 w-4" />
                    )}
                    {form.file_url ? 'Substituir PDF' : 'Escolher PDF'}
                  </label>
                  <input
                    id="prod-pdf"
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={handlePdfUpload}
                    disabled={pdfUploading}
                  />
                  {form.file_url && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-300">
                      <BadgeCheck className="h-3.5 w-3.5" /> PDF carregado
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Mapa — apenas serviço ao domicílio */}
            {form.type === 'servico_domicilio' && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-orange-500" />
                  Ponto de atendimento no mapa{' '}
                  <span className="font-normal text-slate-400">(obrigatório)</span>
                </Label>
                <ServiceMap
                  providerLat={form.service_lat}
                  providerLng={form.service_lng}
                  cidade={user?.cidade}
                  editable
                  pickedLat={form.service_lat}
                  pickedLng={form.service_lng}
                  onPick={(lat, lng) =>
                    setForm((f) => ({ ...f, service_lat: lat, service_lng: lng }))
                  }
                  height={300}
                />
                {form.service_lat !== null && form.service_lng !== null ? (
                  <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                    Ponto definido: {form.service_lat.toFixed(5)}, {form.service_lng.toFixed(5)} — os
                    clientes verão este marcador na página do serviço.
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">
                    Toca no mapa para marcar onde costumas prestar o serviço
                    (centro: {centerForCity(user?.cidade).map((c) => c.toFixed(2)).join(', ')}).
                  </p>
                )}
              </div>
            )}

            {/* Verificação de identidade opcional (Fase 5 — KYC simples) */}
            <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                <BadgeCheck className="mr-1.5 inline h-4 w-4 text-emerald-600" />
                Verificação de identidade (opcional — aumenta a confiança dos clientes)
              </summary>
              <p className="mt-2 text-xs text-slate-500">
                Guardamos apenas o número do documento — nunca a imagem. Vendedores verificados
                recebem mais compras. Podes preencher agora ou depois, no teu perfil.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="kyc-bi">Nº do BI</Label>
                  <Input
                    id="kyc-bi"
                    value={kycBi}
                    onChange={(e) => setKycBi(e.target.value.toUpperCase())}
                    placeholder="Ex.: 004587896LA038"
                    className="h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="kyc-nif">NIF</Label>
                  <Input
                    id="kyc-nif"
                    value={kycNif}
                    onChange={(e) => setKycNif(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder="Ex.: 5417896321"
                    inputMode="numeric"
                    className="h-10"
                  />
                </div>
              </div>
              <Button
                type="button"
                onClick={handleKycSave}
                disabled={kycSaving}
                variant="outline"
                className="mt-3 h-10 border-emerald-300 text-emerald-600 hover:bg-emerald-50"
              >
                {kycSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar verificação
              </Button>
            </details>

            {/* Pré-visualização */}
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Pré-visualização no catálogo
              </p>
              <div className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm">
                <span
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${previewGradient} text-white shadow-md`}
                >
                  <ProductIcon name={TYPE_OPTIONS.find((t) => t.value === form.type)?.iconName ?? 'package'} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {form.name || 'Nome do produto'}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {form.description || 'A descrição aparece aqui…'}
                  </p>
                  <p className="text-sm font-bold text-emerald-600">
                    {Number(form.price) > 0 ? formatKz(Number(form.price)) : 'Preço em Kz'}
                  </p>
                </div>
              </div>
            </div>

            <Button
              type="submit"
              disabled={submitting}
              className="h-12 w-full bg-amber-500 text-base font-semibold text-white hover:bg-amber-600"
            >
              {submitting ? 'A guardar…' : editId ? 'Guardar alterações' : 'Publicar produto/serviço'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function AdicionarProdutoPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-32 text-slate-400">
          <Rocket className="mr-3 h-5 w-5 animate-pulse" />
          <span className="text-sm">A carregar…</span>
        </div>
      }
    >
      <AdicionarProdutoContent />
    </Suspense>
  );
}
