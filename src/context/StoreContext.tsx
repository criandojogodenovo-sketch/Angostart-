'use client';

/**
 * AngoStart — Estado global (React Context)
 *
 * - CartContext: carrinho de compras persistido em localStorage
 * - SearchContext: pesquisa global partilhada entre Navbar e Catálogo
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Product } from '@/lib/products-data';

/* ─────────────────────────── Carrinho ─────────────────────────── */

export interface CartItem {
  product: Product;
  quantity: number;
}

interface CartContextValue {
  items: CartItem[];
  count: number;
  totalKz: number;
  isReady: boolean;
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: number) => void;
  setQuantity: (productId: number, quantity: number) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

const CART_STORAGE_KEY = 'angostart.cart.v1';

function readCartFromStorage(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CartItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) => item && item.product && typeof item.product.id === 'number'
    );
  } catch {
    return [];
  }
}

function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Hidratação do carrinho a partir do localStorage (evita mismatch SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(readCartFromStorage());
     
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isReady) return;
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* armazenamento indisponível — ignora */
    }
  }, [items, isReady]);

  const addItem = useCallback((product: Product, quantity = 1) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.product.id === product.id
            ? { ...i, quantity: i.quantity + quantity }
            : i
        );
      }
      return [...prev, { product, quantity }];
    });
  }, []);

  const removeItem = useCallback((productId: number) => {
    setItems((prev) => prev.filter((i) => i.product.id !== productId));
  }, []);

  const setQuantity = useCallback((productId: number, quantity: number) => {
    setItems((prev) => {
      if (quantity <= 0) {
        return prev.filter((i) => i.product.id !== productId);
      }
      return prev.map((i) =>
        i.product.id === productId ? { ...i, quantity } : i
      );
    });
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const value = useMemo<CartContextValue>(() => {
    const count = items.reduce((acc, i) => acc + i.quantity, 0);
    const totalKz = items.reduce(
      (acc, i) => acc + i.quantity * i.product.price_kz,
      0
    );
    return { items, count, totalKz, isReady, addItem, removeItem, setQuantity, clearCart };
  }, [items, isReady, addItem, removeItem, setQuantity, clearCart]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/* ─────────────────────────── Pesquisa ─────────────────────────── */

interface SearchContextValue {
  query: string;
  setQuery: (value: string) => void;
}

const SearchContext = createContext<SearchContextValue | null>(null);

function SearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('');
  const value = useMemo(() => ({ query, setQuery }), [query]);
  return (
    <SearchContext.Provider value={value}>{children}</SearchContext.Provider>
  );
}

/* ───────────────────────── Provider raiz ──────────────────────── */

export function StoreProvider({ children }: { children: ReactNode }) {
  return (
    <CartProvider>
      <SearchProvider>{children}</SearchProvider>
    </CartProvider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart deve ser usado dentro de <StoreProvider>');
  return ctx;
}

export function useSearch(): SearchContextValue {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearch deve ser usado dentro de <StoreProvider>');
  return ctx;
}
