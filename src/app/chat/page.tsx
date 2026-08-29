'use client';

/**
 * AngoStart — Chat interno (Fase 5) — página protegida.
 *
 * Lista de conversas (cliente ↔ vendedor/prestador) + janela de mensagens.
 * - A conversa parte de um produto/serviço ("Falar com o vendedor").
 * - Polling leve (5 s) mantém as mensagens atualizadas.
 * - Aviso anti-burla: partilhar contactos é monitorizado.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Briefcase,
  Loader2,
  MessageCircle,
  Send,
  ShieldAlert,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth, authHeaders } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Conversation {
  id: number;
  user_id: number;
  seller_id: number;
  product_id: number | null;
  product_name: string | null;
  product_type: string | null;
  other_name: string | null;
  other_role: string | null;
  last_message: string | null;
  last_message_at: string;
}

interface Message {
  id: number;
  sender_id: number;
  content: string;
  created_at: string;
}

export default function ChatPage() {
  const { user, loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> A carregar o chat…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center sm:px-6">
        <MessageCircle className="mx-auto h-12 w-12 text-emerald-500" />
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Chat da AngoStart</h1>
        <p className="mt-2 text-sm text-slate-500">
          Entra na tua conta para falar com vendedores e clientes — tudo protegido pela
          plataforma.
        </p>
        <Link
          href="/perfil"
          className="mt-6 inline-flex h-11 items-center rounded-xl bg-emerald-500 px-6 font-semibold text-white transition-colors hover:bg-emerald-600"
        >
          Entrar / criar conta
        </Link>
      </div>
    );
  }

  return <ChatClient userId={user.id} />;
}

function ChatClient({ userId }: { userId: number }) {
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/conversations', { headers: authHeaders() });
      const data = (await res.json()) as { conversations?: Conversation[] };
      setConversations(data.conversations ?? []);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadMessages = useCallback(async (id: number) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/chat/conversations/${id}`, { headers: authHeaders() });
      if (res.ok) {
        const data = (await res.json()) as { messages?: Message[] };
        setMessages(data.messages ?? []);
      }
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Polling: lista a cada 8 s; mensagens ativas a cada 5 s
  useEffect(() => {
    const listTimer = window.setInterval(loadConversations, 8_000);
    let msgTimer: number | null = null;
    if (activeId !== null) {
      loadMessages(activeId);
      msgTimer = window.setInterval(() => loadMessages(activeId), 5_000);
    }
    return () => {
      window.clearInterval(listTimer);
      if (msgTimer) window.clearInterval(msgTimer);
    };
  }, [activeId, loadConversations, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || activeId === null || sending) return;

    setSending(true);
    try {
      const res = await fetch(`/api/chat/conversations/${activeId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: Message; error?: string; warning?: string | null };
      if (!res.ok || !data.ok) {
        toast({ title: 'Mensagem não enviada', description: data.error });
        return;
      }
      setMessages((prev) => [...prev, data.message as Message]);
      setDraft('');
      if (data.warning) {
        toast({ title: '⚠️ Atenção', description: data.warning });
      }
      loadConversations();
    } finally {
      setSending(false);
    }
  }

  const active = conversations.find((c) => c.id === activeId) ?? null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900">Chat</h1>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
        <ShieldAlert className="h-4 w-4 text-amber-500" />
        Negocia sempre dentro da AngoStart — partilhar contactos é monitorizado e remove a tua proteção.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Lista de conversas */}
        <aside
          className={cn(
            'rounded-2xl border border-slate-200 bg-white shadow-sm',
            activeId !== null && 'hidden lg:block'
          )}
        >
          <div className="max-h-[70vh] overflow-y-auto p-2">
            {loadingList ? (
              <p className="flex items-center justify-center p-8 text-sm text-slate-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> A carregar conversas…
              </p>
            ) : conversations.length === 0 ? (
              <div className="p-8 text-center">
                <MessageCircle className="mx-auto h-10 w-10 text-slate-200" />
                <p className="mt-3 text-sm font-medium text-slate-700">Ainda não tens conversas</p>
                <p className="mt-1 text-xs text-slate-400">
                  Abre um produto e clica <strong>Falar com o vendedor</strong> para começar.
                </p>
                <Link
                  href="/produtos"
                  className="mt-4 inline-block text-sm font-semibold text-emerald-600 hover:text-emerald-700"
                >
                  Explorar catálogo →
                </Link>
              </div>
            ) : (
              <ul className="space-y-1">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => setActiveId(c.id)}
                      className={cn(
                        'w-full rounded-xl p-3 text-left transition-colors',
                        activeId === c.id ? 'bg-emerald-50 ring-1 ring-emerald-300' : 'hover:bg-slate-50'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                          {c.other_role && c.other_role !== 'cliente' ? (
                            <Briefcase className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <UserRound className="h-4 w-4" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {c.other_name ?? 'Utilizador'}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {c.product_name ? `${c.product_name} · ` : ''}
                            {c.last_message ?? 'Conversa iniciada'}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Janela de mensagens */}
        <section
          className={cn(
            'flex min-h-[60vh] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm',
            activeId === null && 'hidden lg:flex'
          )}
        >
          {active === null ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-400">
              Seleciona uma conversa para começar.
            </div>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b border-slate-100 p-4">
                <button
                  onClick={() => setActiveId(null)}
                  className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
                  aria-label="Voltar às conversas"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div>
                  <p className="text-sm font-bold text-slate-900">{active.other_name ?? 'Utilizador'}</p>
                  {active.product_name && (
                    <Link
                      href={`/produtos/${active.product_id}`}
                      className="text-xs font-medium text-emerald-600 hover:underline"
                    >
                      {active.product_name}
                    </Link>
                  )}
                </div>
              </header>

              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {loadingMessages && messages.length === 0 ? (
                  <p className="flex items-center justify-center text-sm text-slate-400">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> A carregar mensagens…
                  </p>
                ) : messages.length === 0 ? (
                  <p className="text-center text-sm text-slate-400">
                    Sem mensagens — envia a primeira!
                  </p>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={cn('flex', m.sender_id === userId ? 'justify-end' : 'justify-start')}
                    >
                      <div
                        className={cn(
                          'max-w-[75%] rounded-2xl px-4 py-2 text-sm',
                          m.sender_id === userId
                            ? 'bg-emerald-500 text-white'
                            : 'bg-slate-100 text-slate-800'
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.content}</p>
                        <p
                          className={cn(
                            'mt-1 text-[10px]',
                            m.sender_id === userId ? 'text-emerald-100' : 'text-slate-400'
                          )}
                        >
                          {new Date(m.created_at).toLocaleTimeString('pt-PT', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={bottomRef} />
              </div>

              <form onSubmit={handleSend} className="flex gap-2 border-t border-slate-100 p-3">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Escreve a tua mensagem…"
                  className="h-11 flex-1"
                  maxLength={2000}
                />
                <Button
                  type="submit"
                  disabled={sending || draft.trim().length === 0}
                  className="h-11 bg-emerald-500 px-4 hover:bg-emerald-600"
                  aria-label="Enviar mensagem"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
