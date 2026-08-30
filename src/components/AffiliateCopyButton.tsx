'use client';

/**
 * AngoStart — Botão "Copiar link de afiliado" (Fase 11).
 *
 * Componente reutilizável: gera `<origem><path>?ref=AFG-XXXXXX` com o
 * código do afiliado autenticado (cache partilhada — só 1 pedido
 * /api/affiliate por página) e copia para a área de transferência.
 *
 * Usado na página da loja (/loja/[slug]) e reutilizável noutros alvos
 * (produto já tem o seu; o painel do afiliado tem o gerador em massa).
 *
 * Estados:
 *  - visitante → aviso "Entra na tua conta"
 *  - autenticado sem adesão → aviso com como aderir (404 da API)
 *  - afiliado → copia o link com o seu código
 */

import { useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth, authHeaders } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';

/* Cache partilhada do código de afiliado entre todas as instâncias do
   botão na mesma página — evita N pedidos a /api/affiliate. */
let cachedCode: string | null | undefined; // undefined = ainda não pedido
let inflight: Promise<string | null> | null = null;

async function fetchAffiliateCode(): Promise<string | null> {
  if (cachedCode !== undefined) return cachedCode;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch('/api/affiliate', {
        headers: authHeaders(),
        cache: 'no-store',
      });
      if (!res.ok) {
        cachedCode = null;
        return null;
      }
      const data = (await res.json()) as { codigo_afiliado?: string };
      cachedCode = data.codigo_afiliado ?? null;
      return cachedCode;
    } catch {
      cachedCode = null;
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export default function AffiliateCopyButton({
  path,
  label = 'Copiar link de afiliado',
  className = '',
}: {
  /** Caminho do alvo a divulgar (ex.: '/loja/minha-loja' ou '/produtos/5'). */
  path: string;
  label?: string;
  className?: string;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;

    if (!user) {
      toast({
        title: 'Entra na tua conta',
        description: 'Precisas de sessão num programa de afiliados para copiar o link.',
      });
      return;
    }

    setBusy(true);
    try {
      const code = await fetchAffiliateCode();
      if (!code) {
        toast({
          title: 'Ainda não és afiliado',
          description:
            'Adere ao programa de afiliados no teu painel para ganhares comissões com os teus links.',
        });
        return;
      }

      const link = `${window.location.origin}${path}?ref=${code}`;
      await navigator.clipboard?.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      toast({ title: 'Link de afiliado copiado!', description: link });
    } catch {
      toast({
        title: 'Não foi possível copiar',
        description: 'Copia manualmente o endereço da página e acrescenta ?ref=TEUCODIGO.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      onClick={handleClick}
      disabled={busy}
      variant="outline"
      className={`h-10 border-amber-400 text-amber-700 hover:bg-amber-50 ${className}`}
      aria-label={label}
    >
      {busy ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : copied ? (
        <Check className="mr-2 h-4 w-4" />
      ) : (
        <Copy className="mr-2 h-4 w-4" />
      )}
      {copied ? 'Copiado!' : label}
    </Button>
  );
}
