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
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Award,
  Globe,
  Loader2,
  MapPin,
  Medal,
  MessageCircle,
  Package,
  SearchX,
  Star,
  Users,
} from 'lucide-react';
import ProductIcon from '@/components/ProductIcon';
import CommentsSection from '@/components/CommentsSection';
import { Button } from '@/components/ui/button';
import { formatKz } from '@/lib/format';
import { PRODUCT_TYPES, type ProductType } from '@/lib/products-data';

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
  const [data, setData] = useState<PortfolioPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link
        href="/produtos"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-blue-700"
      >
        <ArrowLeft className="h-4 w-4" /> Voltar ao catálogo
      </Link>

      {/* Cabeçalho do vendedor — Mini-Loja */}
      <header className="mt-6 overflow-hidden rounded-3xl bg-slate-900 shadow-lg">
        <div className="h-28 bg-gradient-to-r from-blue-700/40 via-slate-800 to-slate-900" />
        <div className="flex flex-col items-start gap-4 px-6 pb-6 sm:flex-row sm:items-end">
          {seller.portfolio_image ? (
            <img
              src={seller.portfolio_image}
              alt={`Foto de ${seller.name}`}
              className="-mt-12 h-24 w-24 rounded-2xl border-4 border-slate-900 object-cover shadow-xl"
            />
          ) : (
            <span className="-mt-12 flex h-24 w-24 items-center justify-center rounded-2xl border-4 border-slate-900 bg-blue-600 text-3xl font-bold text-white shadow-xl">
              {seller.name.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white">{seller.name}</h1>
            <p className="text-sm font-semibold text-blue-300">{seller.role_label}</p>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              {seller.cidade && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> {seller.cidade}
                </span>
              )}
              {seller.especialidade && <span>{seller.especialidade}</span>}
              <span>@{seller.username}</span>
            </div>
            {/* Reputação — real ou estimada (claramente marcada, Fase 6 ponto 6) */}
            {media > 0 && (
              <p
                className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                  estimada
                    ? 'bg-slate-400/15 text-slate-300'
                    : 'bg-amber-400/15 text-amber-300'
                }`}
              >
                <Star className={`h-3.5 w-3.5 ${estimada ? 'text-slate-300' : 'fill-amber-400 text-amber-400'}`} />
                {media.toFixed(1)} de 5
                {estimada ? (
                  <span className="font-normal text-slate-400">· avaliação estimada</span>
                ) : (
                  <span className="font-normal text-amber-200/70">
                    · {totalAvaliacoes}{' '}
                    {totalAvaliacoes === 1 ? 'avaliação' : 'avaliações'} reais
                  </span>
                )}
              </p>
            )}
          </div>
          {/* 🔒 Fase 6 (ponto 2): contacto apenas via chat interno */}
          <Button asChild className="h-12 bg-blue-600 px-6 font-semibold text-white hover:bg-blue-700">
            <Link href="/chat">
              <MessageCircle className="mr-2 h-5 w-5" /> Falar no chat
            </Link>
          </Button>
        </div>

        {/* Estatísticas da Mini-Loja */}
        <dl className="grid grid-cols-3 gap-px border-t border-white/10 bg-white/10 text-center">
          <div className="bg-slate-900 px-2 py-4">
            <dt className="flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide text-slate-400">
              <Star className="h-3.5 w-3.5 text-amber-400" /> Avaliação
            </dt>
            <dd className="mt-1 text-lg font-bold text-white">
              {media > 0 ? media.toFixed(1) : '—'}
              {estimada && <span className="ml-1 text-[10px] font-normal text-slate-400">est.</span>}
            </dd>
          </div>
          <div className="bg-slate-900 px-2 py-4">
            <dt className="flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide text-slate-400">
              <Package className="h-3.5 w-3.5 text-blue-300" /> Produtos
            </dt>
            <dd className="mt-1 text-lg font-bold text-white">{seller.total_produtos ?? 0}</dd>
          </div>
          <div className="bg-slate-900 px-2 py-4">
            <dt className="flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide text-slate-400">
              <Users className="h-3.5 w-3.5 text-blue-300" /> Clientes
            </dt>
            <dd className="mt-1 text-lg font-bold text-white">{seller.total_clientes ?? 0}</dd>
          </div>
          {seller.gamificacao && (
            <div className="bg-slate-900 px-2 py-4">
              <dt className="flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide text-slate-400">
                <Medal className="h-3.5 w-3.5 text-blue-300" /> Nível
              </dt>
              <dd className="mt-1 text-lg font-bold text-white">
                {LEVEL_BADGE[seller.gamificacao.level]?.emoji ?? '🥉'}{' '}
                {LEVEL_BADGE[seller.gamificacao.level]?.label ?? 'Bronze'}
              </dd>
            </div>
          )}
        </dl>

        {/* Selos de confiança (Fase 7) */}
        {seller.gamificacao && seller.gamificacao.badges.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
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
      <section aria-label="Sobre o prestador" className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Sobre mim</h2>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">
          {seller.portfolio_bio || seller.bio || 'Este prestador ainda não escreveu a sua bio.'}
        </p>
        {seller.portfolio_url && (
          <a
            href={seller.portfolio_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:underline"
          >
            <Globe className="h-4 w-4" /> Website / portfólio externo
          </a>
        )}
      </section>

      {/* Galeria de trabalhos */}
      <section aria-label="Portfólio de trabalhos" className="mt-8">
        <h2 className="text-xl font-bold text-slate-900">Trabalhos ({items.length})</h2>
        {items.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
            Ainda não há trabalhos publicados neste portfólio.
          </p>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <li key={item.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
                <img loading="lazy" src={item.image_url} alt={item.title} className="h-44 w-full object-cover" />
                <div className="p-4">
                  <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                  {item.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.description}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Produtos/serviços à venda */}
      {products.length > 0 && (
        <section aria-label="Produtos à venda" className="mt-8">
          <h2 className="text-xl font-bold text-slate-900">Produtos à venda</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <li key={product.id}>
                <Link
                  href={`/produtos/${product.id}`}
                  className="block h-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className={`flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br ${product.gradient} text-white`}>
                    <ProductIcon name={product.icon} className="h-7 w-7" />
                  </div>
                  <h3 className="mt-3 line-clamp-1 text-sm font-semibold text-slate-900">
                    {product.name}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {PRODUCT_TYPES[product.type as ProductType]?.short ?? product.type}
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-base font-bold text-blue-600">
                      {formatKz(product.price_kz)}
                    </span>
                    {/* Fase 11: sem média real → "Novo" (nunca um 4.5 falso) */}
                    {product.rating != null ? (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-500">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        {Number(product.rating).toFixed(1)}
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                        Sem avaliações
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Avaliações recebidas (Fase 6, ponto 1) */}
      <section aria-label="Avaliações recebidas" className="mt-8">
        <h2 className="text-xl font-bold text-slate-900">Avaliações ({totalAvaliacoes})</h2>
        {reviews.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
            Ainda sem avaliações reais — a nota acima é uma estimativa da
            plataforma e desaparece assim que chegarem as primeiras avaliações.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {reviews.map((review) => (
              <li
                key={review.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900">
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
                {review.comment && (
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{review.comment}</p>
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
