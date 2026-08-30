'use client';

/**
 * AngoStart — Aba «Verificação de Identidade» do admin (Fase 9).
 * Aprovar/rejeitar o BI dos vendedores. Aprovado → selo azul + pode
 * publicar; rejeitado → limpa o BI e obriga a reenvio.
 */

import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { authHeaders } from '@/context/AuthContext';
import { formatDateTime } from '@/lib/format';

interface KycSeller {
  id: number;
  name: string;
  email: string;
  role: string;
  username: string | null;
  telefone: string | null;
  bi_number: string;
  nif_number: string | null;
  kyc_status: string;
  is_verified_bi: boolean;
  bi_document_url: string | null;
  bi_verified_at: string | null;
  created_at: string;
}

export default function AdminKycTab() {
  const { toast } = useToast();
  const [pending, setPending] = useState<KycSeller[]>([]);
  const [verified, setVerified] = useState<KycSeller[]>([]);
  const [semBi, setSemBi] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/kyc', { headers: authHeaders(), cache: 'no-store' });
      const data = (await res.json()) as {
        pending?: KycSeller[];
        verified?: KycSeller[];
        sellers_without_bi?: number;
      };
      if (res.ok) {
        setPending(data.pending ?? []);
        setVerified(data.verified ?? []);
        setSemBi(data.sellers_without_bi ?? 0);
      }
    } catch {
      /* silencioso */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(userId: number, action: 'aprovar' | 'rejeitar') {
    setBusyId(userId);
    try {
      const res = await fetch('/api/admin/kyc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ user_id: userId, action }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({ title: `Não foi possível ${action}`, description: data.error, variant: 'destructive' });
        return;
      }
      toast({
        title: action === 'aprovar' ? 'BI aprovado ✓' : 'BI recusado',
        description:
          action === 'aprovar'
            ? 'O vendedor já tem o selo azul e pode publicar.'
            : 'O vendedor terá de reenviar o documento.',
      });
      load();
    } catch {
      toast({ title: 'Erro de rede', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  }

  const ROLE_LABEL: Record<string, string> = {
    criador: 'Criador',
    prestador_domicilio: 'Prestador ao domicílio',
    prestador_remoto: 'Freelancer remoto',
  };

  const renderSeller = (s: KycSeller, pendente: boolean) => (
    <li key={s.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
            {s.name}
            {!pendente && <BadgeCheck className="h-4 w-4 text-sky-500" />}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {ROLE_LABEL[s.role] ?? s.role} · {s.email}
            {s.telefone ? ` · ${s.telefone}` : ''}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            BI: <span className="font-mono font-semibold">{s.bi_number}</span>
            {s.nif_number ? ` · NIF: ${s.nif_number}` : ''}
          </p>
          <p className="text-xs text-slate-400">
            Conta criada em {formatDateTime(s.created_at)}
            {s.bi_verified_at ? ` · verificada em ${formatDateTime(s.bi_verified_at)}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {s.bi_document_url ? (
            <button
              type="button"
              onClick={() => setPreview(s.bi_document_url)}
              className="group relative"
              aria-label="Ver foto do BI"
            >
              { }
              <img
                src={s.bi_document_url}
                alt={`BI de ${s.name}`}
                className="h-16 w-24 rounded-lg border border-slate-200 object-cover transition group-hover:opacity-80"
              />
              <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-slate-900/0 text-[10px] font-bold text-transparent group-hover:bg-slate-900/40 group-hover:text-white">
                Ampliar
              </span>
            </button>
          ) : (
            <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-400">
              Sem foto submetida
            </span>
          )}
          {pendente && (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busyId === s.id}
                onClick={() => decide(s.id, 'aprovar')}
                className="h-9 bg-emerald-500 font-semibold text-white hover:bg-emerald-600"
              >
                {busyId === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="mr-1 h-4 w-4" />}
                Aprovar
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === s.id}
                onClick={() => decide(s.id, 'rejeitar')}
                className="h-9 border-rose-200 text-rose-600 hover:bg-rose-50"
              >
                <XCircle className="mr-1 h-4 w-4" /> Recusar
              </Button>
            </div>
          )}
        </div>
      </div>
    </li>
  );

  return (
    <section className="mt-6" aria-label="Verificação de identidade">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
          <BadgeCheck className="h-5 w-5 text-sky-500" /> Verificação de Identidade
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={load}
          className="h-9 border-slate-300 text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Atualizar
        </Button>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Vendedores sem BI aprovado não podem publicar novos produtos.{' '}
        {semBi > 0 && `(${semBi} vendedor(es) ainda nem submeteram BI.)`}
      </p>

      {loading ? (
        <p className="flex items-center justify-center py-10 text-sm text-slate-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> A carregar fila de verificação…
        </p>
      ) : (
        <>
          <h3 className="mt-5 text-sm font-bold uppercase tracking-wide text-amber-600">
            Pendentes ({pending.length})
          </h3>
          {pending.length === 0 ? (
            <p className="mt-2 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">
              Sem BIs à espera de validação.
            </p>
          ) : (
            <ul className="mt-2 space-y-3">{pending.map((s) => renderSeller(s, true))}</ul>
          )}

          <h3 className="mt-6 text-sm font-bold uppercase tracking-wide text-sky-600">
            Verificados ({verified.length})
          </h3>
          {verified.length === 0 ? (
            <p className="mt-2 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">
              Ainda nenhum vendedor verificado.
            </p>
          ) : (
            <ul className="mt-2 space-y-3 opacity-90">{verified.map((s) => renderSeller(s, false))}</ul>
          )}
        </>
      )}

      {/* Ampliar foto do BI */}
      {preview && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/70 p-6"
          onClick={() => setPreview(null)}
          role="dialog"
          aria-label="Foto do BI"
        >
          { }
          <img
            src={preview}
            alt="BI ampliado"
            className="max-h-[85dvh] max-w-full rounded-2xl border-4 border-white object-contain shadow-2xl"
          />
        </div>
      )}
    </section>
  );
}
