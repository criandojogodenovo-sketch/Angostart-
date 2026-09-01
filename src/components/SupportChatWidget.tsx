'use client';

/**
 * AngoStart — Fase 14/16: widget de chat com o assistente de suporte IA
 * (Groq / B.AI, via /api/ai/chat server-side).
 *
 * Fase 16 (redesign + correção MOBILE):
 * - O botão flutuante ficava ATRÁS da BottomNav no mobile (z-40 < z-75,
 *   bottom-4 dentro dos 68px da barra) → invisível em telemóvel.
 *   Agora: botão sempre visível acima da BottomNav em qualquer ecrã.
 * - No mobile o chat abre em ECRÃ CHEIO (100dvh) para facilitar a escrita;
 *   no desktop mantém o painel flutuante (canto inferior esquerdo).
 * - "IA" na BottomNav dispara o evento global 'angostart:ai-open'.
 * - Mantém as últimas 8 mensagens como contexto (o servidor corta a 10).
 * - Rate limit no servidor: 10 msg/min. Erros mostram fallback humano.
 * - Nunca envia dados sensíveis: aviso fixo "não partilhes a tua senha".
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircle, Send, Sparkles, X } from 'lucide-react';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

const ABERTURA: Turn = {
  role: 'assistant',
  content:
    'Olá! Sou o assistente virtual da AngoStart. Pergunta-me sobre compras, vendas, carteira, verificação de identidade ou a tua conta.',
};

/** Evento global usado pela BottomNav ("IA") para abrir o widget. */
export const AI_CHAT_OPEN_EVENT = 'angostart:ai-open';

export default function SupportChatWidget() {
  const [aberto, setAberto] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([ABERTURA]);
  const [input, setInput] = useState('');
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* "IA" na BottomNav → abre o chat */
  useEffect(() => {
    const abrir = () => setAberto(true);
    window.addEventListener(AI_CHAT_OPEN_EVENT, abrir);
    return () => window.removeEventListener(AI_CHAT_OPEN_EVENT, abrir);
  }, []);

  /* Auto-scroll das mensagens + foco no campo ao abrir */
  useEffect(() => {
    if (aberto) {
      inputRef.current?.focus();
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }
  }, [aberto, turns, aEnviar]);

  /* Ecrã cheio no mobile: bloqueia o scroll do fundo enquanto aberto */
  useEffect(() => {
    if (!aberto) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = anterior;
    };
  }, [aberto]);

  /* Esc fecha (atalho útil em desktop) */
  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aberto]);

  async function enviar() {
    const texto = input.trim();
    if (!texto || aEnviar) return;

    const seguintes: Turn[] = [...turns, { role: 'user', content: texto }];
    setTurns(seguintes);
    setInput('');
    setAEnviar(true);
    setErro(null);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: seguintes
            .filter((t) => t !== ABERTURA)
            .slice(-8)
            .map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      if (res.ok && data.reply) {
        setTurns((old) => [...old, { role: 'assistant', content: data.reply as string }]);
      } else {
        setErro(
          data.error ??
            'Não consegui responder agora — fala connosco no WhatsApp +244 958 176 915.'
        );
      }
    } catch {
      setErro('Sem ligação ao assistente. Verifica a internet e tenta de novo.');
    } finally {
      setAEnviar(false);
    }
  }

  return (
    <>
      {/* Botão flutuante — canto inferior ESQUERDO, acima da BottomNav no mobile
          (o WhatsApp ocupa o direito). Visível em TODOS os tamanhos de ecrã. */}
      {!aberto && (
        <button
          type="button"
          onClick={() => setAberto(true)}
          aria-label="Abrir assistente de suporte IA"
          className="fixed bottom-[calc(96px+env(safe-area-inset-bottom,0px))] left-4 z-[76] flex h-12 min-h-[48px] items-center gap-2 rounded-full bg-gradient-to-br from-blue-600 to-teal-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 transition hover:from-blue-700 hover:to-teal-600 active:scale-95 md:bottom-5 md:left-5"
        >
          <Sparkles className="h-5 w-5" />
          <span className="hidden sm:inline">Ajuda IA</span>
        </button>
      )}

      {aberto && (
        <div
          className="fixed inset-0 z-[90] flex h-[100dvh] w-full flex-col overflow-hidden rounded-none bg-white shadow-2xl md:inset-auto md:bottom-5 md:left-5 md:h-[560px] md:w-[400px] md:rounded-2xl md:border md:border-slate-200"
          role="dialog"
          aria-modal="true"
          aria-label="Assistente de suporte da AngoStart"
        >
          {/* Cabeçalho (safe-area no mobile para ecrãs com notch) */}
          <div className="flex items-center justify-between bg-gradient-to-r from-blue-600 to-teal-500 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] text-white">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
                <Sparkles className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-bold leading-tight">Ajuda IA — AngoStart</p>
                <p className="text-[11px] leading-tight text-blue-100">
                  Respostas automáticas · suporte humano quando precisares
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAberto(false)}
              aria-label="Fechar assistente"
              className="rounded-xl p-2 transition hover:bg-white/15 active:scale-95"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Mensagens */}
          <div
            ref={scrollRef}
            className="scrollbar-thin flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4"
          >
            {turns.map((t, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  t.role === 'user'
                    ? 'ml-auto bg-blue-600 text-white'
                    : 'border border-slate-100 bg-white text-slate-800 shadow-sm'
                }`}
              >
                {t.content}
              </div>
            ))}
            {aEnviar && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> A escrever…
              </div>
            )}
            {erro && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {erro}
              </p>
            )}
          </div>

          {/* Entrada (fica sempre acima da zona segura do iPhone) */}
          <form
            className="flex items-center gap-2 border-t border-gray-200 bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0.75rem))]"
            onSubmit={(e) => {
              e.preventDefault();
              enviar();
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escreve a tua dúvida…"
              maxLength={800}
              aria-label="Mensagem para o assistente"
              className="h-11 flex-1 rounded-xl border border-gray-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
            />
            <button
              type="submit"
              disabled={aEnviar || input.trim().length === 0}
              aria-label="Enviar mensagem"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
          <p className="bg-white px-3 pb-2 pt-0 text-center text-[10px] text-slate-400">
            <MessageCircle className="mr-1 inline h-3 w-3" />
            IA automática — nunca partilhes a tua palavra-passe aqui.
          </p>
        </div>
      )}
    </>
  );
}
