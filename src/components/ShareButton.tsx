'use client';

/**
 * AngoStart — Botão "Copiar link" (partilha pública).
 *
 * ⚠️ Diferença do link de afiliado (Fase 11/17): este botão copia o URL
 * público LIMPO do produto/serviço/espaço — sem `?ref=` e sem tracking
 * de comissão — e está disponível para QUALQUER pessoa (visitante,
 * cliente, vendedor ou afiliado).
 *
 * Comportamento (spec):
 *  1. Copia o URL público para a área de transferência.
 *  2. Ícone Share2 → Check durante 2 segundos.
 *  3. Toast: «Link copiado! Partilha com os teus clientes.»
 *
 * O URL é normalizado para absoluto (window.location.origin) para que,
 * colado fora da app (WhatsApp, redes sociais), abra a página certa.
 */

import { useEffect, useRef, useState } from 'react';
import { Check, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

/** Converte caminho relativo em URL absoluto (o link tem de abrir fora da app). */
function toAbsoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://angostart.vercel.app';
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** Copia com navigator.clipboard e fallback legacy (webviews/http antigo). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* segue para o fallback */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function ShareButton({
  productUrl,
  label = 'Copiar link',
  compact = false,
  className = '',
}: {
  /** URL público do alvo — caminho relativo (ex.: '/produtos/5') ou absoluto. */
  productUrl: string;
  /** Texto do botão (modo normal). */
  label?: string;
  /** Modo compacto: só o ícone — para usar dentro de cards. */
  compact?: boolean;
  className?: string;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  /* Limpeza do temporizador se o componente desmontar (ex.: filtro de catálogo). */
  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation(); // segurança extra quando o botão vive sobre um card clicável
    const url = toAbsoluteUrl(productUrl);
    const ok = await copyText(url);
    if (ok) {
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
      toast({
        title: 'Link copiado! Partilha com os teus clientes.',
        description: url,
      });
    } else {
      toast({
        title: 'Não foi possível copiar',
        description: 'Copia manualmente o endereço da página.',
        variant: 'destructive',
      });
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={`${label} — partilhar publicamente`}
        title={copied ? 'Link copiado!' : label}
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-white/95 text-blue-600 shadow-sm backdrop-blur-sm transition-all hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 active:scale-90',
          className
        )}
      >
        {copied ? (
          <Check className="h-4 w-4 text-teal-600" />
        ) : (
          <Share2 className="h-4 w-4" />
        )}
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleClick}
      aria-label={label}
      className={cn(
        'h-10 border-blue-400 text-blue-700 hover:bg-blue-50',
        className
      )}
    >
      {copied ? (
        <Check className="mr-2 h-4 w-4 text-teal-600" />
      ) : (
        <Share2 className="mr-2 h-4 w-4" />
      )}
      {copied ? 'Copiado!' : label}
    </Button>
  );
}
