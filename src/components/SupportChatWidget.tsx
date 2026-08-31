'use client';

/**
 * AngoStart — Fase 14: widget de chat com o assistente de suporte IA
 * (Groq / llama-3.1-8b-instant, via /api/ai/chat server-side).
 *
 * - Botão flutuante no canto INFERIOR ESQUERDO (o WhatsApp ocupa o direito).
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

export default function SupportChatWidget() {
  const [aberto, setAberto] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([ABERTURA]);
  const [input, setInput] = useState('');
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (aberto && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [aberto, turns, aEnviar]);

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
      {/* Botão flutuante — canto inferior esquerdo (WhatsApp fica no direito) */}
      {!aberto && (
        <button
          type="button"
          onClick={() => setAberto(true)}
          aria-label="Abrir assistente de suporte IA"
          className="fixed bottom-4 left-4 z-40 flex h-13 min-h-[52px] items-center gap-2 rounded-full bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/30 transition hover:bg-violet-700"
        >
          <Sparkles className="h-5 w-5" />
          <span className="hidden sm:inline">Ajuda IA</span>
        </button>
      )}

      {aberto && (
        <div
          className="fixed bottom-4 left-4 z-50 flex h-[520px] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          role="dialog"
          aria-label="Assistente de suporte da AngoStart"
        >
          {/* Cabeçalho */}
          <div className="flex items-center justify-between bg-violet-600 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              <div>
                <p className="text-sm font-bold leading-tight">Ajuda IA — AngoStart</p>
                <p className="text-[11px] leading-tight text-violet-100">
                  Respostas automáticas · suporte humano quando precisares
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAberto(false)}
              aria-label="Fechar assistente"
              className="rounded-lg p-1.5 transition hover:bg-violet-500"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Mensagens */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4">
            {turns.map((t, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  t.role === 'user'
                    ? 'ml-auto bg-emerald-500 text-white'
                    : 'bg-white text-slate-800 shadow-sm'
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

          {/* Entrada */}
          <form
            className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              enviar();
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escreve a tua dúvida…"
              maxLength={800}
              aria-label="Mensagem para o assistente"
              className="h-10 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
            <button
              type="submit"
              disabled={aEnviar || input.trim().length === 0}
              aria-label="Enviar mensagem"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
          <p className="bg-white px-3 pb-2 text-center text-[10px] text-slate-400">
            IA automática — nunca partilhes a tua palavra-passe aqui.
          </p>
        </div>
      )}
    </>
  );
}
