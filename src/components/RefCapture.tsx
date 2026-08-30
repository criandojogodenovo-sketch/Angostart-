'use client';

/**
 * AngoStart — Captura de link de afiliado (Fase 9 + Fase 10).
 *
 * Montado no layout: lê ?ref=AFG-XXXXXX (e ?sub=campanha — Fase 10) do
 * URL, guarda no localStorage durante 30 dias (janela configurável via
 * NEXT_PUBLIC_AFFILIATE_ATTRIBUTION_DAYS — modelo Amazon/Shopee) e limpa
 * os parâmetros do URL. O carrinho lê o código guardado e envia-o na
 * encomenda (com o Sub-ID) — o afiliado recebe a comissão quando o
 * pagamento é validado, até 30 dias depois do clique.
 */

import { useEffect } from 'react';
import { DEFAULT_AFFILIATE_ATTRIBUTION_DAYS } from '@/lib/config';

const REF_KEY = 'angostart.ref.v1';

/**
 * Janela de atribuição (dias). No cliente, só NEXT_PUBLIC_* está visível —
 * para mudar a janela em produção define essa variável na Vercel.
 */
export const REF_ATTRIBUTION_DAYS = Number(
  process.env.NEXT_PUBLIC_AFFILIATE_ATTRIBUTION_DAYS
) > 0
  ? Math.floor(Number(process.env.NEXT_PUBLIC_AFFILIATE_ATTRIBUTION_DAYS))
  : DEFAULT_AFFILIATE_ATTRIBUTION_DAYS;

const TTL_MS = REF_ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000;

export interface StoredRefData {
  /** Código de afiliado (ex.: AFG-3K9PQX). */
  code: string;
  /** Canal/campanha do link (ex.: instagram) — Fase 10; null se ausente. */
  sub: string | null;
  ts: number;
}

/** Lê o código (e Sub-ID) de afiliado guardado (para o checkout). */
export function getStoredRefData(): StoredRefData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(REF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredRefData> | null;
    const ts = typeof parsed?.ts === 'number' ? parsed.ts : 0;
    if (!parsed?.code || Date.now() - ts > TTL_MS) {
      window.localStorage.removeItem(REF_KEY);
      return null;
    }
    return {
      code: parsed.code,
      sub: typeof parsed.sub === 'string' && parsed.sub ? parsed.sub : null,
      ts,
    };
  } catch {
    return null;
  }
}

/** Compatibilidade (Fase 9): só o código de afiliado. */
export function getStoredRefCode(): string | null {
  return getStoredRefData()?.code ?? null;
}

export default function RefCapture() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get('ref')?.trim().toUpperCase();
      const subRaw = params.get('sub')?.trim().toLowerCase() ?? '';
      const sub = /^[a-z0-9_-]{1,30}$/.test(subRaw) ? subRaw : null;
      if (ref && /^[A-Z0-9-]{4,20}$/.test(ref)) {
        window.localStorage.setItem(
          REF_KEY,
          JSON.stringify({ code: ref, sub, ts: Date.now() } satisfies StoredRefData)
        );
        // Limpa ?ref= e ?sub= do URL sem recarregar (mantém o resto)
        params.delete('ref');
        params.delete('sub');
        const qs = params.toString();
        const cleanUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
        window.history.replaceState(null, '', cleanUrl);
      }
    } catch {
      /* armazenamento indisponível — ignora */
    }
  }, []);

  return null;
}
