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
  Send,
  ShoppingCart,
  Star,
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
import { PRODUCT_TYPES, type Product, type ProductType } from '@/lib/products-data';
import { ROLE_LABELS, type Role } from '@/lib/roles';
import { useToast } from '@/hooks/use-toast';

const WHATSAPP_NUMBER = '244958176915';

interface DetailProduct extends Product {
  service_lat?: number | null;
  service_lng?: number | null;
  seller_username?: string | null;
  seller_cidade?: string | null;
  seller_especialidade?: string | null;
  seller_telefone?: string | null;
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

  async function submitReview(event: React.FormEvent) {
    event.preventDefault();
    if (!user || rating === 0) return;
    setSendingReview(true);
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ product_id: productId, rating, comment }),
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
        <Loader2 className="mr-3 h-5 w-5 animate-spin text-emerald-500" />
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
        <Button asChild className="mt-8 h-12 bg-emerald-500 px-8 font-semibold text-white hover:bg-emerald-600">
          <Link href="/produtos">
            <ArrowLeft className="mr-2 h-5 w-5" /> Voltar ao catálogo
          </Link>
        </Button>
      </div>
    );
  }

  const typeInfo = PRODUCT_TYPES[product.type as ProductType];
  const waNumber = (product.seller_telefone ?? '').replace(/\D/g, '');
  const waTarget = waNumber.length >= 9 ? waNumber : WHATSAPP_NUMBER;
  const waText = encodeURIComponent(
    `Olá! Vi "${product.name}" na AngoStart e quero mais informações.`
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <Link
        href="/produtos"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-emerald-600"
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
                className={`flex h-72 w-full items-center justify-center bg-gradient-to-br sm:h-96 ${product.gradient}`}
              >
                <ProductIcon name={product.icon} className="h-24 w-24 text-white/90" />
              </div>
            )}
            <div className="p-6">
              <div className="flex flex-wrap items-center gap-2">
                {typeInfo && (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
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
                <Stars value={product.rating ?? avg} />
                <span className="text-sm text-slate-500">
                  {(product.rating ?? avg).toFixed(1)} ({reviewCount}{' '}
                  {reviewCount === 1 ? 'avaliação' : 'avaliações'})
                </span>
              </div>
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                {product.description}
              </p>
              <p className="mt-6 text-3xl font-bold text-emerald-600">
                {formatKz(product.price_kz)}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button
                  onClick={() => {
                    addItem(product, 1);
                    toast({ title: 'Adicionado ao carrinho', description: product.name });
                  }}
                  className="h-12 bg-emerald-500 px-6 font-semibold text-white hover:bg-emerald-600"
                >
                  <ShoppingCart className="mr-2 h-5 w-5" /> Adicionar ao carrinho
                </Button>
                <Button
                  onClick={startChat}
                  disabled={chatStarting}
                  className="h-12 border border-emerald-500 bg-white px-6 font-semibold text-emerald-600 hover:bg-emerald-50"
                >
                  {chatStarting ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <MessageCircle className="mr-2 h-5 w-5" />
                  )}
                  Falar no chat da AngoStart
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-12 border-[#25D366] px-6 font-semibold text-[#128C4A] hover:bg-[#25D366]/10"
                >
                  <a href={`https://wa.me/${waTarget}?text=${waText}`} target="_blank" rel="noopener noreferrer">
                    <Send className="mr-2 h-5 w-5" /> WhatsApp
                  </a>
                </Button>
              </div>
            </div>
          </div>

          {/* ── Mapa de serviço ao domicílio ── */}
          {isDomicilio && (
            <section aria-label="Mapa do serviço" className="mt-8">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                <MapPin className="h-5 w-5 text-emerald-500" /> Área de atendimento
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
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
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
              <p className="mt-3 text-lg font-bold text-slate-900">
                {product.seller_name ?? 'AngoStart'}
              </p>
              {product.seller_role && (
                <p className="text-sm text-emerald-600">
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
                <Button asChild variant="outline" className="mt-4 h-10 w-full border-emerald-500 text-emerald-600 hover:bg-emerald-50">
                  <Link href={`/portfolio/${product.seller_username}`}>
                    Ver portfólio público
                  </Link>
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
    </div>
  );
}
