'use client';

/**
 * AngoStart — Aba Busbt: publicidade em vídeo (Mux).
 *
 * - Dois separadores com contadores (a aba «Comunidade» é a
 *   predefinição): "Os Meus Vídeos" (histórico do utilizador logado,
 *   com estado vazio e atalho para publicar) e "Vídeos da Comunidade"
 *   (grelha pública — thumbnail → modal com Mux Player — sem os
 *   vídeos do próprio).
 * - "Publicar Vídeo": seleção (MP4/WebM/MOV ≤ 100 MB) + título/descrição
 *   opcionais → POST /api/upload/video → PUT direto browser→Mux
 *   (com barra de progresso) → POST /api/videos/confirm.
 * - Spinner enquanto processam (polling a cada 10 s), player quando
 *   prontos e cartão «Falha no processamento» quando deram erro.
 * - O token MUX_* vive só no servidor; o browser recebe apenas o URL
 *   assinado de Direct Upload.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  BadgeCheck,
  Clapperboard,
  Film,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  UploadCloud,
  X,
} from 'lucide-react';
import { useAuth, getToken } from '@/context/AuthContext';
import {
  ACCEPTED,
  MAX_BYTES,
  isAcceptableVideoFile,
  MuxUploadError,
  putFileToMux,
  resolveVideoMime,
  safeOrigin,
} from '@/lib/mux-upload-client';
import {
  dedupeVideosById,
  mergeVideosById,
} from '@/lib/video-list';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

/* O Mux Player é um Web Component (Lit) — só pode carregar no browser. */
const MuxPlayer = dynamic(() => import('@mux/mux-player-react'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-950">
      <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
    </div>
  ),
});

interface VideoItem {
  id: string;
  user_id: number;
  title: string;
  description: string | null;
  status: 'uploading' | 'processing' | 'ready' | 'errored';
  playback_id: string | null;
  duration_seconds: number | null;
  error_message: string | null;
  created_at: string;
  author_name?: string | null;
  author_username?: string | null;
  author_verified?: boolean | null;
}

type PublishStep = 'idle' | 'creating' | 'sending' | 'confirming' | 'done';

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ── Causa raiz do «modal não fecha após 100%»: o POST /api/videos/confirm
   não tinha timeout — se o pedido pendurasse (rede móvel instável, cold
   start da serverless, API do Mux lenta), o fluxo ficava preso em
   step='confirming' para sempre e isPublishing=true bloqueava o fecho do
   diálogo. Agora: 15 s no confirm, 20 s na criação do Direct Upload. */
const CONFIRM_TIMEOUT_MS = 15_000;
const CREATE_TIMEOUT_MS = 20_000;

/** Mensagem exigida para falha no passo de confirmação (o ficheiro JÁ
    chegou ao Mux — o problema é só o registo/estado no servidor). */
const CONFIRM_FAIL_MESSAGE =
  'O vídeo foi enviado, mas não conseguiu ser registado. Tenta atualizar a página.';

/** Erro do passo de confirmação — o PUT já concluiu; o «Tentar
    novamente» refaz APENAS o confirm, sem re-enviar o vídeo. */
class ConfirmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfirmError';
  }
}

interface ConfirmResult {
  ok: boolean;
  status?: string;
  error?: string;
}

/**
 * POST /api/videos/confirm com timeout (AbortController) e leitura de
 * JSON tolerante a corpos não-JSON (ex.: página HTML de 502 da Vercel,
 * que fazia confirmRes.json() rebentar com um erro críptico).
 *
 * - Lança em falha de rede/timeout (o chamador decide a mensagem).
 * - Caso contrário devolve { ok, status?, error? }.
 * - Log exato para diagnóstico no F12: [Busbt] Confirm response.
 */
async function confirmUpload(
  videoId: string | null,
  token: string
): Promise<ConfirmResult> {
  if (!videoId) return { ok: false, error: 'sem videoId' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIRM_TIMEOUT_MS);
  try {
    const res = await fetch('/api/videos/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ videoId }),
      signal: controller.signal,
    });
    let data: { status?: string; error?: string } = {};
    try {
      data = await res.json();
    } catch {
      /* corpo não-JSON (erro de plataforma) — tratado como !ok abaixo */
    }
    console.log('[Busbt] Confirm response', {
      videoId,
      httpStatus: res.status,
      ok: res.ok,
      body: data,
    });
    return { ok: res.ok, status: data?.status, error: data?.error };
  } finally {
    clearTimeout(timer);
  }
}

/** fetch + JSON com timeout — evita modal congelado em rede lenta.
    Corpo não-JSON é tolerado (data = null) em vez de lançar críptico. */
async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    let data: T | null = null;
    try {
      data = await res.json();
    } catch {
      /* corpo não-JSON — ok=false/route trata */
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export default function BusbtClient() {
  const { user, loading: authLoading } = useAuth();
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [myVideos, setMyVideos] = useState<VideoItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  /* Publicação */
  const [dialogOpen, setDialogOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [step, setStep] = useState<PublishStep>('idle');
  const [progress, setProgress] = useState(0);
  const [publishError, setPublishError] = useState<string | null>(null);
  /* Hotfix UX: aviso "Tentativa 2 de 4…" durante retries de rede —
     o utilizador deixa de pensar que o envio morreu a meio. */
  const [retryNote, setRetryNote] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /* Guarda o videoId da tentativa atual — usado pelo resgate pós-erro. */
  const lastVideoIdRef = useRef<string | null>(null);
  /* PUT já concluído com sucesso para ESTE ficheiro — o «Tentar
     novamente» após falha do confirm refaz APENAS o confirm, sem
     re-enviar o vídeo (até 100 MB) para o Mux. */
  const putSucceededRef = useRef<{
    videoId: string;
    fileName: string;
    fileSize: number;
  } | null>(null);
  /* Guarda SÍNCRONA contra duplo clique: refs atualizam sem re-render,
     ao contrário do estado `step` (assíncrono) — dois cliques rápidos
     liam ambos step === 'idle' e criavam 2 uploads (cartões duplicados). */
  const publishingRef = useRef(false);
  /* Direct Upload da tentativa atual — o retry REUTILIZA o mesmo
     uploadId/uploadUrl em vez de criar uma nova linha (que ficava
     presa em 'uploading' e aparecia como cartão extra "A finalizar
     envio…"). O reuso só acontece para o MESMO ficheiro (nome+tamanho). */
  const savedAttemptRef = useRef<{
    videoId: string;
    uploadUrl: string;
    fileName: string;
    fileSize: number;
  } | null>(null);

  /* Publicação em curso — desativa botões/campos e impede fechar o diálogo. */
  const isPublishing =
    step === 'creating' || step === 'sending' || step === 'confirming';

  /* Modal de reprodução */
  const [playing, setPlaying] = useState<VideoItem | null>(null);

  /* Separadores (TAREFA UX): «Comunidade» é a predefinição — o histórico
     do utilizador deixa de empurrar a grelha pública para baixo. */
  const [activeTab, setActiveTab] = useState<'comunidade' | 'meus'>(
    'comunidade'
  );

  /* ─────────────────── Carregamento / polling ─────────────────── */

  const loadPublic = useCallback(async () => {
    try {
      const res = await fetch('/api/videos', { cache: 'no-store' });
      const data = await res.json();
      /* Dedupe por id: nunca renderizar o mesmo vídeo 2× na grelha. */
      setVideos(
        dedupeVideosById(Array.isArray(data.videos) ? data.videos : [])
      );
      setListError(null);
    } catch {
      setListError('Não foi possível carregar a grelha de vídeos.');
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadMine = useCallback(async () => {
    if (!getToken()) {
      setMyVideos([]);
      return;
    }
    try {
      /* include=stale: o servidor aplica o timeout de 15 min E verifica
         os pendentes no Mux (self-healing quando o webhook não chega)
         antes de devolver a lista — o cartão existente é atualizado. */
      const res = await fetch('/api/videos?meu=1&include=stale', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.status === 401 || res.status === 403) {
        /* Sessão realmente inválida — limpa. */
        setMyVideos([]);
        return;
      }
      if (!res.ok) {
        /* Erro transiente (5xx/rate limit): MANTÉM a lista atual —
           limpar faria os cartões pendentes piscar/somecer durante
           o polling e depois ressurgir (parecia duplicação). */
        return;
      }
      const data = await res.json();
      if (!Array.isArray(data.videos)) return;
      /* Funde por id (Map): o polling ATUALIZA o cartão existente
         (mesmo key={id} → React reutiliza o DOM) em vez de criar
         cartões novos; ids repetidos nunca geram cartões duplicados. */
      setMyVideos((prev) => mergeVideosById(prev, data.videos));
    } catch (loadError) {
      /* Não derruba a UI — mas deixa de ser silencioso: registava no
         console a razão pela qual um cartão novo não aparecia. */
      console.warn('[Busbt] loadMine falhou (rede?)', loadError);
    }
  }, []);

  useEffect(() => {
    loadPublic();
  }, [loadPublic]);

  useEffect(() => {
    if (!authLoading) loadMine();
  }, [authLoading, loadMine]);

  /* Polling a cada 10 s enquanto algum vídeo meu está pendente. */
  const hasPending = myVideos.some(
    (v) => v.status === 'uploading' || v.status === 'processing'
  );
  useEffect(() => {
    if (!hasPending) return;
    const interval = setInterval(() => {
      loadMine();
      loadPublic();
    }, 10_000);
    return () => clearInterval(interval);
  }, [hasPending, loadMine, loadPublic]);

  /* ─────────────────────── Publicar vídeo ─────────────────────── */

  const pickFile = (f: File | null) => {
    setPublishError(null);
    if (!f) {
      setFile(null);
      return;
    }
    /* Alguns WebViews móveis devolvem File.type vazio — aceita pela
       extensão (resolveVideoMime trata do MIME no envio). */
    if (!isAcceptableVideoFile(f)) {
      setPublishError('Formato não suportado — usa MP4, WebM ou MOV.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setPublishError('O vídeo deve ter no máximo 100 MB.');
      return;
    }
    setFile(f);
  };

  const resetDialog = () => {
    setFile(null);
    setTitle('');
    setDescription('');
    setProgress(0);
    setStep('idle');
    setPublishError(null);
    setRetryNote(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const publish = async () => {
    /* Guarda SÍNCRONA contra duplo clique: o 2.º clique entra aqui
       ANTES de o re-render desativar o botão (o estado `step` é
       assíncrono) — o ref bloqueia na hora e devolve, sem criar
       um segundo upload/cartão. */
    if (publishingRef.current) return;
    if (!file) {
      setPublishError('Escolhe primeiro um ficheiro de vídeo.');
      return;
    }
    publishingRef.current = true;
    setPublishError(null);
    const token = getToken();
    if (!token) {
      publishingRef.current = false;
      setPublishError('Sessão expirada — entra novamente para publicar.');
      return;
    }
    try {
      /* 1. Reutiliza o Direct Upload já criado para ESTE ficheiro
            (retry: mesma linha na BD, mesmo cartão — sem duplicar)
            ou cria um novo na primeira tentativa. */
      const saved = savedAttemptRef.current;
      const reuse =
        !!saved && saved.fileName === file.name && saved.fileSize === file.size;
      /* O PUT já foi concluído com sucesso para ESTE ficheiro? (falha
         só no confirm) — «Tentar novamente» NÃO reenvia o vídeo ao
         Mux: refaz apenas o POST /api/videos/confirm. */
      const putAlreadyDone =
        !!saved &&
        reuse &&
        !!putSucceededRef.current &&
        putSucceededRef.current.videoId === saved.videoId &&
        putSucceededRef.current.fileName === file.name &&
        putSucceededRef.current.fileSize === file.size;
      let uploadUrl: string;
      let videoId: string;
      if (saved && reuse) {
        uploadUrl = saved.uploadUrl;
        videoId = saved.videoId;
        lastVideoIdRef.current = videoId;
        console.info('[Busbt] A reutilizar o Direct Upload (retry)', {
          videoId,
        });
      } else {
        setStep('creating');
        /* Timeout na criação: sem ele, um pedido preso deixava o modal
           congelado em «A preparar…» (mesma classe do bug do confirm). */
        const created = await fetchJsonWithTimeout<{
          uploadUrl: string;
          videoId: string;
          corsOrigin?: string;
          error?: string;
        }>(
          '/api/upload/video',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              filename: file.name,
              /* MIME resolvido pela extensão quando o browser não o informa. */
              contentType: resolveVideoMime(file),
              size: file.size,
              title,
              description,
            }),
          },
          CREATE_TIMEOUT_MS
        );
        if (!created.ok || !created.data) {
          throw new Error(created.data?.error || 'Falha ao iniciar o upload.');
        }
        const createdData = created.data;
        uploadUrl = createdData.uploadUrl;
        videoId = createdData.videoId;
        savedAttemptRef.current = {
          videoId,
          uploadUrl,
          fileName: file.name,
          fileSize: file.size,
        };
        lastVideoIdRef.current = videoId;
        console.info('[Busbt] Direct Upload criado', {
          videoId: createdData.videoId,
          corsOrigin: createdData.corsOrigin,
          urlOrigin: safeOrigin(createdData.uploadUrl),
        });
      }

      /* 2. PUT direto browser → Mux (o vídeo não passa pelo servidor).
            Skip se o PUT já foi concluído — o retry refaz só o confirm
            (evita re-enviar 100 MB por uma falha de confirmação). */
      if (putAlreadyDone) {
        console.log(
          '[Busbt] Upload já concluído — a refazer apenas o confirm…',
          { videoId }
        );
      } else {
        setStep('sending');
        setProgress(0);
        setRetryNote(null);
        try {
          await putFileToMux(uploadUrl, file, setProgress, (attempt, maxAttempts, reason) => {
            const causa =
              reason === 'timeout'
                ? 'envio lento'
                : reason === 'http'
                  ? 'erro do servidor'
                  : 'ligação instável';
            setRetryNote(`Ligação instável (${causa}) — tentativa ${attempt} de ${maxAttempts}…`);
          });
          /* PUT 200 — os 100% são reais: o Mux confirmou a receção. */
          putSucceededRef.current = {
            videoId,
            fileName: file.name,
            fileSize: file.size,
          };
          setRetryNote(null);
        } catch (putError) {
          /* URL definitivamente rejeitado (400/403/410 — expirado ou já
             usado): descarta a tentativa guardada para o próximo retry
             criar um upload novo. Falhas de rede/timeout MANTÊM o URL —
             o retry reutiliza-o em vez de criar outra linha na BD. */
          if (reuse && putError instanceof MuxUploadError && putError.kind === 'http') {
            savedAttemptRef.current = null;
            console.warn(
              '[Busbt] Direct Upload reutilizado foi rejeitado — o próximo retry cria um novo',
              { status: putError.status }
            );
          }
          throw putError;
        }
      }

      /* 3. Cartão «A processar» IMEDIATO — requisito do CTO: assim que
            o upload chega a 100% e ANTES do confirm, o cartão já existe
            na lista «Os Meus Vídeos». Se o confirm falhar, o utilizador
            continua a ver o estado e o polling (hasPending → 10 s, com
            self-healing no servidor) atualiza-o sozinho. */
      setMyVideos((prev) =>
        prev.some((v) => v.id === videoId)
          ? prev /* já existe (retry) — nunca regredir o estado atual */
          : mergeVideosById(prev, [
              {
                id: videoId,
                user_id: user?.id ?? 0,
                title: title || file.name,
                description: description || null,
                status: 'uploading',
                playback_id: null,
                duration_seconds: null,
                error_message: null,
                created_at: new Date().toISOString(),
                author_name: user?.name ?? null,
                author_username: user?.username ?? null,
                author_verified: null,
              },
            ])
      );
      setActiveTab('meus'); /* o cartão fica visível ao fechar o diálogo */

      /* 4. Confirmar: o Mux cria o asset e passa a processar.
            Timeout de 15 s (AbortController) — a causa raiz do «modal
            não fecha após 100%» era este pedido poder pendurar para
            sempre, com isPublishing=true a bloquear o fecho. */
      console.log('[Busbt] Upload complete, calling confirm...', {
        videoId,
      });
      setStep('confirming');
      let confirmResult: ConfirmResult;
      try {
        confirmResult = await confirmUpload(videoId, token);
      } catch (confirmNetError) {
        console.error('[Busbt] Confirm não respondeu (rede/timeout)', {
          videoId,
          error: confirmNetError,
        });
        throw new ConfirmError(CONFIRM_FAIL_MESSAGE);
      }
      if (!confirmResult.ok) {
        throw new ConfirmError(
          confirmResult.error
            ? `${CONFIRM_FAIL_MESSAGE} (${confirmResult.error})`
            : CONFIRM_FAIL_MESSAGE
        );
      }

      /* 5. Sucesso — fecha o diálogo e mostra o estado "a processar". */
      setStep('done');
      savedAttemptRef.current = null;
      putSucceededRef.current = null;
      setDialogOpen(false);
      setActiveTab('meus'); /* o novo cartão aparece já na aba certa */
      resetDialog();
      loadMine();
    } catch (error) {
      /* ⚠️ Caso especial (CORS na resposta): o ficheiro PODE ter chegado
         ao Mux mesmo com "erro de rede" — o browser bloqueou a resposta,
         mas o Mux processou o PUT. Confirma antes de declarar falha. */
      try {
        const token2 = getToken();
        /* Reutiliza o confirmUpload (timeout + log) no resgate. */
        const rescue = token2
          ? await confirmUpload(lastVideoIdRef.current, token2)
          : null;
        if (
          rescue?.ok &&
          (rescue.status === 'processing' || rescue.status === 'ready')
        ) {
          console.info(
            '[Busbt] O vídeo chegou ao Mux apesar do erro de rede — a processar normalmente.'
          );
          setStep('done');
          savedAttemptRef.current = null;
          putSucceededRef.current = null;
          setDialogOpen(false);
          setActiveTab('meus');
          resetDialog();
          loadMine();
          return;
        }
      } catch {
        /* sem resgate — mostra o erro real abaixo */
      }
      setPublishError(
        error instanceof Error
          ? error.message
          : 'Erro inesperado ao publicar.'
      );
      setStep('idle');
    } finally {
      publishingRef.current = false;
    }
  };

  /* Reutiliza o ficheiro escolhido numa nova tentativa (sem re-selecionar). */
  const retryPublish = () => {
    if (file) void publish();
  };

  const removeVideo = async (videoId: string) => {
    const token = getToken();
    if (!token) return;
    try {
      await fetch(`/api/videos/${videoId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setMyVideos((prev) => prev.filter((v) => v.id !== videoId));
      loadPublic();
    } catch {
      /* silencioso */
    }
  };

  /* Vídeos da comunidade = públicos que NÃO são do utilizador logado
     (os dele vivem na aba «Os Meus Vídeos» — sem duplicar cartões). */
  const communityVideos = user
    ? videos.filter((v) => v.user_id !== user.id)
    : videos;

  /* ─────────────────────────── Renders ────────────────────────── */

  const statusCard = (v: VideoItem) => {
    if (v.status === 'processing' || v.status === 'uploading') {
      return (
        <div className="flex aspect-[9/16] flex-col items-center justify-center gap-3 rounded-2xl border border-blue-200 bg-blue-50/60 p-4 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm font-semibold text-blue-800">
            {v.status === 'uploading' ? 'A finalizar envio…' : 'A processar vídeo…'}
          </p>
          <p className="text-xs text-blue-600">
            O Mux está a preparar o streaming — fica pronto em instantes.
          </p>
        </div>
      );
    }
    if (v.status === 'errored') {
      return (
        <div className="flex aspect-[9/16] flex-col items-center justify-center gap-3 rounded-2xl border border-rose-200 bg-rose-50/60 p-4 text-center">
          <TriangleAlert className="h-8 w-8 text-rose-500" />
          <p className="text-sm font-semibold text-rose-700">Falha no processamento</p>
          <p className="text-xs text-rose-500">
            {v.error_message || 'Tenta publicar novamente com outro ficheiro.'}
          </p>
          <button
            type="button"
            onClick={() => removeVideo(v.id)}
            className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
          >
            <Trash2 className="h-3.5 w-3.5" /> Remover
          </button>
        </div>
      );
    }
    /* ready → player inline (o dono vê o resultado imediatamente) */
    if (v.playback_id) {
      return (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 shadow-md">
          <MuxPlayer
            playbackId={v.playback_id}
            streamType="on-demand"
            accentColor="#2563eb"
            playsInline
            style={{ aspectRatio: '9 / 16', width: '100%' }}
            metadata={{ video_id: v.id, video_title: v.title }}
          />
        </div>
      );
    }
    return null;
  };

  const publicCard = (v: VideoItem) => (
    <button
      key={v.id}
      type="button"
      onClick={() => setPlaying(v)}
      className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 text-left shadow-md transition-transform hover:-translate-y-1 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      aria-label={`Reproduzir vídeo: ${v.title}`}
    >
      <div className="relative aspect-[9/16] w-full">
        {v.playback_id ? (
          <img
            src={`https://image.mux.com/${v.playback_id}/thumbnail.jpg?width=480&height=854&fit_mode=pad&smart_crop=true`}
            alt={v.title}
            loading="lazy"
            className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-slate-800">
            <Film className="h-10 w-10 text-slate-500" />
          </div>
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 shadow-lg transition-transform group-hover:scale-110">
            <Play className="ml-0.5 h-6 w-6 text-blue-600" fill="currentColor" />
          </span>
        </span>
        {v.duration_seconds ? (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
            {formatDuration(v.duration_seconds)}
          </span>
        ) : null}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3 pt-8">
          <p className="line-clamp-2 text-sm font-semibold text-white">{v.title}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-300">
            {v.author_name || 'Vendedor AngoStart'}
            {v.author_verified && (
              <BadgeCheck className="h-3.5 w-3.5 text-blue-400" aria-label="Identidade verificada" />
            )}
          </p>
        </div>
      </div>
    </button>
  );

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-24 pt-8 sm:px-6 md:pb-12 lg:px-8">
      {/* Cabeçalho hero */}
      <section className="glass-pill relative overflow-hidden rounded-3xl px-6 py-8 sm:px-10">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gradient-to-br from-blue-500/30 to-teal-400/30 blur-3xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-violet-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-violet-700">
              <Clapperboard className="h-3.5 w-3.5" /> Publicidade em vídeo
            </p>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              Busbt
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
              Mostra o teu produto ou serviço em vídeo e aparece para toda a
              comunidade AngoStart. Publica em MP4, WebM ou MOV (até 100 MB) —
              o streaming corre na infraestrutura do Mux, sem consumir a tua
              conta.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-3">
            {user ? (
              <button
                type="button"
                onClick={() => {
                  resetDialog();
                  setDialogOpen(true);
                }}
                disabled={isPublishing}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-600/25 transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPublishing ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Plus className="h-5 w-5" />
                )}
                Publicar Vídeo
              </button>
            ) : (
              <Link
                href="/entrar"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-600/25 transition-colors hover:bg-blue-700"
              >
                <UploadCloud className="h-5 w-5" /> Entra para publicar
              </Link>
            )}
            <button
              type="button"
              onClick={() => {
                setListLoading(true);
                loadPublic();
                loadMine();
              }}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white/70 px-6 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-white"
            >
              <RefreshCw className="h-4 w-4" /> Atualizar grelha
            </button>
          </div>
        </div>
      </section>

      {/* Separadores com contadores — «Comunidade» é a predefinição.
          Em vez de scroll contínuo, cada secção vive na sua aba. */}
      <div
        role="tablist"
        aria-label="Secções de vídeos"
        className="glass-pill mx-auto mt-8 grid w-full max-w-xl grid-cols-2 gap-1.5 rounded-2xl p-1.5"
      >
        <button
          type="button"
          role="tab"
          id="busbt-tab-comunidade"
          aria-selected={activeTab === 'comunidade'}
          aria-controls="busbt-panel-comunidade"
          onClick={() => setActiveTab('comunidade')}
          className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            activeTab === 'comunidade'
              ? 'bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-600/25'
              : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
          }`}
        >
          <Film className="h-4 w-4 shrink-0" />
          <span className="truncate">
            <span className="hidden sm:inline">Vídeos da </span>Comunidade
          </span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
              activeTab === 'comunidade'
                ? 'bg-white/25 text-white'
                : 'bg-slate-200/80 text-slate-600'
            }`}
          >
            {communityVideos.length}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          id="busbt-tab-meus"
          aria-selected={activeTab === 'meus'}
          aria-controls="busbt-panel-meus"
          onClick={() => setActiveTab('meus')}
          className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            activeTab === 'meus'
              ? 'bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-600/25'
              : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
          }`}
        >
          <UploadCloud className="h-4 w-4 shrink-0" />
          <span className="truncate">Os Meus Vídeos</span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
              activeTab === 'meus'
                ? 'bg-white/25 text-white'
                : 'bg-slate-200/80 text-slate-600'
            }`}
          >
            {myVideos.length}
          </span>
        </button>
      </div>

      {/* Painel: Os Meus Vídeos (apenas do utilizador logado) */}
      {activeTab === 'meus' && (
        <section
          id="busbt-panel-meus"
          role="tabpanel"
          aria-labelledby="busbt-tab-meus"
          className="mt-8"
          aria-label="Os meus vídeos"
        >
          {!user ? (
            <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-16 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-600/25">
                <UploadCloud className="h-7 w-7" />
              </div>
              <div className="space-y-1">
                <p className="text-base font-bold text-slate-800">
                  Entra para ver os teus vídeos
                </p>
                <p className="mx-auto max-w-sm text-sm text-slate-500">
                  O histórico das tuas publicações vive aqui — entra na tua
                  conta para publicar e acompanhar o processamento.
                </p>
              </div>
              <Link
                href="/entrar"
                className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/25 transition-colors hover:bg-blue-700"
              >
                <UploadCloud className="h-4 w-4" /> Entra para publicar
              </Link>
            </div>
          ) : myVideos.length === 0 ? (
            <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-16 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-600/25">
                <Clapperboard className="h-7 w-7" />
              </div>
              <div className="space-y-1">
                <p className="text-base font-bold text-slate-800">
                  Ainda não publicaste nenhum vídeo
                </p>
                <p className="mx-auto max-w-sm text-sm text-slate-500">
                  Mostra o teu produto ou serviço em vídeo e aparece para
                  toda a comunidade — publica o teu primeiro vídeo na Busbt.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  resetDialog();
                  setDialogOpen(true);
                }}
                disabled={isPublishing}
                className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/25 transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> Publicar o meu primeiro vídeo
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {myVideos.map((v) => (
                <div key={v.id} className="space-y-2">
                  {statusCard(v)}
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 text-xs font-semibold text-slate-700">
                      {v.title}
                    </p>
                    {v.status === 'ready' && (
                      <button
                        type="button"
                        onClick={() => removeVideo(v.id)}
                        aria-label={`Eliminar vídeo ${v.title}`}
                        className="shrink-0 rounded-full p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Painel: Vídeos da Comunidade (públicos, sem os vídeos do próprio) */}
      {activeTab === 'comunidade' && (
        <section
          id="busbt-panel-comunidade"
          role="tabpanel"
          aria-labelledby="busbt-tab-comunidade"
          className="mt-8"
          aria-label="Vídeos da comunidade"
        >
          {listLoading ? (
            <div className="flex items-center justify-center gap-3 py-16 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              <span className="text-sm">A carregar vídeos…</span>
            </div>
          ) : listError ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 py-12 text-center">
              <TriangleAlert className="h-8 w-8 text-amber-500" />
              <p className="text-sm font-medium text-amber-800">{listError}</p>
              <button
                type="button"
                onClick={() => {
                  setListLoading(true);
                  loadPublic();
                }}
                className="rounded-full bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700"
              >
                Tentar novamente
              </button>
            </div>
          ) : communityVideos.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-16 text-center">
              <Clapperboard className="h-10 w-10 text-slate-300" />
              <p className="max-w-sm text-sm text-slate-500">
                {user
                  ? 'Ainda não há vídeos de outros membros. Publica o teu na aba «Os Meus Vídeos» — sê o primeiro!'
                  : 'Ainda não há vídeos publicados. Entra na tua conta e publica o primeiro!'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {communityVideos.map(publicCard)}
            </div>
          )}
        </section>
      )}

      {/* Diálogo: publicar vídeo */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          /* Impede fechar durante QUALQUER passo ativo (creating/
             sending/confirming) — fechar e reabrir permitia submeter
             o mesmo ficheiro de novo enquanto o 1.º upload decorria. */
          if (!open && !isPublishing) {
            setDialogOpen(false);
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="max-h-[90dvh] overflow-y-auto rounded-3xl sm:max-w-lg">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <UploadCloud className="h-5 w-5 text-blue-600" /> Publicar vídeo na Busbt
          </DialogTitle>

          <div className="space-y-4 pt-2">
            <div>
              <label htmlFor="busbt-file" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Ficheiro de vídeo (MP4, WebM ou MOV — máx. 100 MB)
              </label>
              <input
                ref={fileInputRef}
                id="busbt-file"
                type="file"
                accept={ACCEPTED}
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                disabled={isPublishing}
                className="block w-full cursor-pointer rounded-xl border border-slate-300 bg-white text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-700"
              />
              {file && (
                <p className="mt-1.5 text-xs text-slate-500">
                  {file.name} — {(file.size / (1024 * 1024)).toFixed(1)} MB
                </p>
              )}
            </div>

            <div>
              <label htmlFor="busbt-title" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Título <span className="font-normal text-slate-400">(opcional)</span>
              </label>
              <input
                id="busbt-title"
                type="text"
                maxLength={80}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Pão caseiro fresco todos os dias"
                disabled={isPublishing}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-4 py-2.5 text-sm text-foreground outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:focus:ring-blue-500/25"
              />
            </div>

            <div>
              <label htmlFor="busbt-desc" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Descrição <span className="font-normal text-slate-400">(opcional)</span>
              </label>
              <textarea
                id="busbt-desc"
                maxLength={500}
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Conta o que o vídeo mostra e como encomendar…"
                disabled={isPublishing}
                className="w-full resize-none rounded-xl border border-slate-300 bg-transparent px-4 py-2.5 text-sm text-foreground outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:focus:ring-blue-500/25"
              />
            </div>

            {step === 'sending' && (
              <div>
                <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600">
                  <span>A enviar para o Mux…</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-600 to-teal-500 transition-all duration-200"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                {retryNote && (
                  <p className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800">
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" /> {retryNote}
                  </p>
                )}
              </div>
            )}

            {step === 'confirming' && (
              <p className="flex items-center gap-2 text-sm text-blue-700">
                <Loader2 className="h-4 w-4 animate-spin" /> A confirmar o envio…
              </p>
            )}

            {publishError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                <p className="text-sm font-medium text-rose-700">{publishError}</p>
                <p className="mt-1 text-xs text-rose-500">
                  Detalhes técnicos em F12 → Console (procura «[Busbt] Upload
                  Mux falhou») — inclui origens, estado HTTP e resposta do Mux.
                </p>
                {file && (
                  <button
                    type="button"
                    onClick={retryPublish}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-rose-700"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                disabled={isPublishing}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                <X className="mr-1 inline h-4 w-4" /> Cancelar
              </button>
              <button
                type="button"
                onClick={publish}
                disabled={!file || isPublishing}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPublishing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {step === 'sending'
                      ? `A enviar… ${progress}%`
                      : step === 'creating'
                        ? 'A preparar…'
                        : 'A confirmar…'}
                  </>
                ) : (
                  <>
                    <UploadCloud className="h-4 w-4" /> Publicar
                  </>
                )}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Diálogo: reproduzir vídeo público */}
      <Dialog open={!!playing} onOpenChange={(open) => { if (!open) setPlaying(null); }}>
        <DialogContent aria-describedby={undefined} className="max-h-[95dvh] overflow-y-auto rounded-3xl bg-slate-950 p-3 sm:max-w-md [&>button]:text-white">
          <DialogTitle className="sr-only">{playing?.title ?? 'Vídeo'}</DialogTitle>
          {playing?.playback_id && (
            <div className="space-y-3">
              <MuxPlayer
                playbackId={playing.playback_id}
                streamType="on-demand"
                accentColor="#2563eb"
                playsInline
                autoPlay
                style={{ aspectRatio: '9 / 16', width: '100%', borderRadius: '1rem' }}
                metadata={{ video_id: playing.id, video_title: playing.title }}
              />
              <div className="px-1 pb-1 text-white">
                <p className="text-base font-bold">{playing.title}</p>
                {playing.description && (
                  <p className="mt-1 text-sm text-slate-300">{playing.description}</p>
                )}
                <p className="mt-1 text-xs text-slate-400">
                  Publicado por {playing.author_name || 'vendedor AngoStart'}
                  {playing.author_verified && ' ✓ identidade verificada'}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
