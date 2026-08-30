'use client';

/**
 * AngoStart — Captura de link de afiliado (Fase 9).
 *
 * Montado no layout: lê ?ref=AFG-XXXXXX do URL (link de afiliado), guarda
 * no localStorage durante 30 dias e limpa o parâmetro do URL. O carrinho
 * lê o código guardado e envia-o na encomenda — o afiliado recebe a
 * comissão quando o pagamento é validado.
 */

import { useEffect } from 'react';

const REF_KEY = 'angostart.ref.v1';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

/** Lê o código de afiliado guardado (para o checkout). */
export function getStoredRefCode(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(REF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { code: string; ts: number };
    if (!parsed?.code || Date.now() - parsed.ts > TTL_MS) {
      window.localStorage.removeItem(REF_KEY);
      return null;
    }
    return parsed.code;
  } catch {
    return null;
  }
}

export default function RefCapture() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get('ref')?.trim().toUpperCase();
      if (ref && /^[A-Z0-9-]{4,20}$/.test(ref)) {
        window.localStorage.setItem(REF_KEY, JSON.stringify({ code: ref, ts: Date.now() }));
        // Limpa ?ref= do URL sem recarregar (mantém o resto dos parâmetros)
        params.delete('ref');
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
