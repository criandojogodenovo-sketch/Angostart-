'use client';

/**
 * AngoStart — Portfólio público (/portfolio/[username]).
 *
 * Mostra a bio, especialidade, galeria de trabalhos, produtos à venda
 * e o CTA "Contactar via WhatsApp" com o número do prestador.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Globe, Loader2, MapPin, SearchX, Send, Star } from 'lucide-react';
import ProductIcon from '@/components/ProductIcon';
import { Button } from '@/components/ui/button';
import { formatKz } from '@/lib/format';
import { PRODUCT_TYPES, type ProductType } from '@/lib/products-data';

interface PortfolioItem {
  id: number;
  title: string;
  description: string;
  image_url: string;
}

interface SellerData {
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
  whatsapp: string | null;
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
    rating: number;
  }[];
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
        <Loader2 className="mr-3 h-5 w-5 animate-spin text-emerald-500" />
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
        <Button asChild className="mt-8 h-12 bg-emerald-500 px-8 font-semibold text-white hover:bg-emerald-600">
          <Link href="/produtos">
            <ArrowLeft className="mr-2 h-5 w-5" /> Explorar o catálogo
          </Link>
        </Button>
      </div>
    );
  }

  const { seller, items, products } = data;
  const waNumber = (seller.whatsapp ?? '').replace(/\D/g, '');
  const waTarget = waNumber.length >= 9 ? waNumber : '244958176915';
  const waText = encodeURIComponent(
    `Olá ${seller.name}! Encontrei o teu portfólio na AngoStart e quero falar contigo.`
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link
        href="/produtos"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-emerald-600"
      >
        <ArrowLeft className="h-4 w-4" /> Voltar ao catálogo
      </Link>

      {/* Cabeçalho do vendedor */}
      <header className="mt-6 overflow-hidden rounded-3xl bg-slate-900 shadow-lg">
        <div className="h-28 bg-gradient-to-r from-emerald-600/40 via-slate-800 to-slate-900" />
        <div className="flex flex-col items-start gap-4 px-6 pb-6 sm:flex-row sm:items-end">
          {seller.portfolio_image ? (
             
            <img
              src={seller.portfolio_image}
              alt={`Foto de ${seller.name}`}
              className="-mt-12 h-24 w-24 rounded-2xl border-4 border-slate-900 object-cover shadow-xl"
            />
          ) : (
            <span className="-mt-12 flex h-24 w-24 items-center justify-center rounded-2xl border-4 border-slate-900 bg-emerald-500 text-3xl font-bold text-white shadow-xl">
              {seller.name.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white">{seller.name}</h1>
            <p className="text-sm font-semibold text-emerald-400">{seller.role_label}</p>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              {seller.cidade && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> {seller.cidade}
                </span>
              )}
              {seller.especialidade && <span>{seller.especialidade}</span>}
              <span>@{seller.username}</span>
            </div>
          </div>
          <Button
            asChild
            className="h-12 bg-[#25D366] px-6 font-semibold text-white hover:bg-[#1fb857]"
          >
            <a href={`https://wa.me/${waTarget}?text=${waText}`} target="_blank" rel="noopener noreferrer">
              <Send className="mr-2 h-5 w-5" /> Contactar via WhatsApp
            </a>
          </Button>
        </div>
      </header>

      {/* Bio */}
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
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 hover:underline"
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
                { }
                <img src={item.image_url} alt={item.title} className="h-44 w-full object-cover" />
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
          <h2 className="text-xl font-bold text-slate-900">À venda na AngoStart</h2>
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
                    <span className="text-base font-bold text-emerald-600">
                      {formatKz(product.price_kz)}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-amber-500">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      {Number(product.rating ?? 0).toFixed(1)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
