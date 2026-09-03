import Link from 'next/link';
import PatternWaves from '@/components/illustrations/PatternWaves';
import { notFound } from 'next/navigation';
import { Package, Store } from 'lucide-react';
import {
  getStoreBySlug,
  listStoreProducts,
  countStoreFollowers,
} from '@/lib/stores';
import { formatKz } from '@/lib/format';
import StoreFollowButton from '@/components/StoreFollowButton';
import VerifiedBadge from '@/components/VerifiedBadge';
import AffiliateCopyButton from '@/components/AffiliateCopyButton';
import CommentsSection from '@/components/CommentsSection';
import ShareButton from '@/components/ShareButton';

export const dynamic = 'force-dynamic';

/**
 * /loja/[slug] — página pública da loja virtual (redesign ref. Nexora/Airbnb).
 * Banner GRANDE no topo, cartão de cabeçalho unificado (logo + nome + CTA
 * seguir), descrição e grelha limpa de produtos. Dark-aware.
 */
export default async function LojaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const store = await getStoreBySlug(decodeURIComponent(slug));
  if (!store) notFound();

  const [produtos, seguidores] = await Promise.all([
    listStoreProducts(store.owner_id),
    countStoreFollowers(store.id),
  ]);

  return (
    <main className="min-h-dvh bg-slate-50 pb-16 dark:bg-slate-950">
      {/* ── Banner GRANDE (h-48 mobile / h-72 desktop) ── */}
      <div
        className="relative h-48 w-full overflow-hidden bg-gradient-to-r from-blue-600 via-indigo-700 to-teal-700 sm:h-72"
        style={
          store.banner_url
            ? { backgroundImage: `url(${store.banner_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
            : undefined
        }
      >
        {!store.banner_url && <PatternWaves />}
        {/* Véu inferior para o cartão de cabeçalho «assentar» no banner */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950/45 to-transparent"
        />
      </div>

      <div className="mx-auto max-w-6xl px-4">
        {/* ── Cartão de cabeçalho unificado (sobreposto ao banner) ── */}
        <div className="-mt-14 rounded-3xl border border-slate-200 bg-white p-5 shadow-xl dark:border-white/10 dark:bg-slate-900 sm:-mt-16 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            {/* Logo */}
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl border-4 border-white bg-blue-100 shadow-lg dark:border-white/10 sm:h-28 sm:w-28">
              {store.logo_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={store.logo_url} alt={store.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600 text-3xl font-black text-white">
                  {store.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            {/* Nome + meta */}
            <div className="min-w-0 flex-1">
              <h1 className="flex flex-wrap items-center gap-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white sm:text-3xl">
                {store.name}
                {store.verified && <VerifiedBadge />}
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Por{' '}
                <Link
                  href={`/portfolio/${store.owner_username ?? ''}`}
                  className="font-semibold text-blue-700 hover:underline dark:text-blue-300"
                >
                  {store.owner_name}
                </Link>
              </p>
              {/* Estatísticas em chips */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                  <Package className="h-3.5 w-3.5" />
                  {produtos.length} {produtos.length === 1 ? 'produto' : 'produtos'}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-3 py-1 text-xs font-bold text-purple-700 dark:bg-purple-500/15 dark:text-purple-300">
                  <Store className="h-3.5 w-3.5" />
                  {seguidores} {seguidores === 1 ? 'seguidor' : 'seguidores'}
                </span>
              </div>
            </div>

            {/* Ações — seguir em destaque */}
            <div className="flex w-full max-w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <StoreFollowButton storeId={store.id} />
              {/* Partilha pública da loja — URL limpo, para qualquer visitante */}
              <ShareButton productUrl={`/loja/${store.slug}`} label="Copiar link" className="w-full sm:w-auto" />
              {/* Fase 11 — divulgar a loja inteira com o código do afiliado (só afiliados veem) */}
              <AffiliateCopyButton path={`/loja/${store.slug}`} className="w-full sm:w-auto" />
            </div>
          </div>

          {/* Descrição dentro do cartão */}
          {store.description && (
            <p className="mt-5 whitespace-pre-line border-t border-slate-100 pt-4 text-sm leading-relaxed text-slate-600 dark:border-white/10 dark:text-slate-400">
              {store.description}
            </p>
          )}
        </div>

        {/* Produtos — grelha limpa */}
        <h2 className="mt-10 text-xl font-black tracking-tight text-slate-900 dark:text-white">
          Produtos e serviços
        </h2>
        {produtos.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-white/15 dark:bg-slate-900 dark:text-slate-400">
            Esta loja ainda não tem produtos publicados.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4 min-[480px]:grid-cols-3 lg:grid-cols-4">
            {produtos.map((p) => (
              <div
                key={p.id}
                className="hover-lift group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900"
              >
                {/* Partilha pública — sobre o canto da imagem; não navega */}
                <ShareButton
                  productUrl={`/produtos/${p.id}`}
                  compact
                  className="absolute right-2 top-2 z-10"
                />
                <Link href={`/produtos/${p.id}`} className="block">
                  <div className="aspect-square w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
                    {p.image_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={p.image_url}
                        alt={p.name}
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50 text-4xl dark:from-slate-800 dark:to-slate-800">
                        {p.type === 'infoproduto' ? '📚' : p.type === 'produto_fisico' ? '📦' : '🛠️'}
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="line-clamp-2 min-h-10 text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {p.name}
                    </p>
                    <p className="mt-1.5 bg-gradient-to-r from-blue-700 to-purple-700 bg-clip-text text-lg font-extrabold text-transparent dark:from-blue-400 dark:to-purple-400">
                      {formatKz(p.price_kz)}
                    </p>
                    {!p.available && (
                      <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-white/10 dark:text-slate-400">
                        ESGOTADO
                      </span>
                    )}
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )}

        {/* ── Fase 11: comentários da loja ── */}
        <CommentsSection targetType="store" targetId={store.id} />
      </div>
    </main>
  );
}
