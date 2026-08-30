'use client';

/**
 * AngoStart — Botão «Seguir» de loja (Fase 9).
 * Toggle autenticado via POST /api/stores/follow. Convida a entrar
 * quando não há sessão.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authHeaders, getToken } from '@/context/AuthContext';

interface Props {
  storeId: number;
  /** Estado inicial (renderizado no servidor) — opcional. */
  following?: boolean;
}

export default function StoreFollowButton({ storeId, following = false }: Props) {
  const [isFollowing, setIsFollowing] = useState(following);
  const [loading, setLoading] = useState(false);
  const [logged, setLogged] = useState<boolean | null>(null);

  useEffect(() => {
    setLogged(Boolean(getToken()));
  }, []);

  if (logged === false) {
    return (
      <Link
        href="/perfil"
        className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700"
      >
        Entrar para seguir
      </Link>
    );
  }

  const toggle = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/stores/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ store_id: storeId }),
      });
      const data = (await res.json()) as { following?: boolean; error?: string };
      if (res.ok && typeof data.following === 'boolean') {
        setIsFollowing(data.following);
      }
    } catch {
      /* silencioso — botão mantém estado */
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition disabled:opacity-60 ${
        isFollowing
          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300 hover:bg-emerald-100'
          : 'bg-emerald-600 text-white hover:bg-emerald-700'
      }`}
    >
      {isFollowing ? '✓ A seguir' : '+ Seguir loja'}
    </button>
  );
}
