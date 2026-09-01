import Link from 'next/link';
import { notFound } from 'next/navigation';
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

export const dynamic = 'force-dynamic';

/**
 * /loja/[slug] — página pública da loja virtual (Fase 9).
 * Mostra banner, logo, descrição, produtos da loja e botão de seguir.
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
    <main className="min-h-dvh bg-slate-50 pb-16">
      {/* Banner */}
      <div
        className="relative h-40 w-full bg-gradient-to-r from-blue-600 to-teal-700 sm:h-56"
        style={
          store.banner_url
            ? { backgroundImage: `url(${store.banner_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
            : undefined
        }
      />

      <div className="mx-auto max-w-5xl px-4">
        {/* Cabeçalho da loja */}
        <div className="-mt-12 flex flex-col gap-4 sm:-mt-16 sm:flex-row sm:items-end">
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl border-4 border-white bg-blue-100 shadow-lg sm:h-28 sm:w-28">
            {store.logo_url ? (
               
              <img src={store.logo_url} alt={store.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-3xl font-black text-blue-700">
                {store.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1 pb-1">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-black text-slate-900">
              {store.name}
              {store.verified && <VerifiedBadge />}
            </h1>
            <p className="text-sm text-slate-500">
              Por{' '}
              <Link href={`/portfolio/${store.owner_username ?? ''}`} className="font-medium text-blue-700 hover:underline">
                {store.owner_name}
              </Link>
              {' · '}
              {produtos.length} produto(s) · {seguidores} seguidor(es)
            </p>
          </div>
          <div className="flex flex-col gap-2 pb-1 sm:flex-row sm:items-center">
            <StoreFollowButton storeId={store.id} />
            {/* Fase 11 — divulgar a loja inteira com o código do afiliado */}
            <AffiliateCopyButton path={`/loja/${store.slug}`} className="w-full" />
          </div>
        </div>

        {/* Descrição */}
        {store.description && (
          <p className="mt-4 whitespace-pre-line rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700">
            {store.description}
          </p>
        )}

        {/* Produtos */}
        <h2 className="mt-8 text-lg font-bold text-slate-900">Produtos e serviços</h2>
        {produtos.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            Esta loja ainda não tem produtos publicados.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {produtos.map((p) => (
              <Link
                key={p.id}
                href={`/produtos/${p.id}`}
                className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
              >
                <div className="aspect-square w-full overflow-hidden bg-slate-100">
                  {p.image_url ? (
                     
                    <img src={p.image_url} alt={p.name} className="h-full w-full object-cover transition group-hover:scale-105" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-3xl">
                      {p.type === 'infoproduto' ? '📚' : p.type === 'produto_fisico' ? '📦' : '🛠️'}
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 min-h-10 text-sm font-semibold text-slate-800">{p.name}</p>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-sm font-black text-blue-700">{formatKz(p.price_kz)}</span>
                    {!p.available && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">ESGOTADO</span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* ── Fase 11: comentários da loja ── */}
        <CommentsSection targetType="store" targetId={store.id} />
      </div>
    </main>
  );
}
