'use client';

/**
 * AngoStart — Botão "Copiar link de afiliado" (Fase 11, refinado na Fase 17).
 *
 * Componente reutilizável: gera `<origem><path>?ref=AFG-XXXXXX` com o
 * código do afiliado autenticado e copia para a área de transferência.
 *
 * Fase 17 (visibilidade): o botão só é RENDERIZADO para utilizadores
 * autenticados que são afiliados com código ativo (GET /api/affiliate
 * → 200 com codigo_afiliado). Visitantes e não-afiliados NÃO veem o
 * botão nas páginas de produto, loja, carrinho e painel — antes ele
 * aparecia para todos e só mostrava um aviso ao clicar.
 *
 * Cache: por ID de utilizador (antes era global — ao sair e entrar com
 * outra conta, o código antigo podia "fugir" para o utilizador novo).
 * A cache limpa-se também no logout (user.id → undefined).
 */

import { useEffect, useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth, authHeaders } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';

/* Cache partilhada do código de afiliado entre todas as instâncias do
   botão na mesma página — evita N pedidos a /api/affiliate.
   Chave = id do utilizador (null = visitante / cache invalidada). */
const codeCache = new Map<number | null, string | null>();
let inflight: { key: number | null; promise: Promise<string | null> } | null = null;

function invalidateAffiliateCache() {
  codeCache.clear();
  inflight = null;
}

async function fetchAffiliateCode(userId: number | null): Promise<string | null> {
  if (codeCache.has(userId)) return codeCache.get(userId) ?? null;
  if (inflight && inflight.key === userId) return inflight.promise;

  const promise = (async () => {
    try {
      if (userId === null) return null;
      const res = await fetch('/api/affiliate', {
        headers: authHeaders(),
        cache: 'no-store',
      });
      if (!res.ok) {
        codeCache.set(userId, null);
        return null;
      }
      const data = (await res.json()) as { codigo_afiliado?: string };
      const code = data.codigo_afiliado ?? null;
      codeCache.set(userId, code);
      return code;
    } catch {
      codeCache.set(userId, null);
      return null;
    } finally {
      inflight = null;
    }
  })();

  inflight = { key: userId, promise };
  return promise;
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
  const [code, setCode] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  /* Fase 17: resolve a elegibilidade assim que há utilizador.
     Sem utilizador → nem pergunta (visitante não vê o botão). */
  useEffect(() => {
    let cancelled = false;
    if (!user) {
      invalidateAffiliateCache();
      setCode(null);
      setChecked(true);
      return;
    }
    setChecked(false);
    fetchAffiliateCode(user.id).then((c) => {
      if (!cancelled) {
        setCode(c);
        setChecked(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user, user?.id]);

  async function handleClick() {
    if (busy || !code) return;
    setBusy(true);
    try {
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

  /* Fase 17: ENQUANTO verifica, não mostra nada (evita «flash» do botão
     para não-afiliados). Só afiliados com código ativo veem o botão. */
  if (!user || !checked) return null;
  if (!code) return null;

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
