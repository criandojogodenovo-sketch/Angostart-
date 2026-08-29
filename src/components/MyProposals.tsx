'use client';

/**
 * AngoStart — Minhas propostas enviadas (Fase 7).
 * O cliente acompanha a negociação, vê o histórico de contrapropostas e
 * aceita os termos acordados (gera pedido) ou responde com nova oferta.
 */

import { useCallback, useEffect, useState } from 'react';
import { Handshake, History, Loader2 } from 'lucide-react';
import { authHeaders } from '@/context/AuthContext';
import { formatKz } from '@/lib/format';
import { useToast } from '@/hooks/use-toast';

interface MyProposal {
  id: number;
  service_name: string | null;
  service_price: number;
  description: string;
  price_kz: number;
  deadline_days: number | null;
  status: string;
  updated_at: string;
  order_id: number | null;
  my_offer_standing: boolean;
  provider_name: string | null;
  rounds: number;
}

interface CounterEntry {
  id: number;
  price_kz: number;
  deadline_days: number | null;
  message: string | null;
  created_at: string;
  author_name: string | null;
  by_me: boolean;
}

export default function MyProposals() {
  const { toast } = useToast();
  const [proposals, setProposals] = useState<MyProposal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [counterFor, setCounterFor] = useState<number | null>(null);
  const [price, setPrice] = useState('');
  const [deadline, setDeadline] = useState('');
  const [history, setHistory] = useState<{ id: number; entries: CounterEntry[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/proposals?scope=enviadas', { headers: authHeaders() });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { proposals?: MyProposal[] };
      setProposals(data.proposals ?? []);
    } catch {
      setProposals([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function respond(id: number, action: 'aceite' | 'recusada' | 'cancelada') {
    if (busyId !== null) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/proposals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; order_id?: number };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível responder', description: data.error });
        return;
      }
      toast({
        title:
          action === 'aceite'
            ? `Proposta aceite ✓ — pedido #${data.order_id} criado`
            : action === 'recusada'
              ? 'Proposta recusada'
              : 'Proposta cancelada',
        description:
          action === 'aceite'
            ? 'Paga via KWiK na secção de encomendas para garantir o negócio.'
            : undefined,
      });
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function sendCounter(id: number) {
    if (busyId !== null) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/proposals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          action: 'contrapropor',
          price_kz: Number(price.replace(/[^\d]/g, '')),
          deadline_days: deadline.length > 0 ? Number(deadline.replace(/[^\d]/g, '')) : undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível contrapropor', description: data.error });
        return;
      }
      toast({ title: 'Contraproposta enviada ✓', description: 'O vendedor foi notificado.' });
      setCounterFor(null);
      setPrice('');
      setDeadline('');
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function openHistory(id: number) {
    if (history?.id === id) {
      setHistory(null);
      return;
    }
    try {
      const res = await fetch(`/api/proposals/${id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { history?: CounterEntry[] };
      setHistory({ id, entries: data.history ?? [] });
    } catch {
      toast({ title: 'Não foi possível carregar o histórico.' });
    }
  }

  if (!loaded) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
      </div>
    );
  }

  return (
    <section aria-label="Minhas propostas" className="mt-10">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
        <Handshake className="h-5 w-5 text-emerald-500" /> Minhas propostas
      </h2>
      {proposals.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-6 text-center text-sm text-slate-400">
          Ainda não enviaste propostas — abre um produto ou serviço e negocia preço e prazo.
        </p>
      ) : (
        <ul className="space-y-3">
          {proposals.map((p) => (
            <li key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">
                  {p.service_name} · {p.provider_name ?? 'Vendedor'}
                </p>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    p.status === 'pendente'
                      ? 'bg-amber-100 text-amber-700'
                      : p.status === 'aceite'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {p.status}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-slate-600">{p.description}</p>
              <p className="mt-1 text-xs text-slate-400">
                Oferta atual: <strong className="text-emerald-700">{formatKz(p.price_kz)}</strong>
                {p.deadline_days ? ` · prazo ${p.deadline_days} dias` : ''} · preço de tabela{' '}
                {formatKz(p.service_price)}
                {p.order_id ? ` · pedido #${p.order_id}` : ''}
              </p>

              {history?.id === p.id && (
                <ol className="mt-2 space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  {history.entries.map((h) => (
                    <li key={h.id} className="text-xs text-slate-600">
                      <span className={h.by_me ? 'font-semibold text-emerald-700' : 'font-semibold'}>
                        {h.author_name ?? 'Parte'} ofereceu {formatKz(h.price_kz)}
                        {h.deadline_days ? ` · ${h.deadline_days} dias` : ''}
                      </span>
                      {h.message ? <span> — “{h.message.slice(0, 140)}”</span> : null}
                    </li>
                  ))}
                </ol>
              )}

              {counterFor === p.id && (
                <div className="mt-2 space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      value={price}
                      onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ''))}
                      inputMode="numeric"
                      placeholder={`Preço em Kz (atual: ${p.price_kz})`}
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-400"
                    />
                    <input
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value.replace(/[^\d]/g, ''))}
                      inputMode="numeric"
                      placeholder="Prazo em dias (opcional)"
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-400"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => sendCounter(p.id)}
                      disabled={busyId === p.id || price.length === 0}
                      className="inline-flex h-8 items-center rounded-lg bg-emerald-500 px-3 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                    >
                      Enviar contraproposta
                    </button>
                    <button
                      type="button"
                      onClick={() => setCounterFor(null)}
                      className="inline-flex h-8 items-center rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {p.status === 'pendente' && counterFor !== p.id && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {p.my_offer_standing ? (
                    <span className="inline-flex h-8 items-center rounded-lg bg-slate-100 px-3 text-xs font-medium text-slate-500">
                      Aguarda a resposta do vendedor
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => respond(p.id, 'aceite')}
                        disabled={busyId === p.id}
                        className="inline-flex h-8 items-center rounded-lg bg-emerald-500 px-3 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                      >
                        Aceitar e gerar pedido
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCounterFor(p.id);
                          setPrice(String(p.price_kz));
                        }}
                        disabled={busyId === p.id}
                        className="inline-flex h-8 items-center rounded-lg bg-violet-500 px-3 text-xs font-semibold text-white hover:bg-violet-600 disabled:opacity-50"
                      >
                        Contrapropor
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => respond(p.id, 'cancelada')}
                    disabled={busyId === p.id}
                    className="inline-flex h-8 items-center rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => openHistory(p.id)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                  >
                    <History className="h-3.5 w-3.5" />
                    {history?.id === p.id ? 'Esconder' : 'Histórico'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
