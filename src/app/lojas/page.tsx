import Link from 'next/link';
import { sql } from '@/lib/db';
import VerifiedBadge from '@/components/VerifiedBadge';

export const dynamic = 'force-dynamic';

/**
 * /lojas — diretório de lojas virtuais (Fase 9).
 */
export default async function LojasPage() {
  let stores: {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    logo_url: string | null;
    owner_name: string;
    verified: boolean;
    product_count: number;
    follower_count: number;
  }[] = [];

  try {
    stores = (await sql`
      SELECT s.id, s.name, s.slug, s.description, s.logo_url,
             u.name AS owner_name, u.is_verified_bi::boolean AS verified,
             (SELECT COUNT(*)::int FROM products p WHERE p.user_id = s.owner_id) AS product_count,
             (SELECT COUNT(*)::int FROM store_followers f WHERE f.store_id = s.id) AS follower_count
      FROM stores s
      JOIN users u ON u.id = s.owner_id
      WHERE u.blocked = FALSE
      ORDER BY product_count DESC, s.created_at DESC
      LIMIT 100
    `) as unknown as typeof stores;
  } catch {
    stores = [];
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-black text-slate-900 sm:text-3xl">Lojas virtuais</h1>
      <p className="mt-1 text-sm text-slate-500">
        Cada vendedor AngoStart tem a sua própria loja — explora, segue e compra com confiança.
      </p>

      {stores.length === 0 ? (
        <p className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-400">
          Ainda não há lojas publicadas — volta em breve!
        </p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stores.map((s) => (
            <Link
              key={s.id}
              href={`/loja/${s.slug}`}
              className="group overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
            >
              <div
                className="h-24 bg-gradient-to-r from-emerald-500 to-teal-600"
                style={s.logo_url ? { backgroundImage: `url(${s.logo_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
              />
              <div className="p-4">
                <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                  {s.name}
                  {s.verified && <VerifiedBadge size={14} />}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">Por {s.owner_name}</p>
                {s.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-slate-600">{s.description}</p>
                )}
                <p className="mt-3 text-xs font-semibold text-emerald-700">
                  {s.product_count} produto(s) · {s.follower_count} seguidor(es)
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
