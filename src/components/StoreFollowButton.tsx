'use client';

/**
 * AngoStart — Botão «Seguir» de loja (Fase 9, corrigido na Fase 19b).
 *
 * Correções Fase 19b (bug «botão não responde»):
 * - Sincroniza o estado real no cliente via GET /api/stores/follow?store_id=X
 *   (o servidor não conhece o visitante — token vive no localStorage — por isso
 *   quem já via o «+ Seguir loja» podia já estar a seguir).
 * - Feedback visual completo: «A seguir…» durante o pedido, toast de sucesso/
 *   erro (o erro antes era silencioso — ex.: dono a seguir a própria loja).
 * - Dono da loja vê «É a tua loja» em vez de um botão que não faz nada.
 * - Sem sessão → «Entrar para seguir» (mantido).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, Store } from 'lucide-react';
import { authHeaders, getToken } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';

interface Props {
  storeId: number;
  /** Estado inicial (renderizado no servidor) — opcional. */
  following?: boolean;
}

export default function StoreFollowButton({ storeId, following = false }: Props) {
  const [isFollowing, setIsFollowing] = useState(following);
  const [loading, setLoading] = useState(false);
  const [ownStore, setOwnStore] = useState(false);
  const [logged, setLogged] = useState<boolean | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const hasToken = Boolean(getToken());
    setLogged(hasToken);
    if (!hasToken) return;

    /* Fase 19b: sincroniza o estado real (o servidor não sabe quem visita). */
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/stores/follow?store_id=${storeId}`,
          { headers: authHeaders() }
        );
        if (!res.ok) return; // 401/erro → mantém o estado recebido
        const data = (await res.json()) as {
          following?: boolean;
          own_store?: boolean;
        };
        if (cancelled) return;
        if (data.own_store) setOwnStore(true);
        else if (typeof data.following === 'boolean') setIsFollowing(data.following);
      } catch {
        /* silencioso — mantém o estado inicial */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

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

  /* Dono da loja — não existe ação de «seguir» para ele (era um clique morto). */
  if (ownStore) {
    return (
      <span
        aria-label="Esta loja é tua"
        className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-5 py-2.5 text-sm font-bold text-slate-600"
      >
        <Store className="h-4 w-4 text-blue-600" />
        É a tua loja
      </span>
    );
  }

  const toggle = async () => {
    if (loading) return;
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
        toast({
          title: data.following ? 'Agora segues esta loja ✓' : 'Deixaste de seguir',
          description: data.following
            ? 'Recebes notificações de novos produtos da loja.'
            : 'Já não recebes novidades desta loja.',
        });
      } else {
        toast({
          title: 'Não foi possível seguir',
          description: data.error ?? 'Tenta novamente em instantes.',
          variant: 'destructive',
        });
      }
    } catch {
      toast({
        title: 'Sem ligação',
        description: 'Verifica a internet e tenta de novo.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={loading}
      aria-pressed={isFollowing}
      className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition disabled:opacity-60 ${
        isFollowing
          ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-300 hover:bg-blue-100'
          : 'bg-blue-600 text-white hover:bg-blue-700'
      }`}
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          A seguir…
        </>
      ) : isFollowing ? (
        <>
          <Check className="h-4 w-4" />
          A seguir
        </>
      ) : (
        '+ Seguir loja'
      )}
    </button>
  );
}
