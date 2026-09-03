'use client';

/**
 * AngoStart — Portfólio público (/portfolio/[username]).
 *
 * Mini-Loja (Fase 6, ponto 1): cabeçalho com estatísticas públicas
 * (avaliação média, produtos publicados, clientes servidos), produtos à
 * venda, "Sobre mim" e avaliações recebidas.
 *
 * 🔒 Fase 6 (ponto 2): SEM contacto WhatsApp do vendedor — toda a
 * comunicação passa pelo chat interno (botão "Falar no chat").
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import PatternWaves from '@/components/illustrations/PatternWaves';
import { useParams } from 'next/navigation';
import { useAuth, authHeaders } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft,
  Award,
  CheckCircle2,
  Globe,
  Handshake,
  Loader2,
  MapPin,
  Medal,
  Package,
  SearchX,
  Star,
  Users,
} from 'lucide-react';
import ProductIcon from '@/components/ProductIcon';
import CommentsSection from '@/components/CommentsSection';
import { Button } from '@/components/ui/button';
import { formatKz } from '@/lib/format';
import { getProductGradient, PRODUCT_TYPES, type ProductType } from '@/lib/products-data';

interface PortfolioItem {
  id: number;
  title: string;
  description: string;
  image_url: string;
}

const LEVEL_BADGE: Record<string, { label: string; emoji: string }> = {
  bronze: { label: 'Bronze', emoji: '🥉' },
  prata: { label: 'Prata', emoji: '🥈' },
  ouro: { label: 'Ouro', emoji: '🥇' },
  platina: { label: 'Platina', emoji: '💎' },
};

interface SellerData {
  id: number;
  name: string;
  role: string;
  role_label: string;
  username: string;
  cidade: string | null;
  especialidade: string | null;
  bio: string | null;
  portfolio_bio: string | null;
  portfolio_image: string | null;
  portfolio_url: string | null;
  profile_image?: string | null;
  media_avaliacoes?: number | null;
  total_avaliacoes?: number | null;
  rating_estimado?: number | null;
  total_produtos?: number | null;
  total_clientes?: number | null;
  gamificacao?: {
    level: string;
    points: number;
    badges: { code: string; name: string; icon: string }[];
  } | null;
}

interface ReviewItem {
  id: number;
  rating: number;
  comment: string;
  created_at: string;
  user_name: string;
  user_username: string | null;
  product_name: string | null;
}

interface PortfolioPayload {
  seller: SellerData;
  items: PortfolioItem[];
  products: {
    id: number;
    name: string;
    price_kz: number;
    type: string;
    icon: string;
    gradient: string;
    image_url: string | null;
    rating: number | null;
  }[];
  reviews?: ReviewItem[];
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating.toFixed(1)} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-4 w-4 ${
            n <= Math.round(rating) ? 'fill-amber-400 text-amber-400' : 'text-slate-300'
          }`}
        />
      ))}
    </span>
  );
}

export default function PortfolioPublicoPage() {
  const params = useParams<{ username: string }>();
  const username = params?.username ?? '';
  const { user } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<PortfolioPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [contactSent, setContactSent] = useState(false);
  const [contactSending, setContactSending] = useState(false);

  useEffect(() => {
    if (!username) return;
    (async () => {
      try {
        const res = await fetch(`/api/portfolio/${encodeURIComponent(username)}`);
        if (!res.ok) throw new Error('não encontrado');
        setData((await res.json()) as PortfolioPayload);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [username]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-400">
        <Loader2 className="mr-3 h-5 w-5 animate-spin text-blue-600" />
        <span className="text-sm">A carregar o portfólio…</span>
      </div>
    );
  }

  if (notFound || !data?.seller) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center sm:px-6">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
          <SearchX className="h-8 w-8 text-slate-400" />
        </span>
        <h1 className="mt-5 text-2xl font-bold text-slate-900">Portfólio não encontrado</h1>
        <p className="mt-2 text-sm text-slate-500">
          O utilizador «{username}» não existe ou não é um vendedor AngoStart.
        </p>
        <Button asChild className="mt-8 h-12 bg-blue-600 px-8 font-semibold text-white hover:bg-blue-700">
          <Link href="/produtos">
            <ArrowLeft className="mr-2 h-5 w-5" /> Explorar o catálogo
          </Link>
        </Button>
      </div>
    );
  }

  const { seller, items, products, reviews = [] } = data;
  const totalAvaliacoes = seller.total_avaliacoes ?? 0;
  const estimada = totalAvaliacoes === 0 && typeof seller.rating_estimado === 'number';
  const media = estimada ? (seller.rating_estimado as number) : (seller.media_avaliacoes ?? 0);

  /* Fase 16 — «Entrar em Contato» (fluxo Airbnb): o prestador aceita ou
     recusa; depois do aceite o cliente abre o chat pela aba Contactos. */
  async function pedirContato() {
    if (!user) {
      toast({
        title: 'Entra na tua conta',
        description: 'Precisas de sessão iniciada para entrar em contato.',
      });
      return;
    }
    if (contactSending || contactSent) return;
    setContactSending(true);
    try {
      const res = await fetch('/api/contact-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ provider_id: seller.id }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setContactSent(true);
        toast({
          title: 'Pedido de contato enviado ✓',
          description: `${seller.name} recebeu a tua solicitação — acompanha a resposta em Pedidos → Contactos.`,
        });
      } else {
        toast({ title: 'Não foi possível enviar', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({
        title: 'Sem ligação',
        description: 'Verifica a internet e tenta novamente.',
        variant: 'destructive',
      });
    } finally {
      setContactSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Link
        href="/prestadores"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-blue-700 dark:text-slate-400 dark:hover:text-blue-300"
      >
        <ArrowLeft className="h-4 w-4" /> Voltar aos prestadores
      </Link>

      {/* ── HERO estilo «Aarav Singh»: foto GRANDE + nome + título + CTAs ── */}
      <header className="relative mt-5 overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-900 via-blue-950 to-purple-950 text-white shadow-2xl">
        <div className="pointer-events-none absolute inset-0 opacity-60">
          <PatternWaves />
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-purple-500/20 blur-3xl"
        />

        <div className="relative flex flex-col items-center gap-6 px-6 pb-8 pt-10 text-center sm:flex-row sm:items-end sm:px-10 sm:pb-10 sm:pt-12 sm:text-left">
          {/* Foto GRANDE (h-40 mobile / h-48 desktop) */}
          {seller.profile_image || seller.portfolio_image ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={(seller.profile_image ?? seller.portfolio_image) as string}
              alt={`Foto de ${seller.name}`}
              className="h-40 w-40 shrink-0 rounded-[1.75rem] border-4 border-white/15 object-cover shadow-2xl ring-4 ring-blue-500/30 transition-transform duration-500 hover:scale-[1.03] sm:h-48 sm:w-48"
            />
          ) : (
            <span className="flex h-40 w-40 shrink-0 items-center justify-center rounded-[1.75rem] border-4 border-white/15 bg-gradient-to-br from-blue-500 to-purple-600 text-6xl font-black text-white shadow-2xl ring-4 ring-blue-500/30 sm:h-48 sm:w-48">
              {seller.name.charAt(0).toUpperCase()}
            </span>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl lg:text-5xl">
              {seller.name}
            </h1>
            <p className="mt-1.5 text-base font-bold text-blue-300 sm:text-lg">
              {seller.role_label}
              {seller.especialidade ? ` · ${seller.especialidade}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-slate-400 sm:justify-start sm:text-sm">
              {seller.cidade && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> {seller.cidade}
                </span>
              )}
              <span>@{seller.username}</span>
              {/* Reputação — real ou estimada (claramente marcada, Fase 6 ponto 6) */}
              {media > 0 && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                    estimada
                      ? 'bg-slate-400/15 text-slate-300'
                      : 'bg-amber-400/15 text-amber-300'
                  }`}
                >
                  <Star className={`h-3.5 w-3.5 ${estimada ? 'text-slate-300' : 'fill-amber-400 text-amber-400'}`} />
                  {media.toFixed(1)} de 5
                  {estimada ? ' · estimada' : ` · ${totalAvaliacoes} ${totalAvaliacoes === 1 ? 'real' : 'reais'}`}
                </span>
              )}
            </div>

            {/* CTAs principais — «Ver Trabalhos» + «Contactar» */}
            <div className="mt-6 flex max-w-full flex-col justify-center gap-3 sm:flex-row sm:justify-start">
              <Button
                asChild
                className="btn-shine h-12 bg-gradient-to-r from-blue-600 to-purple-600 px-7 font-semibold text-white shadow-lg shadow-blue-600/30 hover:brightness-110"
              >
                <a href="#trabalhos">
                  <Package className="mr-2 h-5 w-5" /> Ver Trabalhos
                </a>
              </Button>
              <Button
                onClick={pedirContato}
                disabled={contactSending || contactSent || user?.id === seller.id}
                variant="outline"
                className="h-12 border-white/25 bg-white/5 px-7 font-semibold text-white backdrop-blur hover:bg-white/10"
              >
                {contactSending ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : contactSent ? (
                  <CheckCircle2 className="mr-2 h-5 w-5" />
                ) : (
                  <Handshake className="mr-2 h-5 w-5" />
                )}
                {contactSent ? 'Pedido enviado ✓' : 'Contactar'}
              </Button>
            </div>
          </div>
        </div>

        {/* Estatísticas — faixa em vidro */}
        <dl className="relative grid grid-cols-2 gap-px border-t border-white/10 bg-white/10 text-center sm:grid-cols-4">
          <div className="min-w-0 bg-slate-900/80 px-2 py-4 backdrop-blur">
            <dt className="flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide text-slate-400">
              <Star className="h-3.5 w-3.5 text-amber-400" /> Avaliação
            </dt>
            <dd className="mt-1 text-lg font-bold text-white">
              {media > 0 ? media.toFixed(1) : '—'}
              {estimada && <span className="ml-1 text-[10px] font-normal text-slate-400">est.</span>}
            </dd>
          </div>
          <div className="min-w-0 bg-slate-900/80 px-2 py-4 backdrop-blur">
            <dt className="flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide text-slate-400">
              <Package className="h-3.5 w-3.5 text-blue-300" /> Trabalhos
            </dt>
            <dd className="mt-1 text-lg font-bold text-white">{items.length}</dd>
          </div>
          <div className="min-w-0 bg-slate-900/80 px-2 py-4 backdrop-blur">
            <dt className="flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide text-slate-400">
              <Users className="h-3.5 w-3.5 text-blue-300" /> Clientes
            </dt>
            <dd className="mt-1 text-lg font-bold text-white">{seller.total_clientes ?? 0}</dd>
          </div>
          <div className="col-span-2 min-w-0 bg-slate-900/80 px-2 py-4 backdrop-blur sm:col-span-1">
            <dt className="flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide text-slate-400">
              <Medal className="h-3.5 w-3.5 text-blue-300" /> Nível
            </dt>
            <dd className="mt-1 text-lg font-bold text-white">
              {seller.gamificacao
                ? `${LEVEL_BADGE[seller.gamificacao.level]?.emoji ?? '🥉'} ${LEVEL_BADGE[seller.gamificacao.level]?.label ?? 'Bronze'}`
                : '—'}
            </dd>
          </div>
        </dl>

        {/* Selos de confiança (Fase 7) */}
        {seller.gamificacao && seller.gamificacao.badges.length > 0 && (
          <div className="relative mt-4 flex flex-wrap justify-center gap-2 px-6 pb-6">
            {seller.gamificacao.badges.map((b) => (
              <span
                key={b.code}
                className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-600/10 px-3 py-1 text-xs font-semibold text-blue-300"
              >
                <Award className="h-3.5 w-3.5" /> {b.name}
              </span>
            ))}
          </div>
        )}
      </header>

      {/* Sobre mim */}
      <section aria-label="Sobre o prestador" className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Sobre mim</h2>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          {seller.portfolio_bio || seller.bio || 'Este prestador ainda não escreveu a sua bio.'}
        </p>
        {seller.portfolio_url && (
          <a
            href={seller.portfolio_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:underline dark:text-blue-300"
          >
            <Globe className="h-4 w-4" /> Website / portfólio externo
          </a>
        )}
      </section>

      {/* Serviços (ref. «Aarav Singh — What I Do») — derivados de dados reais */}
      {(() => {
        const serviceTypes = [...new Set(products.map((p) => p.type))].filter(
          (t): t is ProductType => t in PRODUCT_TYPES,
        );
        const hasServices = serviceTypes.length > 0 || seller.especialidade;
        if (!hasServices) return null;
        return (
          <section aria-label="Serviços" className="mt-10">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Serviços</h2>
            <ul className="mt-4 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
              {seller.especialidade && (
                <li className="hover-lift rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-md">
                    <Handshake className="h-5 w-5" />
                  </span>
                  <h3 className="mt-3 text-sm font-bold text-slate-900 dark:text-white">{seller.especialidade}</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Especialidade principal declarada pelo prestador.</p>
                </li>
              )}
              {serviceTypes.map((type) => {
                const info = PRODUCT_TYPES[type];
                return (
                  <li key={type} className="hover-lift rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
                    <span className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${info.gradient} text-white shadow-md`}>
                      <Package className="h-5 w-5" />
                    </span>
                    <h3 className="mt-3 text-sm font-bold text-slate-900 dark:text-white">{info.label}</h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {products.filter((p) => p.type === type).length} oferta(s) ativa(s) neste catálogo.
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })()}

      {/* Galeria de trabalhos — imagens GRANDES (ref. «Aarav Singh — Projects») */}
      <section aria-label="Portfólio de trabalhos" id="trabalhos" className="mt-10 scroll-mt-24">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Trabalhos ({items.length})</h2>
        {items.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400 dark:border-white/15">
            Ainda não há trabalhos publicados neste portfólio.
          </p>
        ) : (
          <ul className="mt-4 grid gap-5 sm:grid-cols-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="hover-lift group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900"
              >
                <div className="relative h-56 w-full overflow-hidden sm:h-64">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    loading="lazy"
                    src={item.image_url}
                    alt={item.title}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent" />
                  <h3 className="absolute bottom-3 left-4 right-4 line-clamp-1 text-base font-bold text-white drop-shadow">
                    {item.title}
                  </h3>
                </div>
                <p className="p-4 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {item.description || 'Trabalho publicado pelo prestador.'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Processo de trabalho numerado (ref. «Design Process») */}
      <section aria-label="Processo de trabalho" className="mt-10">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Como trabalho</h2>
        <ol className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { n: 1, t: 'Pedido', d: 'Envias o pedido pelo chat AngoStart, sem contactos expostos.' },
            { n: 2, t: 'Proposta', d: 'O prestador responde com âmbito, prazo e preço em Kwanzas.' },
            { n: 3, t: 'Execução', d: 'Trabalho acompanado — acompanhas cada atualização na plataforma.' },
            { n: 4, t: 'Entrega', d: 'Confirmas a entrega e só então o pagamento é libertado.' },
          ].map((s) => (
            <li
              key={s.n}
              className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-purple-600 text-sm font-black text-white shadow-md">
                {s.n}
              </span>
              <h3 className="mt-3 text-sm font-bold text-slate-900 dark:text-white">{s.t}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Produtos/serviços à venda */}
      {products.length > 0 && (
        <section aria-label="Produtos à venda" className="mt-10">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Produtos à venda</h2>
          <ul className="mt-4 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <li key={product.id}>
                <Link
                  href={`/produtos/${product.id}`}
                  className="hover-lift block h-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900"
                >
                  <div className={`flex h-20 w-full items-center justify-center rounded-xl bg-gradient-to-br ${getProductGradient(product)} text-white`}>
                    <ProductIcon name={product.icon} className="h-9 w-9" />
                  </div>
                  <h3 className="mt-3 line-clamp-1 text-sm font-semibold text-slate-900 dark:text-white">
                    {product.name}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {PRODUCT_TYPES[product.type as ProductType]?.short ?? product.type}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="bg-gradient-to-r from-blue-700 to-purple-700 bg-clip-text text-lg font-extrabold text-transparent dark:from-blue-400 dark:to-purple-400">
                      {formatKz(product.price_kz)}
                    </span>
                    {/* Fase 11: sem média real → "Novo" (nunca um 4.5 falso) */}
                    {product.rating != null ? (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-500">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        {Number(product.rating).toFixed(1)}
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-400 dark:bg-white/10">
                        Novo
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Avaliações / testemunhos de clientes (Fase 6, ponto 1) */}
      <section aria-label="Avaliações recebidas" className="mt-10">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Testemunhos ({totalAvaliacoes})</h2>
        {reviews.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400 dark:border-white/15">
            Ainda sem avaliações reais — a nota acima é uma estimativa da
            plataforma e desaparece assim que chegarem as primeiras avaliações.
          </p>
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {reviews.map((review) => (
              <li
                key={review.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900"
              >
                <blockquote className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  «{review.comment || 'Recomendo este prestador.'}»
                </blockquote>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-white/10">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">
                    {review.user_name}
                    {review.user_username && (
                      <span className="ml-1 text-xs font-normal text-slate-400">
                        @{review.user_username}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <Stars rating={review.rating} />
                    <span className="text-xs text-slate-400">
                      {new Date(review.created_at).toLocaleDateString('pt-PT')}
                    </span>
                  </span>
                </div>
                {review.product_name && (
                  <p className="mt-1 text-xs text-slate-400">sobre «{review.product_name}»</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Fase 11: comentários ao vendedor (além das avaliações) ── */}
      <CommentsSection targetType="seller" targetId={seller.id} />
    </div>
  );
}
