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
 *
 * Hotfix set/2026 (CTO — «funcionar em qualquer rede e dispositivo»):
 * - P1 MIC: permissions.query ANTES de pedir; getUserMedia com teto 12 s
 *   (Androids deixavam o botão morto); MediaRecorder com fallback sem
 *   mimeType; permissão do site ativa + NotAllowedError = bloqueio do
 *   SISTEMA → mensagem alternativa dedicada (dados móveis/definições).
 * - P2: respostas completas — max_tokens 2048 no servidor (era 400/500).
 * - P3 AUTH: token do AuthContext em TODOS os envios (imagens/áudio eram
 *   401 mesmo autenticado); 401 → «A tua sessão expirou…».
 * - P4 LATÊNCIA: 70 s por tentativa + 1 retry com backoff só em falha de
 *   rede rápida (timeout não repete); JSON corrompido tem mensagem própria.
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
/* P3 (set/2026): token do AuthContext em TODOS os envios — sem o header
   Authorization o servidor tratava utilizador autenticado como anónimo e
   imagens/áudio eram rejeitados com «Entra na tua conta» (401). */
import { authHeaders } from '@/context/AuthContext';

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
/* P1: teto para o getUserMedia — em alguns Androids o pedido fica preso
   (hardware ocupado/driver lento) e o botão de gravar morria sem feedback. */
const MIC_GUM_TIMEOUT_MS = 12_000;
/* P4: backoff antes do retry de rede (só falha rápida; timeout não repete). */
const RETRY_BACKOFF_MS = 1_500;

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
        'Permissão do microfone NEGADA. Para ativar: ① toca no ícone de ' +
        'cadeado (ou ℹ️) na barra de endereço → Permissões → Microfone → ' +
        'Permitir; ② se já está permitido no navegador, o bloqueio é do ' +
        'TELEMÓVEL: Definições → Aplicações → Chrome → Permissões → ' +
        'Microfone → Permitir (iPhone: Definições → Safari → Microfone). ' +
        'Depois reabre o site e tenta de novo.'
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
    case 'MicTimeoutError':
      return (
        'O microfone não respondeu a tempo (o dispositivo demorou a ' +
        'libertá-lo ou está instável). Fecha outras apps que usem o micro, ' +
        'espera alguns segundos e tenta de novo — ou escreve a tua dúvida.'
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

/* ─────────────── P1: diagnóstico de permissão/microfone ─────────────── */

/**
 * Estado da permissão do microfone ANTES de pedir (P1.2). `unknown` se o
 * browser não suporta permissions.query (Safari antigo/Firefox) — nunca
 * lança nem bloqueia o fluxo normal.
 */
async function micPermissionState(): Promise<PermissionState | 'unknown'> {
  try {
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      const status = await navigator.permissions.query({
        name: 'microphone' as PermissionName,
      });
      return status.state;
    }
  } catch {
    /* alguns browsers lançam para 'microphone' — tratamos como desconhecido */
  }
  return 'unknown';
}

/**
 * getUserMedia com teto de tempo (P1.3): a API é local, mas em alguns
 * Androids fica presa sem responder (hardware/driver) — sem isto o botão
 * de gravar morria sem qualquer feedback. Lança erro sintético
 * `MicTimeoutError` quando excede o prazo.
 */
function getUserMediaComTimeout(
  constraints: MediaStreamConstraints,
  timeoutMs: number
): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error('getUserMedia excedeu o tempo limite');
      err.name = 'MicTimeoutError';
      reject(err);
    }, timeoutMs);
    navigator.mediaDevices!
      .getUserMedia(constraints)
      .then((stream) => {
        clearTimeout(timer);
        resolve(stream);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

/**
 * Mensagem final do microfone (P1.5): distingue «site bloqueou» de «Sistema
 * operativo bloqueou» — permissão do site ATIVA + NotAllowedError significa
 * que o bloqueio vem do Android/Sistema, não do navegador.
 */
function micFinalMessage(
  error: unknown,
  permState: PermissionState | 'unknown'
): string {
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String((error as { name?: unknown }).name)
      : '';
  if (
    (name === 'NotAllowedError' || name === 'PermissionDeniedError') &&
    permState === 'granted'
  ) {
    return (
      'Não foi possível aceder ao microfone. Tenta usar dados móveis ou ' +
      'verifica as definições do browser — a permissão do site está ativa, ' +
      'mas o acesso foi bloqueado pelo sistema: Definições do Android → ' +
      'Aplicações → Chrome → Permissões → Microfone → Permitir. Reabre o ' +
      'site e tenta de novo — ou escreve a tua dúvida.'
    );
  }
  return micErrorMessage(error);
}

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
    /* P1.2: verifica a permissão ANTES de pedir — se já está negada no
       navegador, nem chamamos getUserMedia (pedido condenado) e mostramos
       logo o caminho exato de desbloqueio. */
    const perm = await micPermissionState();
    if (perm === 'denied') {
      setErro(micErrorMessage({ name: 'NotAllowedError' }));
      return;
    }
    try {
      /* P1.3: getUserMedia com teto de 12 s — Androids com o micro preso
         deixavam o botão morto para sempre. */
      const stream = await getUserMediaComTimeout({ audio: true }, MIC_GUM_TIMEOUT_MS);
      /* P1.4: mimeType compatível — webm/opus (Android), mp4 (iPhone); se o
         construtor falhar com o mime anunciado (quirk conhecido em alguns
         Androids), repete SEM opções e deixa o browser escolher. */
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      } catch {
        console.warn('[SuporteIA] MediaRecorder falhou com mimeType=' + mime + ' — retry sem opções.');
        recorder = new MediaRecorder(stream);
      }
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
         microfone ≠ micro ocupado ≠ preso/timeout) e, quando a permissão
         do site está ATIVA mas o acesso falha, o bloqueio é do SISTEMA —
         mensagem alternativa dedicada (P1.5). */
      console.warn('[SuporteIA] getUserMedia falhou:', error, '— perm:', perm);
      setErro(micFinalMessage(error, perm));
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

    /* P3: token do AuthContext SEMPRE anexado — sem ele o servidor tratava
       o utilizador autenticado como anónimo e imagens/áudio eram rejeitados
       com «Entra na tua conta» mesmo com sessão ativa (causa raiz do bug). */
    const headers = { 'Content-Type': 'application/json', ...authHeaders() };
    const body = JSON.stringify({
      messages: seguintes
        .filter((t) => t !== ABERTURA)
        .slice(-8)
        .map((t) => ({ role: t.role, content: t.content })),
      ...(imagemEnviada ? { image: imagemEnviada.dataUrl } : {}),
      ...(audioEnviado ? { audio: audioEnviado.dataUrl } : {}),
    });

    try {
      /* P4: 70 s por tentativa (cadeia server-side tem 55 s). 1 retry com
         backoff de 1,5 s APENAS para falha de rede rápida (o pedido nem
         chegou a responder). Timeout NÃO repete — consumiu o orçamento
         todo e repetir duplicaria a espera (2×70 s). */
      let res: Response | null = null;
      let falha: unknown = null;
      for (let tentativa = 1; tentativa <= 2; tentativa++) {
        try {
          res = await fetch('/api/ai/chat', {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
          });
          break;
        } catch (e) {
          falha = e;
          const nome = e instanceof Error ? e.name : '';
          const isTimeout = nome === 'TimeoutError' || nome === 'AbortError';
          console.warn(
            `[SuporteIA] envio falhou (tentativa ${tentativa}/2, ` +
              `${isTimeout ? 'timeout' : 'rede'}):`,
            e
          );
          if (isTimeout || tentativa === 2) break;
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
        }
      }

      if (!res) {
        const nome = falha instanceof Error ? falha.name : '';
        const isTimeout = nome === 'TimeoutError' || nome === 'AbortError';
        setErro(
          isTimeout
            ? 'A resposta demorou demasiado (rede lenta ou instável). Verifica ' +
              'a ligação e tenta de novo — ou contacta o suporte no WhatsApp ' +
              '+244 958 176 915.'
            : 'Sem ligação ao servidor (falha de rede). Verifica o Wi-Fi ou os ' +
              'dados móveis e tenta de novo.'
        );
        return;
      }

      /* Resposta pode vir corrompida em ligações instáveis (JSON cortado) —
         nunca deixar o .json() rebentar sem mensagem amigável. */
      let data: { reply?: string; error?: string } = {};
      try {
        data = (await res.json()) as { reply?: string; error?: string };
      } catch {
        setErro(
          'A resposta chegou corrompida (ligação instável). Tenta de novo — ' +
            'se persistir, contacta o suporte no WhatsApp +244 958 176 915.'
        );
        return;
      }

      if (res.ok && data.reply) {
        setTurns((old) => [...old, { role: 'assistant', content: data.reply as string }]);
      } else if (res.status === 401) {
        /* P3: token ausente/expirado — mensagem CLARA de sessão em vez da
           genérica «Entra na tua conta para enviar imagens…». */
        setErro(
          'A tua sessão expirou. Faz login novamente para enviar imagens ou áudio ao suporte.'
        );
      } else {
        setErro(
          data.error ??
            'Não consegui responder agora — fala connosco no WhatsApp +244 958 176 915.'
        );
      }
    } catch (error) {
      console.warn('[SuporteIA] erro inesperado no envio:', error);
      setErro('Ocorreu um erro inesperado. Tenta de novo ou contacta o suporte.');
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
