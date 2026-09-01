'use client';

/**
 * AngoStart — Secção de produtos em destaque (página inicial).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Loader2 } from 'lucide-react';
import ProductCard from '@/components/ProductCard';
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
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="text-sm">A carregar destaques…</span>
      </div>
    );
  }

  if (products.length === 0) return null;

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
          className="h-12 bg-blue-600 px-8 text-base font-semibold text-white hover:bg-blue-700"
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
