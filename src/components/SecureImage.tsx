'use client';

/**
 * AngoStart — Imagem PRIVADA autenticada (Fase 12).
 *
 * Documentos KYC são servidos por GET /api/kyc/document/[...path], que
 * exige Bearer JWT — mas tags <img src> não conseguem enviar headers.
 * Solução: fetch com authHeaders() → Blob → objectURL temporário
 * (revogado no unmount). Nada fica em cache partilhada/CDN.
 */

import { useEffect, useState } from 'react';
import { FileWarning, Loader2 } from 'lucide-react';
import { authHeaders } from '@/context/AuthContext';

export default function SecureImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let active = true;

    (async () => {
      try {
        const res = await fetch(src, { headers: authHeaders(), cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (active) {
          setUrl(objectUrl);
          setFailed(false);
        } else {
          URL.revokeObjectURL(objectUrl);
        }
      } catch {
        if (active) setFailed(true);
      }
    })();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (failed) {
    return (
      <span
        className={`flex items-center justify-center gap-1.5 rounded-lg bg-slate-100 text-xs text-slate-400 ${className ?? ''}`}
        role="img"
        aria-label={`${alt} (indisponível)`}
      >
        <FileWarning className="h-4 w-4" /> indisponível
      </span>
    );
  }

  if (!url) {
    return (
      <span
        className={`flex items-center justify-center rounded-lg bg-slate-100 ${className ?? ''}`}
        role="status"
        aria-label={`${alt} (a carregar)`}
      >
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      </span>
    );
  }

   
  return <img src={url} alt={alt} className={className} />;
}
