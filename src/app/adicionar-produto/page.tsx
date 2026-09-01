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

import { useCallback, useEffect, useRef, useState } from 'react';
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
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth, authHeaders } from '@/context/AuthContext';
import { formatKz } from '@/lib/format';
import { uploadFileSmart, safeFileName } from '@/lib/upload-client';
import {
  PRODUCT_IMAGE_ACCEPT,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MIME_TYPES,
} from '@/lib/payments-manual';
import type { Product, ProductType } from '@/lib/products-data';
import ProductIcon from '@/components/ProductIcon';
import ServiceMap, { centerForCity } from '@/components/ServiceMap';
import { MapPin } from 'lucide-react';
import { parseKeywords, MAX_KEYWORDS } from '@/lib/keywords';

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
  infoproduto: 'from-blue-600 to-teal-600',
  produto_fisico: 'from-blue-600 to-cyan-500',
  servico_domicilio: 'from-teal-500 to-blue-600',
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
  /** Fase 15: palavras-chave separadas por vírgulas (opcional). */
  keywords: string;
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
  keywords: '',
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

  /* ── Fase 15b: sugestões de keywords pela IA (botão ✨) ── */
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsSource, setSuggestionsSource] = useState<'ai' | 'heuristica' | null>(null);

  /* ── Upload real de foto do produto (Vercel Blob via /api/upload/image) ── */
  const [imageUploading, setImageUploading] = useState(false);
  const [imageProgress, setImageProgress] = useState<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  /* ── Fase 5: PDF de infoproduto + KYC ── */
  /* Fase 6 (ponto 12): BI é OBRIGATÓRIO para publicar; NIF opcional. */
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<number | null>(null);
  const [kycBi, setKycBi] = useState('');
  const [kycNif, setKycNif] = useState('');
  const [kycSaving, setKycSaving] = useState(false);
  const [kycOpen, setKycOpen] = useState(false);
  const kycRef = useRef<HTMLDetailsElement>(null);

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
        keywords: Array.isArray(p.keywords) ? p.keywords.join(', ') : '',
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
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-lg shadow-blue-500/30">
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
          className="mt-6 h-12 bg-blue-600 px-8 text-white hover:bg-blue-700"
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
          className="mt-6 h-12 border-blue-500 px-8 text-blue-600 hover:bg-blue-50"
        >
          <Link href="/perfil">Voltar ao perfil</Link>
        </Button>
      </div>
    );
  }

  /* ─────────── Submissão ─────────── */

  /** Upload real da FOTO do produto — CLIENT-SIDE via Vercel Blob
   *  (contorna o limite de 4.5 MB de corpo serverless; com retry e
   *  mensagens de erro claras para redes móveis). */
  async function handleImageUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !user) return;
    event.target.value = ''; // permite re-selecionar o mesmo ficheiro

    setImageUploading(true);
    setImageProgress(null);
    const result = await uploadFileSmart({
      file,
      pathname: `produtos/${user.id}/${safeFileName(file.name, 'produto.jpg')}`,
      handleUploadUrl: '/api/upload/image',
      maxBytes: PRODUCT_IMAGE_MAX_BYTES,
      allowedTypes: PRODUCT_IMAGE_MIME_TYPES,
      acceptExtensions: ['jpg', 'jpeg', 'png', 'webp'],
      makeUrl: (pathname) => `/api/media/${pathname}`,
      onProgress: setImageProgress,
    });
    setImageUploading(false);
    setImageProgress(null);

    if (!result.ok) {
      toast({
        title:
          result.kind === 'too-large'
            ? 'Foto demasiado grande'
            : result.kind === 'network'
              ? 'Sem ligação'
              : result.kind === 'timeout'
                ? 'O envio demorou demasiado'
                : 'Upload falhou',
        description: result.error,
        variant: 'destructive',
      });
      return;
    }

    setForm((prev) => ({ ...prev, image_url: result.url }));
    toast({
      title: 'Foto carregada ✓',
      description: 'A imagem fica visível no catálogo para todos os clientes.',
    });
  }

  /** Upload do PDF do infoproduto — CLIENT-SIDE via Vercel Blob
   *  (PDFs de até 20 MB; o corpo nunca passa pela função serverless). */
  async function handlePdfUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !user) return;
    event.target.value = ''; // permite re-selecionar o mesmo ficheiro

    setPdfUploading(true);
    setPdfProgress(null);
    const result = await uploadFileSmart({
      file,
      pathname: `ebooks/${user.id}/${safeFileName(file.name, 'infoproduto.pdf')}`,
      handleUploadUrl: '/api/products/upload',
      maxBytes: 20 * 1024 * 1024,
      allowedTypes: ['application/pdf', 'application/x-pdf', ''],
      acceptExtensions: ['pdf'],
      makeUrl: (_pathname, blobUrl) => blobUrl, // URL absoluto do blob (segredo server-side)
      timeoutMs: 180_000, // PDFs grandes precisam de mais tempo
      onProgress: setPdfProgress,
    });
    setPdfUploading(false);
    setPdfProgress(null);

    if (!result.ok) {
      toast({
        title:
          result.kind === 'too-large'
            ? 'PDF demasiado grande'
            : result.kind === 'network'
              ? 'Sem ligação'
              : result.kind === 'timeout'
                ? 'O envio demorou demasiado'
                : 'Upload falhou',
        description: result.error,
        variant: 'destructive',
      });
      return;
    }

    setForm((prev) => ({ ...prev, file_url: result.url }));
    toast({ title: 'PDF carregado ✓', description: 'O comprador descarrega após o pagamento confirmado.' });
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

  /**
   * Fase 15b: pede sugestões de keywords à IA (endpoint server-side — a
   * chave nunca chega ao cliente). Em caso de falha mostra aviso amigável
   * e o formulário continua manual (nunca bloqueia).
   */
  async function handleSuggestKeywords() {
    if (suggesting) return;
    if (form.name.trim().length < 3 || form.description.trim().length < 10) {
      toast({
        title: 'Falta conteúdo',
        description: 'Escreve primeiro o nome e a descrição do produto.',
      });
      return;
    }
    setSuggesting(true);
    try {
      const res = await fetch('/api/ai/suggest-keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ title: form.name, description: form.description }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        keywords?: string[];
        source?: 'ai' | 'heuristica';
        error?: string;
      };
      if (!res.ok || !data.ok || !Array.isArray(data.keywords)) {
        toast({
          title: 'Sugestões indisponíveis agora',
          description: data.error || 'Podes escrever as palavras-chave manualmente.',
        });
        return;
      }
      if (data.keywords.length === 0) {
        toast({
          title: 'Sem sugestões para este texto',
          description: 'Tenta descrever melhor o produto ou escreve as keywords tu mesmo.',
        });
        return;
      }
      setSuggestions(data.keywords);
      setSuggestionsSource(data.source ?? 'ai');
      toast({
        title: `${data.keywords.length} sugestões prontas ✓`,
        description:
          data.source === 'heuristica'
            ? 'IA indisponível — sugestões automáticas offline. Toca numa sugestão para a usar.'
            : 'Toca numa sugestão para a adicionar ou escreve as tuas.',
      });
    } catch {
      toast({
        title: 'Sugestões indisponíveis agora',
        description: 'Verifica a ligação — ou preenche as palavras-chave manualmente.',
      });
    } finally {
      setSuggesting(false);
    }
  }

  /** Adiciona uma sugestão ao campo (respeitando o máximo e dedupe). */
  function addSuggestion(kw: string) {
    const current = parseKeywords(form.keywords);
    if (current.keywords.some((k) => k.toLowerCase() === kw.toLowerCase())) {
      setSuggestions((prev) => prev.filter((s) => s !== kw));
      return;
    }
    if (current.keywords.length >= MAX_KEYWORDS) {
      toast({
        title: 'Máximo de 10 palavras-chave',
        description: 'Remove uma antes de adicionar outra.',
      });
      return;
    }
    setForm((prev) => ({
      ...prev,
      keywords: prev.keywords.trim()
        ? `${prev.keywords.replace(/,\s*$/, '')}, ${kw}`
        : kw,
    }));
    setSuggestions((prev) => prev.filter((s) => s !== kw));
  }

  /** Usa TODAS as sugestões por cima do campo atual (dedupe incluído). */
  function useAllSuggestions() {
    const merged = parseKeywords(
      [...parseKeywords(form.keywords).keywords, ...suggestions].join(',')
    );
    setForm((prev) => ({ ...prev, keywords: merged.keywords.join(', ') }));
    setSuggestions([]);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    const parsedKeywords = parseKeywords(form.keywords);
    const payload = {
      name: form.name,
      description: form.description,
      price: Number(form.price.replace(/[^\d]/g, '')),
      type: form.type,
      image_url: form.image_url,
      service_lat: form.type === 'servico_domicilio' ? form.service_lat : null,
      service_lng: form.type === 'servico_domicilio' ? form.service_lng : null,
      file_url: form.type === 'infoproduto' && form.file_url ? form.file_url : undefined,
      keywords: parsedKeywords.keywords,
    };

    /* Fase 15: validação leve no cliente (a API revalida autoritativamente).
       Avisar cedo evita o vendedor perder o preenchimento no erro 400. */
    if (parsedKeywords.truncated || parsedKeywords.invalid.length > 0) {
      toast({
        title: 'Palavras-chave inválidas',
        description: parsedKeywords.truncated
          ? `Usa no máximo ${MAX_KEYWORDS} palavras-chave.`
          : `Revisa: ${parsedKeywords.invalid.slice(0, 3).join(', ')} — apenas letras, números e hífens (2-30 caracteres).`,
      });
      setSubmitting(false);
      return;
    }

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
      const data = (await res.json()) as { product?: Product; error?: string; code?: string };
      if (!res.ok) {
        // 🔒 KYC (Fase 12 + 13): documento recusado OU prazo de 30 dias
        // expirado → aviso + orienta para o painel; pendente/sem documento
        // dentro da carência NÃO bloqueia (pode vender normalmente).
        if (data.code === 'KYC_REJECTED') {
          toast({
            title: 'Publicação bloqueada — verificação recusada',
            description:
              'Envia um novo documento no Painel de vendas → Verificação de Identidade para voltar a publicar.',
            variant: 'destructive',
          });
          router.push('/dashboard/vendedor');
          return;
        }
        if (data.code === 'KYC_OVERDUE') {
          toast({
            title: 'Publicação bloqueada — prazo de verificação expirou',
            description:
              'O prazo de 30 dias terminou sem documento. Envia a foto do teu documento no Painel de vendas → Verificação de Identidade para desbloquear.',
            variant: 'destructive',
          });
          router.push('/dashboard/vendedor');
          return;
        }
        throw new Error(data.error || 'Não foi possível guardar.');
      }

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
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition-colors hover:text-blue-700"
      >
        <ArrowLeft className="h-4 w-4" /> Voltar ao perfil
      </button>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-lg shadow-blue-500/30">
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
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
                required
              />
            </div>

            {/* Fase 15: palavras-chave de busca (opcional) + sugestões IA */}
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="prod-keywords" className="flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  Palavras-chave{' '}
                  <span className="font-normal text-slate-400">(opcional)</span>
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSuggestKeywords}
                  disabled={
                    suggesting ||
                    form.name.trim().length < 3 ||
                    form.description.trim().length < 10
                  }
                  className="h-8 border-amber-400 text-amber-600 hover:bg-amber-50 disabled:opacity-50"
                >
                  {suggesting ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {suggesting ? 'A pensar…' : 'Sugerir keywords'}
                </Button>
              </div>
              <Input
                id="prod-keywords"
                type="text"
                placeholder="ex: design, ebook, marketing digital"
                value={form.keywords}
                onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                className="h-11 bg-white"
                autoComplete="off"
              />
              {(() => {
                const parsed = parseKeywords(form.keywords);
                if (parsed.keywords.length === 0) return null;
                return (
                  <div className="flex flex-wrap items-center gap-1">
                    {parsed.keywords.map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            keywords: parsed.keywords
                              .filter((x) => x !== k)
                              .join(', '),
                          }))
                        }
                        className="group inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600 ring-1 ring-blue-200 transition-colors hover:bg-rose-50 hover:text-rose-600 hover:ring-rose-200"
                        title="Remover"
                      >
                        {k}
                        <X className="h-3 w-3 opacity-40 group-hover:opacity-100" />
                      </button>
                    ))}
                    <span className="ml-1 text-[11px] font-semibold text-slate-400">
                      {parsed.keywords.length}/{MAX_KEYWORDS}
                    </span>
                  </div>
                );
              })()}
              {(() => {
                const parsed = parseKeywords(form.keywords);
                if (parsed.invalid.length === 0 && !parsed.truncated) return null;
                return (
                  <p className="text-xs font-medium text-rose-500">
                    {parsed.truncated
                      ? `Máximo de ${MAX_KEYWORDS} palavras-chave.`
                      : `Inválidas: ${parsed.invalid.slice(0, 3).join(', ')} — usa apenas letras, números e hífens (2-30 caracteres).`}
                  </p>
                );
              })()}
              <p className="text-xs text-slate-500">
                Até {MAX_KEYWORDS} palavras separadas por vírgulas — ajudam os
                clientes a encontrar o teu produto na busca. Palavras que não
                correspondem ao produto são detetadas pela IA e reduzem a nota
                do teu perfil.
              </p>

              {/* Chips de sugestão da IA / heurística */}
              {suggestions.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-amber-700">
                      {suggestionsSource === 'heuristica'
                        ? 'Sugestões automáticas (IA offline)'
                        : 'Sugestões da IA'}
                      — toca para adicionar:
                    </p>
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={useAllSuggestions}
                        className="text-xs font-semibold text-amber-700 underline-offset-2 hover:underline"
                      >
                        Usar todas
                      </button>
                      <button
                        type="button"
                        onClick={() => setSuggestions([])}
                        className="text-slate-400 transition-colors hover:text-slate-600"
                        title="Fechar sugestões"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => addSuggestion(s)}
                        className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-blue-300 transition-colors hover:bg-blue-500 hover:text-white hover:ring-blue-500"
                      >
                        <Sparkles className="h-3 w-3" /> {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

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
                <p className="text-xs font-medium text-blue-600">
                  {formatKz(Number(form.price))}
                </p>
              )}
            </div>

            {/* Foto do produto — UPLOAD REAL da galeria (Vercel Blob) */}
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <Label className="flex items-center gap-1.5">
                <ImageIcon className="h-4 w-4 text-blue-600" />
                Foto do produto/serviço{' '}
                <span className="font-normal text-slate-400">
                  (opcional — JPG, PNG ou WebP, máx. 5 MB)
                </span>
              </Label>
              <p className="text-xs text-slate-500">
                Escolhe uma foto da tua galeria — ela aparece no catálogo e na
                página do produto para todos os clientes.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {form.image_url ? (
                  <img
                    src={form.image_url}
                    alt="Foto do produto"
                    className="h-20 w-20 rounded-xl border border-slate-200 object-cover"
                  />
                ) : (
                  <span className="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-slate-300">
                    <ImageIcon className="h-7 w-7" />
                  </span>
                )}
                <label
                  htmlFor="prod-imagem-upload"
                  className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                >
                  {imageUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ImageIcon className="h-4 w-4" />
                  )}
                  {form.image_url ? 'Substituir foto' : 'Escolher foto'}
                </label>
                {imageUploading && imageProgress !== null && (
                  <div className="flex w-full items-center gap-2">
                    <div className="h-1.5 w-40 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-600 transition-all duration-300"
                        style={{ width: `${imageProgress}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-blue-600">{imageProgress}%</span>
                  </div>
                )}
                <input
                  ref={imageInputRef}
                  id="prod-imagem-upload"
                  type="file"
                  accept={PRODUCT_IMAGE_ACCEPT}
                  className="hidden"
                  onChange={handleImageUpload}
                  disabled={imageUploading}
                />
                {form.image_url && (
                  <>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-300">
                      <BadgeCheck className="h-3.5 w-3.5" /> Foto pronta
                    </span>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, image_url: '' })}
                      className="text-xs font-semibold text-rose-500 hover:underline"
                    >
                      Remover
                    </button>
                  </>
                )}
              </div>
              {/* Retrocompatibilidade: produto antigo com link externo — continua
                  a funcionar; o upload é o caminho recomendado. */}
              <details className="text-xs text-slate-500">
                <summary className="cursor-pointer select-none font-medium text-slate-600">
                  Preferes usar um link externo?
                </summary>
                <Input
                  type="url"
                  placeholder="https://exemplo.ao/foto.jpg"
                  value={form.image_url}
                  onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                  className="mt-2 h-10 bg-white"
                />
              </details>
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
                        ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                        : 'border-slate-200 bg-white hover:border-blue-300'
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white ${
                        form.type === value ? 'bg-blue-600' : 'bg-slate-300'
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
              <div className="space-y-2 rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
                <Label className="flex items-center gap-1.5">
                  <FileUp className="h-4 w-4 text-blue-600" />
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
                    className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                  >
                    {pdfUploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileUp className="h-4 w-4" />
                    )}
                    {form.file_url ? 'Substituir PDF' : 'Escolher PDF'}
                  </label>
                  {pdfUploading && pdfProgress !== null && (
                    <div className="flex w-full items-center gap-2">
                      <div className="h-1.5 w-40 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-600 transition-all duration-300"
                          style={{ width: `${pdfProgress}%` }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-blue-600">{pdfProgress}%</span>
                    </div>
                  )}
                  <input
                    id="prod-pdf"
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={handlePdfUpload}
                    disabled={pdfUploading}
                  />
                  {form.file_url && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-300">
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
                  <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
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

            {/* Verificação de identidade — Fase 12: opcional para publicar */}
            <details
              ref={kycRef}
              open={kycOpen}
              onToggle={(e) => setKycOpen(e.currentTarget.open)}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
            >
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                <BadgeCheck className="mr-1.5 inline h-4 w-4 text-emerald-600" />
                Verificação de identidade (opcional) — ganha o selo azul
              </summary>
              <p className="mt-2 text-xs text-slate-500">
                Publicar NÃO exige verificação: podes vender já. Para o selo
                azul de vendedor verificado, envia a foto do documento no
                Painel de vendas → Verificação de Identidade. Aqui podes
                apenas guardar o número do BI/NIF para dar mais confiança
                aos clientes.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="kyc-bi">Nº do BI (opcional)</Label>
                  <Input
                    id="kyc-bi"
                    value={kycBi}
                    onChange={(e) => setKycBi(e.target.value.toUpperCase())}
                    placeholder="Ex.: 004587896LA038"
                    className="h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="kyc-nif">NIF (opcional)</Label>
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
                disabled={kycSaving || (kycBi.trim().length === 0 && kycNif.trim().length === 0)}
                variant="outline"
                className="mt-3 h-10 border-blue-300 text-blue-600 hover:bg-blue-50 disabled:opacity-60"
              >
                {kycSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar dados de confiança
              </Button>
            </details>

            {/* Pré-visualização */}
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Pré-visualização no catálogo
              </p>
              <div className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm">
                {form.image_url ? (
                  <img
                    src={form.image_url}
                    alt="Pré-visualização da foto do produto"
                    className="h-12 w-12 shrink-0 rounded-xl border border-slate-200 object-cover"
                  />
                ) : (
                  <span
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${previewGradient} text-white shadow-md`}
                  >
                    <ProductIcon name={TYPE_OPTIONS.find((t) => t.value === form.type)?.iconName ?? 'package'} />
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {form.name || 'Nome do produto'}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {form.description || 'A descrição aparece aqui…'}
                  </p>
                  <p className="text-sm font-bold text-blue-600">
                    {Number(form.price) > 0 ? formatKz(Number(form.price)) : 'Preço em Kz'}
                  </p>
                </div>
              </div>
            </div>

            <Button
              type="submit"
              disabled={submitting}
              className="h-12 w-full bg-gradient-to-r from-blue-600 to-purple-600 text-base font-semibold text-white shadow-lg shadow-blue-600/25 hover:brightness-110"
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
