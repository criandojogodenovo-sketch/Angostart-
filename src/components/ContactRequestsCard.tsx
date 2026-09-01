'use client';

/**
 * AngoStart — Cartão «Contactos» (Fase 16, fluxo Airbnb).
 *
 * mode="recebidos" (prestador): pedidos de clientes com Aceitar / Rejeitar.
 * mode="enviados"  (cliente): estado dos pedidos enviados — após aceite,
 *   botões «Ir para Chat» / «Descartar».
 *
 * 🔒 Privacidade: nenhum contacto direto é exposto — tudo via chat interno
 * e a localização exata só após pagamento.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Ban,
  CheckCircle2,
  Clock,
  Inbox,
  Loader2,
  MessageCircle,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { authHeaders } from '@/context/AuthContext';

interface ContactRequest {
  id: number;
  client_id: number;
  provider_id: number;
  product_id: number | null;
  message: string | null;
  status: 'pendente' | 'aceite' | 'recusada' | 'cancelada';
  conversation_id: number | null;
  created_at: string;
  answered_at: string | null;
  client_name: string | null;
  provider_name: string | null;
  product_name: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  pendente: 'bg-amber-50 text-amber-700 ring-amber-200',
  aceite: 'bg-teal-50 text-teal-700 ring-teal-200',
  recusada: 'bg-rose-50 text-rose-600 ring-rose-200',
  cancelada: 'bg-slate-100 text-slate-500 ring-slate-200',
};

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  aceite: 'Aceite',
  recusada: 'Recusado',
  cancelada: 'Descartado',
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} dia${days > 1 ? 's' : ''}`;
}

export default function ContactRequestsCard({ mode }: { mode: 'recebidos' | 'enviados' }) {
  const { toast } = useToast();
  const [items, setItems] = useState<ContactRequest[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [startingChatId, setStartingChatId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = mode === 'recebidos' ? 'recebidos=1' : 'enviados=1';
      const res = await fetch(`/api/contact-requests?${qs}`, {
        headers: authHeaders(),
        cache: 'no-store',
      });
      const data = (await res.json()) as { items?: ContactRequest[] };
      if (res.ok && data.items) setItems(data.items);
    } catch {
      /* silencioso */
    }
  }, [mode]);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 20_000);
    return () => window.clearInterval(t);
  }, [load]);

  async function answer(id: number, action: 'aceite' | 'recusada') {
    setBusyId(id);
    try {
      const res = await fetch(`/api/contact-requests/${id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        toast({
          title: action === 'aceite' ? 'Contacto aceite ✓' : 'Pedido recusado',
          description:
            action === 'aceite'
              ? 'O cliente foi notificado — ele decide quando abrir o chat.'
              : 'O cliente receberá uma notificação neutra.',
        });
        load();
      } else {
        toast({ title: 'Não foi possível responder', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Sem ligação', description: 'Tenta novamente.', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  }

  async function startChat(id: number) {
    setStartingChatId(id);
    try {
      const res = await fetch(`/api/contact-requests/${id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      const data = (await res.json()) as { ok?: boolean; conversation_id?: number; error?: string };
      if (res.ok && data.ok && data.conversation_id) {
        toast({ title: 'Chat aberto 💬', description: 'Combina os detalhes do serviço.' });
        window.location.href = `/chat?c=${data.conversation_id}`;
      } else {
        toast({ title: 'Não foi possível abrir o chat', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Sem ligação', description: 'Tenta novamente.', variant: 'destructive' });
    } finally {
      setStartingChatId(null);
    }
  }

  async function dismiss(id: number) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/contact-requests/${id}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        toast({ title: 'Pedido descartado' });
        load();
      } else {
        toast({ title: 'Não foi possível descartar', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Sem ligação', description: 'Tenta novamente.', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  }

  if (items === null) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <Inbox className="mx-auto mb-3 h-10 w-10 text-slate-300" />
        <p className="font-semibold text-slate-700">
          {mode === 'recebidos' ? 'Sem pedidos de contacto recebidos' : 'Ainda não enviaste pedidos de contato'}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {mode === 'recebidos'
            ? 'Quando um cliente clicar em «Entrar em Contato» no teu portfólio, o pedido aparece aqui.'
            : 'Visita o portfólio de um prestador e clica em «Entrar em Contato».'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((c) => {
        const otherName = mode === 'recebidos' ? c.client_name : c.provider_name;
        return (
          <div
            key={c.id}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${
                      STATUS_BADGE[c.status] ?? 'bg-slate-100 text-slate-500 ring-slate-200'
                    }`}
                  >
                    {STATUS_LABEL[c.status] ?? c.status}
                  </span>
                  <span className="text-xs text-slate-400">{timeAgo(c.created_at)}</span>
                  {c.product_name && (
                    <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
                      Serviço: {c.product_name}
                    </span>
                  )}
                </div>
                <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                  <Users className="h-4 w-4 text-blue-500" />
                  {otherName ?? (mode === 'recebidos' ? 'Cliente' : 'Prestador')}
                </p>
                {c.message && (
                  <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm text-slate-600">
                    «{c.message}»
                  </p>
                )}
                {mode === 'enviados' && c.status === 'aceite' && (
                  <p className="mt-1 text-xs text-teal-700">
                    🔒 A localização exata é partilhada automaticamente após o pagamento.
                  </p>
                )}
              </div>

              {/* Ações */}
              <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                {mode === 'recebidos' && c.status === 'pendente' && (
                  <>
                    <Button
                      size="sm"
                      disabled={busyId === c.id}
                      onClick={() => answer(c.id, 'aceite')}
                      className="h-10 flex-1 bg-teal-600 text-white hover:bg-teal-700 sm:flex-none"
                    >
                      {busyId === c.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      Aceitar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === c.id}
                      onClick={() => answer(c.id, 'recusada')}
                      className="h-10 flex-1 border-rose-200 text-rose-600 hover:bg-rose-50 sm:flex-none"
                    >
                      <Ban className="h-4 w-4" />
                      Rejeitar
                    </Button>
                  </>
                )}
                {mode === 'recebidos' && c.status === 'aceite' && c.conversation_id && (
                  <Link
                    href={`/chat?c=${c.conversation_id}`}
                    className="inline-flex h-10 items-center gap-2 rounded-md bg-gradient-to-r from-blue-600 to-purple-600 px-4 text-sm font-semibold text-white hover:from-blue-700 hover:to-purple-700"
                  >
                    <MessageCircle className="h-4 w-4" /> Abrir conversa
                  </Link>
                )}
                {mode === 'enviados' && c.status === 'pendente' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                    <Clock className="h-3.5 w-3.5" /> À espera de resposta
                  </span>
                )}
                {mode === 'enviados' && c.status === 'aceite' && (
                  <>
                    <Button
                      size="sm"
                      disabled={startingChatId === c.id}
                      onClick={() => startChat(c.id)}
                      className="h-10 bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700"
                    >
                      {startingChatId === c.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <MessageCircle className="h-4 w-4" />
                      )}
                      Ir para Chat
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === c.id}
                      onClick={() => dismiss(c.id)}
                      className="h-10 border-slate-200 text-slate-500 hover:bg-slate-50"
                    >
                      <Ban className="h-4 w-4" />
                      Descartar
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
