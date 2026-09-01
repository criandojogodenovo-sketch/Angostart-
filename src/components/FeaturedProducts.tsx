'use client';

/**
 * AngoStart — Secção de produtos em destaque (página inicial).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import ProductCard from '@/components/ProductCard';
import { GradientSpinner } from '@/components/motion';
import EmptyIllustration from '@/components/illustrations/EmptyIllustration';
import type { Product } from '@/lib/products-data';
import { Button } from '@/components/ui/button';

export default function FeaturedProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/products?featured=1', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: { products?: Product[] }) => {
        if (cancelled) return;
        setProducts(data.products ?? []);
      })
      .catch(() => {
        // Catálogo REAL: sem BD não mostramos produtos de exemplo
        if (!cancelled) setProducts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    // Fase 18: skeleton loaders (formato dos cards) em vez de spinner solitário
    return (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="A carregar produtos em destaque">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card-premium overflow-hidden">
            <div className="skeleton h-36 w-full rounded-none" />
            <div className="space-y-3 p-4">
              <div className="skeleton h-4 w-1/3" />
              <div className="skeleton h-5 w-4/5" />
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-2/3" />
              <div className="flex items-center justify-between pt-2">
                <div className="skeleton h-6 w-24" />
                <div className="skeleton h-9 w-24" />
              </div>
            </div>
          </div>
        ))}
        <span className="sr-only">
          <GradientSpinner className="h-4 w-4" />
        </span>
      </div>
    );
  }

  if (products.length === 0) {
    // Fase 18: estado vazio ilustrado e amigável
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <EmptyIllustration className="h-36 w-36" />
        <h3 className="mt-4 text-lg font-semibold text-slate-900">
          Ainda não há destaques nesta semana
        </h3>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-500">
          Sê o primeiro a publicar: os produtos em destaque aparecem aqui para
          milhares de compradores em todo o país.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {products.slice(0, 4).map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
      <div className="mt-8 text-center">
        <Button
          asChild
          size="lg"
          className="h-12 bg-gradient-to-r from-blue-600 to-purple-600 px-8 text-base font-semibold text-white shadow-lg shadow-blue-600/25 hover:brightness-110"
        >
          <Link href="/produtos">
            Ver catálogo completo
            <ArrowRight className="ml-2 h-5 w-5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
