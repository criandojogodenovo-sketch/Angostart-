'use client';

/**
 * AngoStart — Sino de notificações (Fase 5).
 * Mostra o contador de não lidas e a lista das últimas notificações.
 * Notificações criadas por: chat, validações de encomenda, carteira,
 * bloqueios anti-burla e anúncios importantes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, Loader2 } from 'lucide-react';
import { useAuth, authHeaders } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

interface NotificationItem {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

export default function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/notifications', { headers: authHeaders() });
      if (!res.ok) return;
      const data = (await res.json()) as { notifications?: NotificationItem[]; unread?: number };
      setItems(data.notifications ?? []);
      setUnread(data.unread ?? 0);
    } catch {
      /* silencioso */
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    // Primeira carga fora do corpo síncrono do efeito (evita cascata de renders)
    const initial = window.setTimeout(load, 0);
    const timer = window.setInterval(load, 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [user, load]);

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function markAllRead() {
    if (unread === 0) return;
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({}),
    }).catch(() => {});
  }

  if (!user) return null;

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!open) load();
        }}
        aria-label={`Notificações (${unread} não lidas)`}
        aria-expanded={open}
        className={cn(
          'relative flex h-10 w-10 items-center justify-center rounded-full transition-colors',
          'text-slate-600 hover:bg-gray-100 hover:text-slate-900'
        )}
      >
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Bell className="h-5 w-5" />}
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[11px] font-bold text-white shadow">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-bold text-slate-900">Notificações</p>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                Marcar todas como lidas
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-400">
                Sem notificações por agora — estarão aqui novidades das tuas vendas, chat e carteira.
              </p>
            ) : (
              <ul>
                {items.map((n) => {
                  const inner = (
                    <div
                      className={cn(
                        'border-b border-slate-50 px-4 py-3 transition-colors hover:bg-slate-50',
                        !n.read && 'bg-blue-50/60'
                      )}
                    >
                      <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        {!n.read && (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" aria-hidden />
                        )}
                        {n.title}
                      </p>
                      {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.body}</p>}
                      <p className="mt-1 text-[10px] text-slate-400">
                        {new Date(n.created_at).toLocaleString('pt-PT', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  );
                  return (
                    <li key={n.id}>
                      {n.link ? (
                        <Link href={n.link} onClick={() => setOpen(false)}>
                          {inner}
                        </Link>
                      ) : (
                        inner
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
