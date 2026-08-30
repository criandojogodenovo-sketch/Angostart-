'use client';

/**
 * AngoStart — Card de produto
 * Imagem ilustrativa (ícone em gradiente), nome, preço em Kz e botão comprar.
 */

import { Star, ShoppingCart, Check, Flame, UserRound } from 'lucide-react';
import { useState } from 'react';
import type { Product } from '@/lib/products-data';
import { PRODUCT_TYPES } from '@/lib/products-data';
import { formatKz } from '@/lib/format';
import { useCart } from '@/context/StoreContext';
import { useToast } from '@/hooks/use-toast';
import ProductIcon from '@/components/ProductIcon';
import VerifiedBadge from '@/components/VerifiedBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function ProductCard({ product }: { product: Product }) {
  const { addItem } = useCart();
  const { toast } = useToast();
  const [added, setAdded] = useState(false);

  const typeInfo = PRODUCT_TYPES[product.type];
  // 🔒 Fase 6 (ponto 3): a cota exata é interna — o público vê só disponibilidade
  const outOfStock = product.available === false || product.stock === 0;

  function handleBuy() {
    if (outOfStock) return;
    addItem(product, 1);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1200);
    toast({
      title: 'Adicionado ao carrinho',
      description: `${product.name} — ${formatKz(product.price_kz)}`,
    });
  }

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
      {/* Cabeçalho ilustrativo */}
      <div
        className={`relative flex h-36 items-center justify-center bg-gradient-to-br ${product.gradient}`}
      >
        <ProductIcon
          name={product.icon}
          className="h-14 w-14 text-white/90 transition-transform duration-300 group-hover:scale-110"
        />
        <Badge
          className="absolute left-3 top-3 border-0 bg-white/20 text-white backdrop-blur-sm"
          variant="secondary"
        >
          {typeInfo.short}
        </Badge>
        {product.is_hot && (
          <Badge className="absolute right-3 top-3 animate-pulse border-0 bg-orange-500 text-white shadow-lg">
            <Flame className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Em alta
          </Badge>
        )}
        {product.featured && !product.is_hot && (
          <Badge className="absolute right-3 top-3 border-0 bg-amber-400 text-amber-950">
            Destaque
          </Badge>
        )}
      </div>

      {/* Conteúdo */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-1 text-amber-500">
          <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
          <span className="text-sm font-semibold text-slate-700">
            {product.rating.toFixed(1)}
          </span>
        </div>

        <h3 className="line-clamp-2 text-base font-semibold leading-snug text-slate-900">
          {product.name}
        </h3>

        {product.seller_name && (
          <p className="inline-flex w-fit items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            <UserRound className="h-3 w-3 text-emerald-600" />
            {product.seller_name}
            {product.seller_verified && <VerifiedBadge size={12} />}
          </p>
        )}

        <p className="line-clamp-2 text-sm text-slate-500">
          {product.description}
        </p>

        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <p className="text-lg font-bold text-emerald-600">
            {formatKz(product.price_kz)}
          </p>
          <Button
            onClick={handleBuy}
            disabled={outOfStock}
            className="h-10 min-w-0 flex-1 max-w-[150px] bg-emerald-500 px-3 text-white hover:bg-emerald-600 disabled:opacity-50"
            aria-label={`Comprar ${product.name} por ${formatKz(product.price_kz)}`}
          >
            {added ? (
              <>
                <Check className="mr-1 h-4 w-4" /> Adicionado
              </>
            ) : (
              <>
                <ShoppingCart className="mr-1 h-4 w-4" /> Comprar
              </>
            )}
          </Button>
        </div>
      </div>
    </article>
  );
}
