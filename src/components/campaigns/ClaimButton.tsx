'use client';

/**
 * GOMBUONE — Claim (resgate) de uma oportunidade.
 *
 * Botão «Resgatar código» na página da campanha:
 *  1. Lê o código/sub do link de afiliado guardado (RefCapture, 30 dias)
 *     e envia-o no claim → atribui a distribuição a quem partilhou.
 *  2. POST /api/oportunidades/[id]/resgatar (idempotente — o servidor
 *     devolve o MESMO código ativo se o consumidor já o tinha).
 *  3. Mostra o código GMB-XXXXXX em destaque com botão de copiar e
 *     a data/hora de expiração.
 */

import { useState } from 'react';
import { Check, Copy, Loader2, Ticket, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getStoredRefData } from '@/components/RefCapture';
import { useToast } from '@/hooks/use-toast';

interface ClaimResponse {
  ok?: boolean;
  code?: string;
  expires_at?: string;
  reused?: boolean;
  message?: string;
  error?: string;
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-PT', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ClaimButton({ opportunityId }: { opportunityId: number }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState<{ code: string; expires_at: string; reused: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleClaim() {
    if (busy || claimed) return;
    setBusy(true);
    try {
      /* Atribuição: envia o ref/sub guardado pelo RefCapture (?ref=AFG-…). */
      const ref = getStoredRefData();
      const res = await fetch(`/api/oportunidades/${opportunityId}/resgatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          affiliate_code: ref?.code ?? null,
          affiliate_sub_id: ref?.sub ?? null,
        }),
      });
      const data = (await res.json()) as ClaimResponse;
      if (!res.ok || !data.ok || !data.code) {
        toast({
          title: 'Não foi possível resgatar',
          description: data.error ?? 'Tenta novamente em alguns instantes.',
          variant: 'destructive',
        });
        return;
      }
      setClaimed({
        code: data.code,
        expires_at: data.expires_at ?? '',
        reused: Boolean(data.reused),
      });
      toast({
        title: data.reused ? 'Este é o teu código ativo' : 'Código emitido!',
        description: data.message ?? 'Apresenta-o na loja para validar a tua vantagem.',
      });
    } catch {
      toast({
        title: 'Erro de ligação',
        description: 'Verifica a tua internet e tenta novamente.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!claimed) return;
    try {
      await navigator.clipboard?.writeText(claimed.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: 'Não foi possível copiar',
        description: 'Seleciona e copia o código manualmente.',
        variant: 'destructive',
      });
    }
  }

  if (claimed) {
    return (
      <div
        className="rounded-2xl border border-teal-200 bg-teal-50 p-4"
        role="status"
        aria-live="polite"
      >
        <p className="flex items-center gap-1.5 text-xs font-semibold text-teal-700">
          <Ticket className="h-4 w-4" aria-hidden="true" />
          {claimed.reused ? 'O teu código ativo desta oportunidade' : 'O teu código de redemption'}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <code className="select-all rounded-xl bg-white px-4 py-2.5 text-lg font-extrabold tracking-widest text-teal-800 shadow-sm">
            {claimed.code}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="border-teal-300 text-teal-700 hover:bg-teal-100"
            aria-label="Copiar código"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copiado!' : 'Copiar'}
          </Button>
        </div>
        {claimed.expires_at && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-teal-600">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            Válido até {formatExpiry(claimed.expires_at)} — apresenta-o na loja antes de expirar.
          </p>
        )}
      </div>
    );
  }

  return (
    <Button
      type="button"
      onClick={handleClaim}
      disabled={busy}
      className="h-11 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-6 text-sm font-semibold text-white shadow-md hover:from-blue-700 hover:to-purple-700"
      aria-label="Resgatar código desta oportunidade"
    >
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ticket className="mr-2 h-4 w-4" />}
      Resgatar código
    </Button>
  );
}
