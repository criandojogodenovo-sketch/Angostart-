'use client';

/**
 * AngoStart — Fase 14/16/21: widget de chat com o assistente de suporte IA
 * (roteamento multi-modelo server-side via /api/ai/chat).
 *
 * Fase 21 (multimodal):
 * - Anexo de IMAGEM (JPG/PNG/WebP ≤ 5 MB, 1 por mensagem) com preview;
 *   o modelo multimodal analisa a imagem e responde.
 * - Gravação de ÁUDIO (≤ 2 min) pelo microfone com indicador de gravação;
 *   o servidor transcreve e responde ao texto (3 transcrições/dia).
 * - O utilizador NUNCA vê qual modelo respondeu — a interface é simples:
 *   «Envia a tua dúvida, imagem ou áudio».
 *
 * Fase 16 (redesign + correção MOBILE):
 * - Botão flutuante sempre visível acima da BottomNav; ecrã cheio no
 *   mobile (100dvh); "IA" na BottomNav dispara 'angostart:ai-open'.
 * - Mantém as últimas 8 mensagens como contexto (o servidor corta a 10).
 * - Rate limit no servidor: 30 msg/min. Erros mostram fallback humano.
 * - Nunca envia dados sensíveis: aviso fixo "não partilhes a tua senha".
 */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ImagePlus,
  Loader2,
  MessageCircle,
  Mic,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** Pré-visualização da imagem enviada neste turno (só UI local). */
  image?: string;
  /** Turno enviado como áudio (mostra chip «áudio» na bolha). */
  audio?: boolean;
}

interface PendingImage {
  dataUrl: string;
  name: string;
}

interface PendingAudio {
  dataUrl: string;
  mime: string;
  seconds: number;
}

const ABERTURA: Turn = {
  role: 'assistant',
  content:
    'Olá! Sou o assistente virtual da AngoStart. Pergunta-me sobre compras, vendas, Busbt (vídeos), Pedidos no Ar, carteira, afiliados, verificação de identidade ou a tua conta. Também podes enviar uma imagem ou um áudio.',
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_RECORD_SECONDS = 120; // 2 minutos
/* Hotfix "IA demora em rede móvel": a cadeia server-side tem orçamento de
   55 s (maxDuration 60 s − margem). O cliente espera 70 s — cobre o pior
   caso + latência de rede, sem abortar respostas que ainda vão chegar. */
const CHAT_TIMEOUT_MS = 70_000;

/**
 * Mensagem ESPECÍFICA por tipo de falha do getUserMedia — o erro genérico
 * antigo confundia "permissão negada" com "sem microfone"/"micro ocupado".
 */
function micErrorMessage(error: unknown): string {
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String((error as { name?: unknown }).name)
      : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return (
        'Permissão do microfone NEGADA. Para ativar: toca no ícone de cadeado ' +
        '(ou ℹ️) na barra de endereço do navegador → Permissões → Microfone → ' +
        'Permitir, e tenta de novo. Em iPhone: Definições → Safari → Microfone.'
      );
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return (
        'Nenhum microfone foi detetado neste dispositivo. Verifica se o ' +
        'dispositivo tem microfone ativo e tenta de novo — ou escreve a tua dúvida.'
      );
    case 'NotReadableError':
    case 'TrackStartError':
      return (
        'O microfone está a ser usado por outra aplicação (chamada, gravação ' +
        'ou outra aba). Fecha essa aplicação e tenta de novo.'
      );
    case 'OverconstrainedError':
      return 'Este navegador não suporta a gravação pedida — atualiza o navegador ou escreve a tua dúvida.';
    case 'SecurityError':
      return (
        'A gravação de áudio só funciona em ligação segura (HTTPS). Abre o ' +
        'site em https://angostart.vercel.app e tenta de novo.'
      );
    default:
      return (
        'Não consegui aceder ao microfone — verifica as permissões do navegador ' +
        '(ícone de cadeado na barra de endereço → Microfone → Permitir) e tenta de novo. ' +
        'Se persistir, escreve a tua dúvida.'
      );
  }
}

/** Evento global usado pela BottomNav ("IA") para abrir o widget. */
export const AI_CHAT_OPEN_EVENT = 'angostart:ai-open';

/** File → data-URL (promise). */
function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read-fail'));
    reader.readAsDataURL(file);
  });
}

export default function SupportChatWidget() {
  const [aberto, setAberto] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([ABERTURA]);
  const [input, setInput] = useState('');
  const [aEnviar, setAEnviar] = useState(false);
  const [enviandoAudio, setEnviandoAudio] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* Fase 21: imagem anexada (1 por mensagem) */
  const [imagem, setImagem] = useState<PendingImage | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  /* Fase 21: gravação de áudio */
  const [gravando, setGravando] = useState(false);
  const [recordSegundos, setRecordSegundos] = useState(0);
  const [audioPendente, setAudioPendente] = useState<PendingAudio | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const suporteAudio =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';

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
      if (e.key === 'Escape' && !gravando) setAberto(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aberto, gravando]);

  /* Limpa a gravação se o widget fechar a meio */
  useEffect(() => {
    if (!aberto && gravando) pararGravacao(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  /* ────────────────────── Imagem ────────────────────── */

  function escolherImagem(file: File | null) {
    setErro(null);
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErro('Formato de imagem não suportado — usa JPG, PNG ou WebP.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setErro('A imagem deve ter no máximo 5 MB.');
      return;
    }
    void fileToDataUrl(file).then((dataUrl) => {
      setImagem({ dataUrl, name: file.name });
    });
  }

  /* ────────────────────── Áudio ─────────────────────── */

  async function iniciarGravacao() {
    setErro(null);
    /* Sem mediaDevices = contexto inseguro (HTTP) ou navegador antigo —
       chamar getUserMedia lançaria TypeError com a mensagem genérica errada. */
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErro(
        'Este navegador não suporta gravação de áudio (ou a ligação não é segura). ' +
          'Abre o site em https://angostart.vercel.app com Chrome/Safari atualizado, ou escreve a tua dúvida.'
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current?.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current ?? [], {
          type: recorder.mimeType?.split(';')[0] || 'audio/webm',
        });
        if (blob.size > 0) {
          const dataUrl = await fileToDataUrl(blob);
          setAudioPendente({
            dataUrl,
            mime: blob.type,
            seconds: recordSegundosRef.current,
          });
        }
        setGravando(false);
        setRecordSegundos(0);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setGravando(true);
      setRecordSegundos(0);
      timerRef.current = setInterval(() => {
        setRecordSegundos((s) => {
          if (s + 1 >= MAX_RECORD_SECONDS) {
            /* Auto-stop aos 2 minutos */
            pararGravacao();
            return MAX_RECORD_SECONDS;
          }
          return s + 1;
        });
      }, 1000);
    } catch (error) {
      /* Hotfix: mensagem ESPECÍFICA por causa (permissão negada ≠ sem
         microfone ≠ micro ocupado) — antes era uma só para tudo. */
      console.warn('[SuporteIA] getUserMedia falhou:', error);
      setErro(micErrorMessage(error));
    }
  }

  /* Segundos correntes também acessíveis dentro do onstop (closure fresca) */
  const recordSegundosRef = useRef(0);
  useEffect(() => {
    recordSegundosRef.current = recordSegundos;
  }, [recordSegundos]);

  function pararGravacao(cancelar = false) {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      if (cancelar) {
        recorder.onstop = () => {
          recorder.stream.getTracks().forEach((t) => t.stop());
        };
      }
      recorder.stop();
      if (cancelar) {
        chunksRef.current = [];
        setGravando(false);
        setRecordSegundos(0);
      }
    } else {
      setGravando(false);
      setRecordSegundos(0);
    }
  }

  /* ────────────────────── Envio ─────────────────────── */

  async function enviar() {
    const texto = input.trim();
    if (aEnviar || gravando) return;
    if (!texto && !imagem && !audioPendente) return;

    const novoTurno: Turn = {
      role: 'user',
      content: texto || (audioPendente ? '[Áudio]' : '[Imagem]'),
      ...(imagem ? { image: imagem.dataUrl } : {}),
      ...(audioPendente ? { audio: true } : {}),
    };
    const seguintes: Turn[] = [...turns, novoTurno];
    setTurns(seguintes);
    setInput('');
    const imagemEnviada = imagem;
    setImagem(null);
    const audioEnviado = audioPendente;
    setAudioPendente(null);
    setEnviandoAudio(!!audioEnviado);
    setAEnviar(true);
    setErro(null);

    try {
      // Hotfix: 70 s — a cadeia server-side tem orçamento de 55 s (3 providers
      // em cascata: B.AI 45 s → OpenRouter 30 s → Gemini 30 s, limitados pelo
      // deadline); 45 s abortava respostas que ainda vinham a caminho.
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: seguintes
            .filter((t) => t !== ABERTURA)
            .slice(-8)
            .map((t) => ({ role: t.role, content: t.content })),
          ...(imagemEnviada ? { image: imagemEnviada.dataUrl } : {}),
          ...(audioEnviado ? { audio: audioEnviado.dataUrl } : {}),
        }),
        signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
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
      setErro(
        'Não consegui contactar a IA. Tenta novamente ou contacta o suporte.'
      );
    } finally {
      setAEnviar(false);
      setEnviandoAudio(false);
    }
  }

  const podeEnviar = !aEnviar && !gravando && (!!input.trim() || !!imagem || !!audioPendente);

  return (
    <>
      {/* Botão flutuante — canto inferior ESQUERDO, acima da BottomNav no mobile
          (o WhatsApp ocupa o direito). Visível em TODOS os tamanhos de ecrã. */}
      {!aberto && (
        <button
          type="button"
          onClick={() => setAberto(true)}
          aria-label="Abrir assistente de suporte IA"
          className="fixed bottom-[calc(96px+env(safe-area-inset-bottom,0px))] left-4 z-[76] flex h-12 min-h-[48px] items-center gap-2 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 transition hover:shadow-xl hover:brightness-110 active:scale-95 md:bottom-5 md:left-5"
        >
          <Sparkles className="h-5 w-5" />
          <span className="hidden sm:inline">Ajuda IA</span>
          {/* Indicador «online» pulsante (Fase 18) */}
          <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-white bg-teal-400" />
          </span>
        </button>
      )}

      {aberto && (
        <div
          className="fixed inset-0 z-[90] flex h-[100dvh] w-full flex-col overflow-hidden rounded-none bg-white shadow-2xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-6 md:inset-auto md:bottom-5 md:left-5 md:h-[560px] md:w-[400px] md:rounded-2xl md:border md:border-white/50 md:bg-white/80 md:backdrop-blur-xl"
          role="dialog"
          aria-modal="true"
          aria-label="Assistente de suporte da AngoStart"
        >
          {/* Cabeçalho (safe-area no mobile para ecrãs com notch) */}
          <div className="flex items-center justify-between bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] text-white">
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
                {t.image && (
                  <img
                    src={t.image}
                    alt="Imagem que enviaste"
                    className="mb-2 max-h-44 w-auto rounded-xl border border-white/30"
                  />
                )}
                {t.audio && (
                  <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold">
                    <Mic className="h-3 w-3" /> Áudio transcrito
                  </span>
                )}
                {t.content}
              </div>
            ))}
            {aEnviar && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {enviandoAudio
                  ? 'A transcrever o áudio…'
                  : 'A escrever… (pode levar até 1 minuto em rede lenta)'}
              </div>
            )}
            {erro && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {erro}
              </p>
            )}
          </div>

          {/* Pré-visualizações dos anexos pendentes */}
          {(imagem || audioPendente || gravando) && (
            <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-white px-3 pt-2.5">
              {imagem && (
                <span className="relative inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 py-1 pl-1 pr-2 text-xs text-slate-600">
                  <img
                    src={imagem.dataUrl}
                    alt="Pré-visualização da imagem"
                    className="h-9 w-9 rounded-lg object-cover"
                  />
                  <span className="max-w-[140px] truncate">{imagem.name}</span>
                  <button
                    type="button"
                    onClick={() => setImagem(null)}
                    aria-label="Remover imagem"
                    className="rounded-full p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
              {audioPendente && (
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 py-1.5 pl-2.5 pr-2 text-xs font-semibold text-blue-700">
                  <Mic className="h-3.5 w-3.5" />
                  Áudio ({audioPendente.seconds}s)
                  <button
                    type="button"
                    onClick={() => setAudioPendente(null)}
                    aria-label="Remover áudio"
                    className="rounded-full p-0.5 text-blue-400 hover:bg-blue-100 hover:text-blue-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
              {gravando && (
                <span className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-700">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-600" />
                  </span>
                  A gravar… {recordSegundos}s / 2:00
                </span>
              )}
            </div>
          )}

          {/* Entrada (fica sempre acima da zona segura do iPhone) */}
          <form
            className="flex items-center gap-2 border-t border-gray-200 bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0.75rem))]"
            onSubmit={(e) => {
              e.preventDefault();
              void enviar();
            }}
          >
            {/* Anexar imagem */}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                escolherImagem(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
              className="hidden"
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={aEnviar || gravando || !!imagem}
              aria-label="Anexar imagem"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-slate-500 transition hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ImagePlus className="h-5 w-5" />
            </button>

            {/* Gravar / parar áudio */}
            {suporteAudio && (
              <button
                type="button"
                onClick={() => void (gravando ? pararGravacao() : iniciarGravacao())}
                disabled={aEnviar || (!!audioPendente && !gravando)}
                aria-label={gravando ? 'Parar gravação' : 'Gravar áudio'}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  gravando
                    ? 'bg-rose-600 text-white hover:bg-rose-700'
                    : 'border border-gray-200 text-slate-500 hover:border-blue-300 hover:text-blue-600'
                }`}
              >
                {gravando ? <Square className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
              </button>
            )}

            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Envia a tua dúvida, imagem ou áudio…"
              maxLength={800}
              aria-label="Mensagem para o assistente"
              className="h-11 min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
            />
            <button
              type="submit"
              disabled={!podeEnviar}
              aria-label="Enviar mensagem"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {aEnviar ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
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
