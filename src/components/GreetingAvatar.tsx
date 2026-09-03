'use client';

/**
 * AngoStart — Avatar/boneco interativo de boas-vindas (Fase 20).
 *
 * Saudação pelo horário local do utilizador:
 *   - «Bom dia»  06:00–11:59
 *   - «Boa tarde» 12:00–17:59
 *   - «Boa noite» 18:00–05:59
 *
 * O avatar acena (animação CSS .animate-wave) ao montar e sempre que o
 * utilizador passa o rato (grupo hover) — ilustrações sem dependências
 * externas: mão acenante desenhada em SVG + rosto sorridente.
 *
 * Hidratação: a saudação é calculada só no cliente (useEffect) — no
 * servidor renderiza «Olá» neutro, sem mismatch nem flash.
 *
 * Variantes:
 *   - hero      → avatar grande (72px) para a Home
 *   - dashboard → médio (56px) para cabeçalhos de painéis
 */

import { useEffect, useState } from 'react';
import { ShoppingBag, Sparkles, Wallet } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';

type Greeting = 'Bom dia' | 'Boa tarde' | 'Boa noite' | 'Olá';

/** Período do dia a partir da hora local (0–23). */
function greetingForHour(hour: number): Greeting {
  if (hour >= 6 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  if (hour >= 18 || hour < 6) return 'Boa noite';
  return 'Olá';
}

/** Emoji/ícone da atmosfera certa para cada período. */
const GREETING_META: Record<
  Exclude<Greeting, 'Olá'>,
  { icon: string; tone: string }
> = {
  'Bom dia': { icon: '☀️', tone: 'from-amber-400/20 to-blue-500/20' },
  'Boa tarde': { icon: '🌤️', tone: 'from-orange-400/20 to-violet-500/20' },
  'Boa noite': { icon: '🌙', tone: 'from-indigo-500/25 to-blue-600/20' },
};

type Props = {
  variant?: 'hero' | 'dashboard';
  /** Mostra os tiles flutuantes (padrão: true na variante hero). */
  showTiles?: boolean;
};

export default function GreetingAvatar({ variant = 'hero', showTiles }: Props) {
  const { user } = useAuth();
  const [greeting, setGreeting] = useState<Greeting>('Olá');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setGreeting(greetingForHour(new Date().getHours()));
    setMounted(true);
  }, []);

  const withTiles = showTiles ?? variant === 'hero';
  const meta =
    greeting !== 'Olá' ? GREETING_META[greeting] : GREETING_META['Bom dia'];

  const firstName = user?.name?.trim().split(/\s+/)[0] ?? '';
  const initials = (user?.name || 'U')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const avatarSize = variant === 'hero' ? 'h-18 w-18' : 'h-14 w-14';

  return (
    <div className={`group flex items-center ${variant === 'hero' ? 'gap-8' : 'gap-4'}`}>
      {/* Avatar circular com anel pulsante + tiles flutuantes (ref. dashboards) */}
      <div className="relative shrink-0">
        {/* Halo circular suave atrás (motivo das referências 9/10) */}
        <span
          aria-hidden="true"
          className={`absolute -inset-3 rounded-full bg-gradient-to-br ${meta.tone} blur-md`}
        />
        <span
          className={`animate-pulse-glow relative flex ${avatarSize} items-center justify-center overflow-hidden rounded-full border-2 border-white/70 bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-600/25 dark:border-white/20`}
        >
          {user?.profile_image ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={user.profile_image}
              alt={`Foto de ${user.name}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-lg font-extrabold text-white">{initials}</span>
          )}
        </span>

        {/* Mão acenante — pop-in + wave (acenar ao chegar, acenar ao hover) */}
        {mounted && (
          <span
            aria-hidden="true"
            className="animate-wave absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-white/60 bg-white text-base shadow-md dark:border-white/20 dark:bg-slate-800"
          >
            👋
          </span>
        )}

        {/* Tiles flutuantes à volta do avatar (estilo «Good morning, Josh») */}
        {withTiles && mounted && (
          <>
            <motion.span
              aria-hidden="true"
              className="animate-float absolute -left-8 -top-2 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-600/30"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5, type: 'spring', stiffness: 260 }}
            >
              <ShoppingBag className="h-4.5 w-4.5" />
            </motion.span>
            <motion.span
              aria-hidden="true"
              className="animate-float-delay absolute -bottom-3 left-6 flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 text-white shadow-lg shadow-teal-500/30"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.65, type: 'spring', stiffness: 260 }}
            >
              <Wallet className="h-4 w-4" />
            </motion.span>
            <motion.span
              aria-hidden="true"
              className="animate-float-slow absolute -right-7 top-6 flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg shadow-purple-600/30"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.8, type: 'spring', stiffness: 260 }}
            >
              <Sparkles className="h-4 w-4" />
            </motion.span>
          </>
        )}
      </div>

      {/* Saudação por horário */}
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-blue-300 sm:text-base">
          <span aria-hidden="true">{mounted ? meta.icon : ''}</span>
          {mounted ? greeting : 'Olá'}
          {firstName ? `, ${firstName}!` : '!'}
        </p>
        <p className="text-xs text-slate-400 sm:text-sm">
          Bem-vindo à tua plataforma de negócios
        </p>
      </div>
    </div>
  );
}
