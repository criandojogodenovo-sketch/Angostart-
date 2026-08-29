'use client';

/**
 * AngoStart — Cartão do perfil (Fase 7):
 *  - Nível, pontos e selos de gamificação;
 *  - Ativar/desativar notificações push (Web Push + VAPID).
 */

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Loader2, Medal } from 'lucide-react';
import { authHeaders } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';

interface GamificationData {
  points: number;
  level: string;
  badges: { code: string; name: string; description: string }[];
  next_level: { key: string; label: string; missing: number } | null;
  progress: number;
}

const LEVEL_LABEL: Record<string, { label: string; emoji: string }> = {
  bronze: { label: 'Bronze', emoji: '🥉' },
  prata: { label: 'Prata', emoji: '🥈' },
  ouro: { label: 'Ouro', emoji: '🥇' },
  platina: { label: 'Platina', emoji: '💎' },
};

/** Converte a chave pública VAPID (base64url) para Uint8Array. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export default function ProfileGamificationCard() {
  const { toast } = useToast();
  const [game, setGame] = useState<GamificationData | null>(null);
  const [pushState, setPushState] = useState<{
    enabled: boolean;
    subscribed: boolean;
    publicKey: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPushState = useCallback(async () => {
    try {
      const res = await fetch('/api/push/subscribe', { headers: authHeaders() });
      setPushState((await res.json()) as typeof pushState);
      // Reflete o estado real do browser (permissão pode ter mudado fora)
      if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
        const reg = await navigator.serviceWorker.getRegistration();
        const existing = await reg?.pushManager.getSubscription();
        if (existing) {
          setPushState((prev) => (prev ? { ...prev, subscribed: true } : prev));
        }
      }
    } catch {
      setPushState({ enabled: false, subscribed: false, publicKey: null });
    }
  }, []);

  useEffect(() => {
    fetch('/api/dashboard/gamification', { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: GamificationData | null) => setGame(data))
      .catch(() => setGame(null));
    loadPushState();
  }, [loadPushState]);

  async function enablePush() {
    if (busy) return;
    setBusy(true);
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        toast({
          title: 'Não suportado',
          description: 'O teu browser não suporta notificações push.',
        });
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast({
          title: 'Permissão recusada',
          description: 'Ativa as notificações nas definições do browser para receber avisos.',
        });
        return;
      }
      const publicKey = pushState?.publicKey;
      if (!publicKey) {
        toast({
          title: 'Push não configurado',
          description: 'As chaves VAPID ainda não estão ativas na plataforma.',
        });
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error();
      toast({
        title: 'Notificações ativadas ✓',
        description: 'Vais receber avisos de mensagens, propostas e pedidos no telemóvel.',
      });
      await loadPushState();
    } catch {
      toast({ title: 'Não foi possível ativar', description: 'Tenta novamente em instantes.' });
    } finally {
      setBusy(false);
    }
  }

  async function disablePush() {
    if (busy) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      toast({ title: 'Notificações desativadas' });
      await loadPushState();
    } catch {
      toast({ title: 'Não foi possível desativar', description: 'Tenta novamente.' });
    } finally {
      setBusy(false);
    }
  }

  const level = LEVEL_LABEL[game?.level ?? 'bronze'] ?? LEVEL_LABEL.bronze;

  return (
    <section
      aria-label="Nível e notificações"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      {/* Gamificação */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-lg">
            {level.emoji}
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Nível {level.label} · {game?.points ?? 0} pontos
            </p>
            <p className="text-xs text-slate-400">
              {game?.next_level
                ? `Faltam ${game.next_level.missing} pontos para ${game.next_level.label}`
                : 'Nível máximo — parabéns!'}
              {game?.badges.length ? ` · ${game.badges.length} selo(s)` : ''}
            </p>
          </div>
        </div>
        <Medal className="h-5 w-5 text-slate-300" />
      </div>

      {/* Push */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <div>
          <p className="text-sm font-semibold text-slate-900">Notificações no telemóvel</p>
          <p className="text-xs text-slate-400">
            Avisos instantâneos de mensagens, propostas, pedidos pagos e disputas.
          </p>
        </div>
        {pushState === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-300" />
        ) : !pushState.enabled ? (
          <span className="text-xs text-slate-400">Em breve — configuração pendente.</span>
        ) : pushState.subscribed ? (
          <button
            type="button"
            onClick={disablePush}
            disabled={busy}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <BellOff className="h-4 w-4" /> Desativar
          </button>
        ) : (
          <button
            type="button"
            onClick={enablePush}
            disabled={busy}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-500 px-4 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            <Bell className="h-4 w-4" /> {busy ? 'A ativar…' : 'Ativar notificações'}
          </button>
        )}
      </div>
    </section>
  );
}
