'use client';

/**
 * AngoStart — Banner de anúncios/promoções (Fase 5).
 * Mostra no topo do site os anúncios ativos visíveis ao utilizador
 * (promo, destaque, novidade — e exclusivo apenas para o admin total).
 */

import { useEffect, useState } from 'react';
import { Megaphone, Sparkles, Tag, X } from 'lucide-react';

interface Announcement {
  id: number;
  title: string;
  content: string;
  type: 'promo' | 'destaque' | 'novidade' | 'exclusivo';
  created_at: string;
}

const TYPE_STYLES: Record<Announcement['type'], { icon: typeof Tag; classes: string }> = {
  promo: {
    icon: Tag,
    classes:
      'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
  },
  destaque: {
    icon: Sparkles,
    classes:
      'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200',
  },
  novidade: {
    icon: Megaphone,
    classes:
      'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200',
  },
  exclusivo: {
    icon: Megaphone,
    classes:
      'border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-600/60 dark:bg-slate-800/80 dark:text-slate-200',
  },
};

const dismissedKey = 'angostart.dismissedAnnouncements.v1';

function readDismissed(): number[] {
  try {
    const raw = window.localStorage.getItem(dismissedKey);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    return [];
  }
}

export default function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const dismissedList = readDismissed();
      try {
        const res = await fetch('/api/announcements');
        if (!res.ok) return;
        const data = (await res.json()) as { announcements?: Announcement[] };
        if (cancelled) return;
        setAnnouncements(data.announcements ?? []);
      } catch {
        /* silencioso */
      } finally {
        if (!cancelled) {
          setDismissed(dismissedList);
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function dismiss(id: number) {
    const next = [...new Set([...readDismissed(), id])].slice(-20);
    try {
      window.localStorage.setItem(dismissedKey, JSON.stringify(next));
    } catch {
      /* armazenamento indisponível */
    }
    setDismissed(next);
  }

  if (!ready) return null;
  const visible = announcements.filter((a) => !dismissed.includes(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-2 px-4 pt-4 sm:px-6 lg:px-8">
      {visible.slice(0, 3).map((a) => {
        const style = TYPE_STYLES[a.type] ?? TYPE_STYLES.novidade;
        const Icon = style.icon;
        return (
          <div
            key={a.id}
            className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-sm ${style.classes}`}
            role="status"
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-bold">{a.title}</p>
              <p className="mt-0.5 text-[13px] leading-snug opacity-90">{a.content}</p>
            </div>
            <button
              onClick={() => dismiss(a.id)}
              aria-label="Fechar anúncio"
              className="rounded-full p-1 opacity-60 transition-opacity hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
