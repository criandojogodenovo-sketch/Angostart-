'use client';

/**
 * AngoStart — Aba Busbt: publicidade em vídeo (Mux).
 *
 * - Grelha pública de vídeos 'ready' (thumbnail → modal com Mux Player).
 * - "Publicar Vídeo": seleção (MP4/WebM/MOV ≤ 100 MB) + título/descrição
 *   opcionais → POST /api/upload/video → PUT direto browser→Mux
 *   (com barra de progresso) → POST /api/videos/confirm.
 * - Os vídeos do utilizador aparecem em "Os meus vídeos": spinner
 *   enquanto processam (polling a cada 10 s) e player quando prontos.
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

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB
const ACCEPTED = 'video/mp4,video/webm,video/quicktime';

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

/** PUT do ficheiro diretamente para o Mux, com progresso real. */
function putFileToMux(
  uploadUrl: string,
  file: File,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`O envio do vídeo falhou (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () =>
      reject(new Error('Erro de rede durante o envio do vídeo para o Mux.'));
    xhr.send(file);
  });
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Modal de reprodução */
  const [playing, setPlaying] = useState<VideoItem | null>(null);

  /* ─────────────────── Carregamento / polling ─────────────────── */

  const loadPublic = useCallback(async () => {
    try {
      const res = await fetch('/api/videos', { cache: 'no-store' });
      const data = await res.json();
      setVideos(Array.isArray(data.videos) ? data.videos : []);
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
      const res = await fetch('/api/videos?meu=1', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        setMyVideos([]);
        return;
      }
      const data = await res.json();
      setMyVideos(Array.isArray(data.videos) ? data.videos : []);
    } catch {
      /* silencioso — a grelha pública continua */
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
    if (!ACCEPTED.split(',').includes(f.type)) {
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
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const publish = async () => {
    if (!file) {
      setPublishError('Escolhe primeiro um ficheiro de vídeo.');
      return;
    }
    setPublishError(null);
    const token = getToken();
    if (!token) {
      setPublishError('Sessão expirada — entra novamente para publicar.');
      return;
    }
    try {
      /* 1. Pedir URL de Direct Upload ao servidor. */
      setStep('creating');
      const res = await fetch('/api/upload/video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          size: file.size,
          title,
          description,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao iniciar o upload.');

      /* 2. PUT direto browser → Mux (o vídeo não passa pelo servidor). */
      setStep('sending');
      setProgress(0);
      await putFileToMux(data.uploadUrl, file, setProgress);

      /* 3. Confirmar: o Mux cria o asset e passa a processar. */
      setStep('confirming');
      const confirmRes = await fetch('/api/videos/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ videoId: data.videoId }),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) {
        throw new Error(confirmData.error || 'Falha ao confirmar o upload.');
      }

      /* 4. Sucesso — fecha o diálogo e mostra o estado "a processar". */
      setStep('done');
      setDialogOpen(false);
      resetDialog();
      loadMine();
    } catch (error) {
      setPublishError(
        error instanceof Error ? error.message : 'Erro inesperado ao publicar.'
      );
      setStep('idle');
    }
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
        <div className="flex aspect-[9/16] flex-col items-center justify-center gap-3 rounded-2xl border border-red-200 bg-red-50/60 p-4 text-center">
          <TriangleAlert className="h-8 w-8 text-red-500" />
          <p className="text-sm font-semibold text-red-700">Falha no processamento</p>
          <p className="text-xs text-red-500">
            {v.error_message || 'Tenta publicar novamente com outro ficheiro.'}
          </p>
          <button
            type="button"
            onClick={() => removeVideo(v.id)}
            className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
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
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-600/25 transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                <Plus className="h-5 w-5" /> Publicar Vídeo
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

      {/* Os meus vídeos (autenticado) */}
      {user && myVideos.length > 0 && (
        <section className="mt-10" aria-label="Os meus vídeos">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-slate-900">
            <UploadCloud className="h-5 w-5 text-blue-600" /> Os meus vídeos
          </h2>
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
                      className="shrink-0 rounded-full p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Grelha pública */}
      <section className="mt-10" aria-label="Vídeos da comunidade">
        <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-slate-900">
          <Film className="h-5 w-5 text-violet-600" /> Vídeos da comunidade
        </h2>

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
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-16 text-center">
            <Clapperboard className="h-10 w-10 text-slate-300" />
            <p className="max-w-sm text-sm text-slate-500">
              Ainda não há vídeos publicados. Sê o primeiro a mostrar o teu
              produto ou serviço em vídeo — {user ? 'toca no botão «Publicar Vídeo».' : 'entra na tua conta e publica o primeiro!'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {videos.map(publicCard)}
          </div>
        )}
      </section>

      {/* Diálogo: publicar vídeo */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open && step !== 'sending') { setDialogOpen(false); } }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-3xl sm:max-w-lg">
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
                disabled={step === 'sending' || step === 'confirming'}
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
                disabled={step === 'sending' || step === 'confirming'}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
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
                disabled={step === 'sending' || step === 'confirming'}
                className="w-full resize-none rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
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
              </div>
            )}

            {step === 'confirming' && (
              <p className="flex items-center gap-2 text-sm text-blue-700">
                <Loader2 className="h-4 w-4 animate-spin" /> A confirmar o envio…
              </p>
            )}

            {publishError && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {publishError}
              </p>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                disabled={step === 'sending' || step === 'confirming'}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                <X className="mr-1 inline h-4 w-4" /> Cancelar
              </button>
              <button
                type="button"
                onClick={publish}
                disabled={!file || step === 'creating' || step === 'sending' || step === 'confirming'}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {step === 'sending' || step === 'confirming' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> A enviar…
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
        <DialogContent className="max-h-[95dvh] overflow-y-auto rounded-3xl bg-slate-950 p-3 sm:max-w-md [&>button]:text-white">
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
