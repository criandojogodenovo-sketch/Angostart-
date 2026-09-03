'use client';

/**
 * AngoStart — Card de produto (Fase 20 — redesign premium).
 *
 * Referências (Nexora/Stufffus/Aeroflow): visual grande com zoom no
 * hover, badge de categoria, preço em destaque e clique na imagem abre
 * um modal com ZOOM suave (transição scale + fade). A lógica de negócio
 * (carrinho, toast, partilha, loja) não foi alterada.
 */

import { Star, ShoppingCart, Check, Flame, UserRound, Store, ZoomIn, ArrowRight } from 'lucide-react';
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
import ShareButton from '@/components/ShareButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';

export default function ProductCard({ product }: { product: Product }) {
  const { addItem } = useCart();
  const { toast } = useToast();
  const [added, setAdded] = useState(false);
  const [zoom, setZoom] = useState(false);

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
      className="card-premium group flex flex-col overflow-hidden hover:scale-[1.02] hover:border-blue-200/80"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.45, ease: [0.21, 0.47, 0.32, 0.98] }}
    >
      {/* Cabeçalho ilustrativo — clique abre o modal com zoom (Fase 20) */}
      <button
        type="button"
        onClick={() => setZoom(true)}
        aria-label={`Ampliar imagem de ${product.name}`}
        className={`relative flex h-44 w-full cursor-zoom-in items-center justify-center overflow-hidden bg-gradient-to-br transition-transform duration-500 group-hover:scale-[1.05] ${safeGradient}`}
      >
        {/* Brilho radial suave atrás do ícone (ref. Nexora) */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute h-32 w-32 rounded-full bg-white/15 blur-2xl transition-all duration-500 group-hover:h-40 group-hover:w-40"
        />
        <ProductIcon
          name={product.icon}
          className="relative h-16 w-16 text-white/90 drop-shadow-lg transition-transform duration-300 group-hover:scale-110"
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
        {/* Dica de zoom — aparece no hover (ref. Aeroflow: «Main view») */}
        <span className="absolute bottom-3 right-3 flex h-8 w-8 translate-y-2 items-center justify-center rounded-full bg-white/90 text-blue-600 opacity-0 shadow-md transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <ZoomIn className="h-4 w-4" />
        </span>
      </button>

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
          {/* Preço em destaque (ref. Nexora/Aeroflow) */}
          <p className="bg-gradient-to-r from-blue-700 to-purple-700 bg-clip-text text-xl font-extrabold tracking-tight text-transparent">
            {formatKz(product.price_kz)}
          </p>
          {/* Partilha pública — link limpo sem ?ref= (para qualquer utilizador) */}
          <ShareButton
            productUrl={`/produtos/${product.id}`}
            compact
            className="h-10 w-10"
          />
          <Button
            onClick={handleBuy}
            disabled={outOfStock}
            className="btn-shine h-10 min-w-0 flex-1 max-w-[150px] bg-gradient-to-r from-blue-600 to-purple-600 px-3 text-white shadow-md shadow-blue-600/25 transition-all hover:shadow-lg hover:brightness-110 active:scale-95 disabled:opacity-50"
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

      {/* ── Modal com ZOOM (Fase 20) — transição suave de escala ── */}
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-3xl p-0 sm:max-w-md">
          <DialogTitle className="sr-only">{product.name}</DialogTitle>
          <div
            className={`relative flex h-64 items-center justify-center overflow-hidden bg-gradient-to-br ${safeGradient}`}
          >
            <motion.span
              aria-hidden="true"
              className="pointer-events-none absolute h-44 w-44 rounded-full bg-white/15 blur-3xl"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1.1, opacity: 1 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
            <motion.div
              initial={{ scale: 0.5, opacity: 0, rotate: -6 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 18 }}
            >
              <ProductIcon
                name={product.icon}
                className="h-28 w-28 text-white drop-shadow-2xl"
              />
            </motion.div>
            <Badge
              className="absolute left-4 top-4 border-0 bg-white/20 text-white backdrop-blur-sm"
              variant="secondary"
            >
              {typeInfo.short}
            </Badge>
          </div>
          <div className="space-y-3 p-5">
            <h3 className="text-lg font-bold text-slate-900">{product.name}</h3>
            {product.description && (
              <p className="text-sm leading-relaxed text-slate-600">
                {product.description}
              </p>
            )}
            <p className="bg-gradient-to-r from-blue-700 to-purple-700 bg-clip-text text-2xl font-extrabold text-transparent">
              {formatKz(product.price_kz)}
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                onClick={handleBuy}
                disabled={outOfStock}
                className="btn-shine h-11 flex-1 bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-md shadow-blue-600/25 active:scale-95"
              >
                <ShoppingCart className="mr-2 h-4 w-4" />
                {outOfStock ? 'Esgotado' : 'Comprar agora'}
              </Button>
              <Button asChild variant="outline" className="h-11">
                <Link href={`/produtos/${product.id}`}>
                  Detalhes
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </motion.article>
  );
}
