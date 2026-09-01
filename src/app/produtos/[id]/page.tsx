'use client';

/**
 * AngoStart — Página de detalhe do produto/serviço (/produtos/[id]).
 *
 * - Informação completa + vendedor (link para o portfólio público).
 * - 🗺️ servico_domicilio → mapa escuro: marcador do prestador + o cliente
 *   escolhe o ponto de serviço tocando no mapa (Geolocation disponível).
 * - ⭐ Avaliações: média de estrelas + comentários; submissão apenas para
 *   clientes com compra confirmada (a API valida).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  MapPin,
  MessageCircle,
  ShoppingCart,
  Star,
  Store,
  Timer,
  UserRound,
} from 'lucide-react';
import ProductIcon from '@/components/ProductIcon';
import ServiceMap from '@/components/ServiceMap';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCart } from '@/context/StoreContext';
import { useAuth, authHeaders } from '@/context/AuthContext';
import { formatKz } from '@/lib/format';
import VerifiedBadge from '@/components/VerifiedBadge';
import CommentsSection from '@/components/CommentsSection';
import { getProductGradient, PRODUCT_TYPES, type Product, type ProductType } from '@/lib/products-data';
import { ROLE_LABELS, type Role } from '@/lib/roles';
import { useToast } from '@/hooks/use-toast';

interface DetailProduct extends Product {
  service_lat?: number | null;
  service_lng?: number | null;
  seller_username?: string | null;
  seller_cidade?: string | null;
  seller_especialidade?: string | null;
  /** Fase 9 */
  seller_verified?: boolean;
  store_slug?: string | null;
  store_name?: string | null;
}

interface Review {
  id: number;
  rating: number;
  comment: string;
  created_at: string;
  user_name: string | null;
  user_username: string | null;
}

function Stars({ value, size = 'h-4 w-4' }: { value: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value.toFixed(1)} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`${size} ${i <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`}
        />
      ))}
    </span>
  );
}

export default function ProdutoDetalhePage() {
  const params = useParams<{ id: string }>();
  const productId = Number(params?.id);
  const { addItem } = useCart();
  const { user } = useAuth();
  const { toast } = useToast();

  const [product, setProduct] = useState<DetailProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Ponto de serviço escolhido pelo cliente (requisito premium)
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null);

  const [reviews, setReviews] = useState<Review[]>([]);
  const [avg, setAvg] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [sendingReview, setSendingReview] = useState(false);
  /* Fase 9: critérios detalhados (Upwork/Fiverr) + link de afiliado */
  const [critComunicacao, setCritComunicacao] = useState(0);
  const [critQualidade, setCritQualidade] = useState(0);
  const [critPrazo, setCritPrazo] = useState(0);
  const [affiliateCode, setAffiliateCode] = useState<string | null>(null);

  /* ── Fase 5: chat interno + tempo estimado de chegada ── */
  const [chatStarting, setChatStarting] = useState(false);

  /** Distância haversine em km. */
  function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  const isDomicilio = product?.type === 'servico_domicilio';
  const etaMinutes = (() => {
    if (!isDomicilio || !picked || product?.service_lat == null || product?.service_lng == null)
      return null;
    const km = haversineKm(picked.lat, picked.lng, product.service_lat, product.service_lng);
    // média urbana ~25 km/h + 5 min de preparação
    return Math.max(Math.round((km / 25) * 60) + 5, 10);
  })();

  /** Inicia (ou recupera) a conversa e abre o chat. */
  async function startChat() {
    if (!user) {
      toast({ title: 'Entra na tua conta', description: 'Precisas de sessão para usar o chat.' });
      return;
    }
    setChatStarting(true);
    try {
      const res = await fetch('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ product_id: productId }),
      });
      const data = (await res.json()) as { ok?: boolean; conversation?: { id: number }; error?: string };
      if (!res.ok || !data.ok || !data.conversation) {
        toast({ title: 'Não foi possível abrir o chat', description: data.error });
        return;
      }
      window.location.href = `/chat?c=${data.conversation.id}`;
    } finally {
      setChatStarting(false);
    }
  }

  /* ── Propostas v2 (Fase 7): preço + prazo personalizados ── */
  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalDesc, setProposalDesc] = useState('');
  const [proposalBudget, setProposalBudget] = useState('');
  const [proposalDeadline, setProposalDeadline] = useState('');
  const [proposalSending, setProposalSending] = useState(false);

  async function submitProposal() {
    if (proposalSending) return;
    setProposalSending(true);
    try {
      const res = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          service_id: productId,
          description: proposalDesc,
          price_kz: Number(proposalBudget.replace(/[^\d]/g, '')),
          deadline_days:
            proposalDeadline.length > 0 ? Number(proposalDeadline.replace(/[^\d]/g, '')) : undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível enviar a proposta', description: data.error });
        return;
      }
      toast({
        title: 'Proposta enviada ✓',
        description: 'O vendedor foi notificado (email + push) e vai responder-te.',
      });
      setProposalOpen(false);
      setProposalDesc('');
      setProposalBudget('');
      setProposalDeadline('');
    } catch {
      toast({ title: 'Erro de ligação', description: 'Tenta novamente.' });
    } finally {
      setProposalSending(false);
    }
  }

  const loadReviews = useCallback(async () => {
    if (!Number.isInteger(productId)) return;
    try {
      const res = await fetch(`/api/reviews?product_id=${productId}`);
      const data = (await res.json()) as {
        reviews?: Review[];
        average?: number;
        count?: number;
      };
      setReviews(data.reviews ?? []);
      setAvg(data.average ?? 0);
      setReviewCount(data.count ?? 0);
    } catch {
      /* silencioso — secção de avaliações fica vazia */
    }
  }, [productId]);

  useEffect(() => {
    if (!Number.isInteger(productId) || productId <= 0) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/products/${productId}`);
        if (!res.ok) throw new Error('não encontrado');
        const data = (await res.json()) as { product: DetailProduct };
        setProduct(data.product);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [productId]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  /* Fase 9: se o visitante é afiliado, permite copiar o link com ?ref=. */
  useEffect(() => {
    if (!user) return;
    fetch('/api/affiliate', { headers: authHeaders(), cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { codigo_afiliado?: string } | null) => {
        if (data?.codigo_afiliado) setAffiliateCode(data.codigo_afiliado);
      })
      .catch(() => {});
  }, [user]);

  /** Copia o link do produto com o código de afiliado (?ref=AFG-…). */
  async function copyAffiliateLink() {
    if (!affiliateCode) return;
    const url = `${window.location.origin}/produtos/${productId}?ref=${affiliateCode}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: 'Link de afiliado copiado!',
        description: 'Partilha-o — ganhas comissão em cada compra feita pelo link.',
      });
    } catch {
      toast({ title: 'Não foi possível copiar', description: url, variant: 'destructive' });
    }
  }

  async function submitReview(event: React.FormEvent) {
    event.preventDefault();
    if (!user || rating === 0) return;
    setSendingReview(true);
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          product_id: productId,
          rating,
          comment,
          comunicacao: critComunicacao || undefined,
          qualidade: critQualidade || undefined,
          prazo: critPrazo || undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Avaliação não guardada', description: data.error });
        return;
      }
      toast({ title: 'Avaliação registada. Obrigado!' });
      setRating(0);
      setComment('');
      loadReviews();
    } catch {
      toast({ title: 'Erro de ligação', description: 'Tenta novamente em instantes.' });
    } finally {
      setSendingReview(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-400">
        <Loader2 className="mr-3 h-5 w-5 animate-spin text-blue-600" />
        <span className="text-sm">A carregar o produto…</span>
      </div>
    );
  }

  if (notFound || !product) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center sm:px-6">
        <h1 className="text-2xl font-bold text-slate-900">Produto não encontrado</h1>
        <p className="mt-2 text-sm text-slate-500">
          Pode ter sido removido pelo vendedor ou o endereço está incorreto.
        </p>
        <Button asChild className="mt-8 h-12 bg-blue-600 px-8 font-semibold text-white hover:bg-blue-700">
          <Link href="/produtos">
            <ArrowLeft className="mr-2 h-5 w-5" /> Voltar ao catálogo
          </Link>
        </Button>
      </div>
    );
  }

  const typeInfo = PRODUCT_TYPES[product.type as ProductType];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <Link
        href="/produtos"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-blue-700"
      >
        <ArrowLeft className="h-4 w-4" /> Voltar ao catálogo
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-5">
        {/* ── Imagem / gradient + info ── */}
        <div className="lg:col-span-3">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            {product.image_url ? (
               
              <img
                src={product.image_url}
                alt={product.name}
                className="h-72 w-full object-cover sm:h-96"
              />
            ) : (
              <div
                className={`flex h-72 w-full items-center justify-center bg-gradient-to-br sm:h-96 ${getProductGradient(product)}`}
              >
                <ProductIcon name={product.icon} className="h-24 w-24 text-white/90" />
              </div>
            )}
            <div className="p-6">
              <div className="flex flex-wrap items-center gap-2">
                {typeInfo && (
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                    {typeInfo.label}
                  </span>
                )}
                <span className="text-xs text-slate-400">
                  Encomenda n.º de referência #{product.id}
                </span>
              </div>
              <h1 className="mt-3 text-2xl font-bold text-slate-900 sm:text-3xl">
                {product.name}
              </h1>
              <div className="mt-2 flex items-center gap-2">
                {/* Fase 11: sem reviews → "Sem avaliações" (nunca média falsa) */}
                {reviewCount > 0 ? (
                  <>
                    <Stars value={product.rating ?? avg} />
                    <span className="text-sm text-slate-500">
                      {(product.rating ?? avg).toFixed(1)} ({reviewCount}{' '}
                      {reviewCount === 1 ? 'avaliação' : 'avaliações'})
                    </span>
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-400">
                    <Star className="h-3.5 w-3.5 text-slate-300" />
                    Sem avaliações — compra e deixa a primeira!
                  </span>
                )}
              </div>
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                {product.description}
              </p>
              <p className="mt-6 text-3xl font-bold text-blue-600">
                {formatKz(product.price_kz)}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button
                  onClick={() => {
                    addItem(product, 1);
                    toast({ title: 'Adicionado ao carrinho', description: product.name });
                  }}
                  className="h-12 bg-blue-600 px-6 font-semibold text-white hover:bg-blue-700"
                >
                  <ShoppingCart className="mr-2 h-5 w-5" /> Adicionar ao carrinho
                </Button>
                <Button
                  onClick={startChat}
                  disabled={chatStarting}
                  className="h-12 border border-blue-500 bg-white px-6 font-semibold text-blue-600 hover:bg-blue-50"
                >
                  {chatStarting ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <MessageCircle className="mr-2 h-5 w-5" />
                  )}
                  Falar no chat da AngoStart
                </Button>
              </div>
              <p className="mt-3 text-xs text-slate-400">
                🔒 Toda a negociação acontece dentro da plataforma, com histórico
                guardado no chat — é a tua proteção em caso de disputa.
              </p>

              {/* Propostas v2 — negociação de preço/prazo (Fase 7) */}
              {product.type !== 'infoproduto' && (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-700">
                    Negocia preço e prazo com o vendedor
                  </p>
                  {!proposalOpen ? (
                    <button
                      type="button"
                      onClick={() => (user ? setProposalOpen(true) : toast({ title: 'Entra na tua conta', description: 'Precisas de sessão para enviar propostas.' }))}
                      className="mt-2 text-xs font-semibold text-blue-600 hover:underline"
                    >
                      Enviar uma proposta ao prestador →
                    </button>
                  ) : (
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={proposalDesc}
                        onChange={(e) => setProposalDesc(e.target.value)}
                        maxLength={3000}
                        rows={3}
                        placeholder="Descreve o que precisas (mín. 20 caracteres)…"
                        className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 outline-none focus:border-blue-400"
                      />
                      <input
                        value={proposalBudget}
                        onChange={(e) => setProposalBudget(e.target.value.replace(/[^\d]/g, ''))}
                        inputMode="numeric"
                        placeholder="O teu preço proposto em Kz (ex.: 15000)"
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400"
                      />
                      <input
                        value={proposalDeadline}
                        onChange={(e) => setProposalDeadline(e.target.value.replace(/[^\d]/g, ''))}
                        inputMode="numeric"
                        placeholder="Prazo em dias (opcional, ex.: 7)"
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={submitProposal}
                          disabled={proposalSending || proposalDesc.trim().length < 20 || proposalBudget.length === 0}
                          className="inline-flex h-9 items-center rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {proposalSending ? 'A enviar…' : 'Enviar proposta'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setProposalOpen(false)}
                          className="inline-flex h-9 items-center rounded-lg border border-slate-300 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Mapa de serviço ao domicílio ── */}
          {isDomicilio && (
            <section aria-label="Mapa do serviço" className="mt-8">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                <MapPin className="h-5 w-5 text-blue-600" /> Área de atendimento
              </h2>
              <p className="mb-3 mt-1 text-sm text-slate-500">
                {product.seller_cidade
                  ? `Prestador em ${product.seller_cidade}.`
                  : 'Prestador ao domicílio.'}{' '}
                Toca no mapa para indicar onde precisas do serviço — combina os
                detalhes com o vendedor.
              </p>
              <ServiceMap
                providerLat={product.service_lat ?? null}
                providerLng={product.service_lng ?? null}
                cidade={product.seller_cidade}
                editable
                pickedLat={picked?.lat ?? null}
                pickedLng={picked?.lng ?? null}
                onPick={(lat, lng) => setPicked({ lat, lng })}
                height={340}
              />
              {picked && (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
                  <CheckCircle2 className="h-4 w-4" /> Ponto escolhido: {picked.lat.toFixed(5)},{' '}
                  {picked.lng.toFixed(5)} — menciona-o na conversa com o vendedor.
                </p>
              )}
              {/* Tempo estimado de chegada (Fase 5) */}
              {etaMinutes !== null && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm text-orange-900">
                  <Timer className="h-5 w-5 text-orange-500" />
                  <span>
                    <strong>Tempo estimado de chegada:</strong> ~{etaMinutes} minutos{' '}
                    <span className="text-xs text-orange-700">(a partir do ponto escolhido no mapa)</span>
                  </span>
                </div>
              )}
            </section>
          )}
        </div>

        {/* ── Vendedor ── */}
        <aside className="lg:col-span-2">
          <div className="sticky top-24 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                <UserRound className="h-4 w-4" /> Vendedor
              </h2>
              <p className="mt-3 flex items-center gap-2 text-lg font-bold text-slate-900">
                {product.seller_name ?? 'AngoStart'}
                {product.seller_verified && <VerifiedBadge />}
              </p>
              {product.store_name && product.store_slug && (
                <p className="mt-1 text-sm text-slate-500">
                  Loja:{' '}
                  <Link href={`/loja/${product.store_slug}`} className="font-semibold text-blue-700 hover:underline">
                    {product.store_name}
                  </Link>
                </p>
              )}
              {product.seller_role && (
                <p className="text-sm text-blue-600">
                  {ROLE_LABELS[product.seller_role as Role] ?? product.seller_role}
                </p>
              )}
              {product.seller_especialidade && (
                <p className="mt-1 text-sm text-slate-500">
                  Especialidade: {product.seller_especialidade}
                </p>
              )}
              {product.seller_cidade && (
                <p className="text-sm text-slate-500">Cidade: {product.seller_cidade}</p>
              )}
              {product.seller_username && (
                <Button asChild variant="outline" className="mt-4 h-10 w-full border-blue-500 text-blue-600 hover:bg-blue-50">
                  <Link href={`/portfolio/${product.seller_username}`}>
                    Ver portfólio público
                  </Link>
                </Button>
              )}
              {/* Fase 11 — atalho direto para a loja do vendedor */}
              {product.store_slug && (
                <Button asChild variant="outline" className="mt-2 h-10 w-full border-blue-500 text-blue-600 hover:bg-blue-50">
                  <Link href={`/loja/${product.store_slug}`}>
                    <Store className="mr-2 h-4 w-4" />
                    Ver loja
                  </Link>
                </Button>
              )}
              {affiliateCode && (
                <Button
                  variant="outline"
                  className="mt-2 h-10 w-full border-amber-400 text-amber-700 hover:bg-amber-50"
                  onClick={copyAffiliateLink}
                >
                  Copiar link de afiliado
                </Button>
              )}
            </div>

            {/* ── Formulário de avaliação ── */}
            {user && (
              <form
                onSubmit={submitReview}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <h3 className="text-sm font-semibold text-slate-900">Avaliar este produto</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Apenas compradores com pagamento confirmado podem avaliar.
                </p>
                <div className="mt-3 flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setRating(i)}
                      aria-label={`${i} estrelas`}
                      className="rounded p-0.5 hover:scale-110 transition-transform"
                    >
                      <Star
                        className={`h-6 w-6 ${i <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`}
                      />
                    </button>
                  ))}
                </div>
                {/* Fase 9: critérios detalhados (opcional) */}
                <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-500">
                    Critérios detalhados (opcional)
                  </p>
                  {(
                    [
                      ['Comunicação', critComunicacao, setCritComunicacao],
                      ['Qualidade', critQualidade, setCritQualidade],
                      ['Prazo', critPrazo, setCritPrazo],
                    ] as const
                  ).map(([label, value, setter]) => (
                    <div key={label} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-600">{label}</span>
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setter(value === i ? 0 : i)}
                            aria-label={`${label}: ${i} de 5`}
                            className="rounded p-0.5 hover:scale-110 transition-transform"
                          >
                            <Star
                              className={`h-4 w-4 ${i <= value ? 'fill-blue-500 text-blue-600' : 'text-slate-300'}`}
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Como foi a tua experiência? (opcional)"
                  className="mt-3 min-h-20 text-sm"
                  maxLength={1000}
                />
                <Button
                  type="submit"
                  disabled={sendingReview || rating === 0}
                  className="mt-3 h-11 w-full bg-slate-900 font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {sendingReview ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Enviar avaliação
                </Button>
              </form>
            )}
          </div>
        </aside>
      </div>

      {/* ── Comentários ── */}
      <section aria-label="Avaliações do produto" className="mt-12">
        <h2 className="text-xl font-bold text-slate-900">
          Avaliações ({reviewCount}){' '}
          {reviewCount > 0 && <span className="text-amber-500">— média {avg.toFixed(1)}</span>}
        </h2>
        {reviews.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            Ainda não há avaliações para este produto. Compra e deixa a primeira!
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {reviews.map((review) => (
              <li
                key={review.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-900">
                    {review.user_name ?? 'Cliente'}
                  </span>
                  <Stars value={review.rating} size="h-3.5 w-3.5" />
                </div>
                {review.comment && (
                  <p className="mt-2 whitespace-pre-line text-sm text-slate-600">
                    {review.comment}
                  </p>
                )}
                <p className="mt-1.5 text-xs text-slate-400">
                  {new Date(review.created_at).toLocaleDateString('pt-PT')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Fase 11: comentários livres (além das avaliações com estrelas) ── */}
      <CommentsSection targetType="product" targetId={product.id} />
    </div>
  );
}
