'use client';

/**
 * AngoStart — Card de produto
 * Imagem ilustrativa (ícone em gradiente), nome, preço em Kz e botão comprar.
 */

import { Star, ShoppingCart, Check, Flame, UserRound, Store } from 'lucide-react';
import { useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import type { Product } from '@/lib/products-data';
import { getProductGradient, PRODUCT_TYPES } from '@/lib/products-data';
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
  // Fase 19: gradiente sempre na paleta azul/roxo/teal — nunca esmeralda da BD
  const safeGradient = getProductGradient(product);
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
    <motion.article
      className="card-premium group flex flex-col overflow-hidden"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.45, ease: [0.21, 0.47, 0.32, 0.98] }}
    >
      {/* Cabeçalho ilustrativo — zoom suave no hover (Fase 18) */}
      <div
        className={`relative flex h-36 items-center justify-center overflow-hidden bg-gradient-to-br transition-transform duration-500 group-hover:scale-[1.04] ${safeGradient}`}
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
          <Badge className="absolute right-3 top-3 animate-pulse border-0 bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg">
            <Flame className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Em alta
          </Badge>
        )}
        {product.featured && !product.is_hot && (
          <Badge className="absolute right-3 top-3 border-0 bg-blue-600 text-white">
            Destaque
          </Badge>
        )}
      </div>

      {/* Conteúdo */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        {/* Fase 11: sem avaliações reais → "Sem avaliações" (nunca um 4.5 falso) */}
        {product.rating != null ? (
          <div className="flex items-center gap-1 text-amber-500">
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
            <span className="text-sm font-semibold text-slate-700">
              {product.rating.toFixed(1)}
            </span>
          </div>
        ) : (
          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-400">
            <Star className="h-3 w-3 text-slate-300" />
            Sem avaliações
          </span>
        )}

        <h3 className="line-clamp-2 text-base font-semibold leading-snug text-slate-900">
          {product.name}
        </h3>

        {product.seller_name && (
          <p className="inline-flex w-fit items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            <UserRound className="h-3 w-3 text-blue-600" />
            {product.seller_name}
            {product.seller_verified && <VerifiedBadge size={12} />}
          </p>
        )}

        <p className="line-clamp-2 text-sm text-slate-500">
          {product.description}
        </p>

        {/* Fase 16 — palavras-chave do produto (busca + IA) como chips, entrada em cascata */}
        {product.keywords && product.keywords.length > 0 && (
          <motion.div
            className="flex flex-wrap gap-1.5"
            aria-label="Palavras-chave do produto"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
          >
            {product.keywords.slice(0, 4).map((kw) => (
              <motion.span
                key={kw}
                className="chip-keyword"
                variants={{ hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0 } }}
              >
                #{kw}
              </motion.span>
            ))}
            {product.keywords.length > 4 && (
              <motion.span
                className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500"
                variants={{ hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0 } }}
              >
                +{product.keywords.length - 4}
              </motion.span>
            )}
          </motion.div>
        )}

        {/* Fase 11 — explorar o vendedor: loja em primeiro lugar; sem loja → portfólio */}
        {(product.store_slug || product.seller_username) && (
          <Link
            href={
              product.store_slug
                ? `/loja/${product.store_slug}`
                : `/portfolio/${product.seller_username ?? ''}`
            }
            className="inline-flex w-fit items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-100"
          >
            <Store className="h-3 w-3" aria-hidden="true" />
            {product.store_slug ? 'Ver loja' : 'Ver vendedor'}
          </Link>
        )}

        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <p className="text-lg font-extrabold tracking-tight text-slate-900">
            {formatKz(product.price_kz)}
          </p>
          <Button
            onClick={handleBuy}
            disabled={outOfStock}
            className="h-10 min-w-0 flex-1 max-w-[150px] bg-gradient-to-r from-blue-600 to-purple-600 px-3 text-white shadow-md shadow-blue-600/25 transition-all hover:shadow-lg hover:brightness-110 active:scale-95 disabled:opacity-50"
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
    </motion.article>
  );
}
