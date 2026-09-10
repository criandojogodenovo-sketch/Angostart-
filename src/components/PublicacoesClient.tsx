'use client';

/**
 * GOMBUONE — Publicações: feed social (substitui o extinto Busbt).
 *
 * - Separadores «Comunidade» (feed público) e «As Minhas» (do vendedor).
 * - Cartões com autor, imagem, título, conteúdo, «gostar» (optimista),
 *   comentários expansíveis e CÓDIGO DE CONTACTO → perfil do vendedor.
 * - FAB «Criar Publicação» para vendedores autenticados.
 * - Degradação graciosa: BD inacessível → estado vazio, página viva.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  BadgeCheck,
  Camera,
  Heart,
  Loader2,
  MessageCircle,
  Newspaper,
  Plus,
  Send,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { authHeaders, useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import CreatePostDialog, { type CreatedPost } from '@/components/CreatePostDialog';

/* ─────────────────────────── Tipos ─────────────────────────── */

interface FeedPost {
  id: number;
  title: string;
  content: string;
  image_url: string | null;
  contact_code: string | null;
  created_at: string;
  author: {
    id: number;
    name: string;
    username: string | null;
    role: string;
    profile_image: string | null;
  };
  likes: number;
  comments: number;
  liked_by_me: boolean;
  is_mine: boolean;
}

interface PostComment {
  id: number;
  content: string;
  created_at: string;
  user_id: number | null;
  user_name: string | null;
  user_username: string | null;
  user_image: string | null;
}

type Tab = 'comunidade' | 'minhas';

/* ─────────────────────── Helpers ─────────────────────── */

/** «há 5 min», «há 3 h», «há 2 d», senão data curta pt-PT. */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d} d`;
  return new Date(iso).toLocaleDateString('pt-PT', {
    day: 'numeric',
    month: 'short',
  });
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/* ─────────────────────── Página ─────────────────────── */

export default function PublicacoesClient() {
  const { user, isSeller } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('comunidade');
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [zoomPost, setZoomPost] = useState<FeedPost | null>(null);

  /* Comentários por post (carregados ao expandir) */
  const [openComments, setOpenComments] = useState<Set<number>>(new Set());
  const [commentsByPost, setCommentsByPost] = useState<
    Record<number, PostComment[]>
  >({});
  const [commentsLoading, setCommentsLoading] = useState<Set<number>>(new Set());
  const [commentDraft, setCommentDraft] = useState<Record<number, string>>({});
  const [sendingComment, setSendingComment] = useState<number | null>(null);

  /* Confirmação de apagar (armar → confirmar) */
  const [armDelete, setArmDelete] = useState<number | null>(null);

  /* ── Carregar feed ── */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const mine = tab === 'minhas';
      const res = await fetch(`/api/posts${mine ? '?meu=1' : ''}`, {
        cache: 'no-store',
        headers: user ? authHeaders() : undefined,
      });
      const data = (await res.json()) as { posts?: FeedPost[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível carregar as publicações.');
        setPosts([]);
        return;
      }
      setPosts(data.posts ?? []);
    } catch {
      setError('Erro de ligação — verifica a tua internet e tenta novamente.');
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [tab, user]);

  useEffect(() => {
    load();
  }, [load]);

  /* Se um visitante entra na tab «minhas» sem sessão, volta à comunidade */
  useEffect(() => {
    if (tab === 'minhas' && !user) setTab('comunidade');
  }, [tab, user]);

  /* ── Gostar (optimista) ── */
  async function toggleLike(post: FeedPost) {
    if (!user) {
      toast({
        title: 'Entra para reagir',
        description: 'Precisas de sessão para gostar de publicações.',
      });
      return;
    }
    const optimistic = !post.liked_by_me;
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? {
              ...p,
              liked_by_me: optimistic,
              likes: p.likes + (optimistic ? 1 : -1),
            }
          : p
      )
    );
    try {
      const res = await fetch(`/api/posts/${post.id}/like`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('falhou');
      const data = (await res.json()) as { liked: boolean; likes: number };
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? { ...p, liked_by_me: data.liked, likes: data.likes }
            : p
        )
      );
    } catch {
      // rollback
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? {
                ...p,
                liked_by_me: !optimistic,
                likes: p.likes,
              }
            : p
        )
      );
      toast({ title: 'Não foi possível registar', description: 'Tenta novamente.' });
    }
  }

  /* ── Comentários ── */
  async function loadComments(postId: number) {
    setCommentsLoading((prev) => new Set(prev).add(postId));
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        cache: 'no-store',
      });
      const data = (await res.json()) as { comments?: PostComment[] };
      setCommentsByPost((prev) => ({ ...prev, [postId]: data.comments ?? [] }));
    } catch {
      setCommentsByPost((prev) => ({ ...prev, [postId]: [] }));
    } finally {
      setCommentsLoading((prev) => {
        const next = new Set(prev);
        next.delete(postId);
        return next;
      });
    }
  }

  function toggleComments(post: FeedPost) {
    const isOpen = openComments.has(post.id);
    const next = new Set(openComments);
    if (isOpen) {
      next.delete(post.id);
    } else {
      next.add(post.id);
      if (!commentsByPost[post.id]) loadComments(post.id);
    }
    setOpenComments(next);
  }

  async function submitComment(post: FeedPost) {
    const draft = (commentDraft[post.id] ?? '').trim();
    if (draft.length < 2 || sendingComment) return;
    setSendingComment(post.id);
    try {
      const res = await fetch(`/api/posts/${post.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content: draft }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        comment?: PostComment;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.comment) {
        toast({
          title: 'Não foi possível comentar',
          description: data.error ?? 'Tenta novamente.',
        });
        return;
      }
      setCommentsByPost((prev) => ({
        ...prev,
        [post.id]: [...(prev[post.id] ?? []), data.comment as PostComment],
      }));
      setCommentDraft((prev) => ({ ...prev, [post.id]: '' }));
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id ? { ...p, comments: p.comments + 1 } : p
        )
      );
    } catch {
      toast({ title: 'Erro de ligação', description: 'Tenta novamente.' });
    } finally {
      setSendingComment(null);
    }
  }

  /* ── Apagar (armar → confirmar em 4 s) ── */
  async function handleDelete(post: FeedPost) {
    if (armDelete !== post.id) {
      setArmDelete(post.id);
      setTimeout(() => {
        setArmDelete((current) => (current === post.id ? null : current));
      }, 4000);
      return;
    }
    setArmDelete(null);
    try {
      const res = await fetch(`/api/posts/${post.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({
          title: 'Não foi possível apagar',
          description: data.error ?? 'Tenta novamente.',
        });
        return;
      }
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      toast({ title: 'Publicação apagada' });
    } catch {
      toast({ title: 'Erro de ligação', description: 'Tenta novamente.' });
    }
  }

  /* ── Contacto: código → perfil ── */
  function contactSeller(post: FeedPost) {
    if (post.contact_code) {
      router.push(`/contato/${encodeURIComponent(post.contact_code)}`);
    } else if (post.author.username) {
      router.push(`/portfolio/${encodeURIComponent(post.author.username)}`);
    }
  }

  function copyCode(code: string) {
    navigator.clipboard
      ?.writeText(code)
      .then(() =>
        toast({ title: 'Código copiado', description: code })
      )
      .catch(() =>
        toast({ title: 'Código', description: code })
      );
  }

  function handleCreated(_post: CreatedPost) {
    load(); // recarrega o feed (autor/contadores vêm da BD)
    setTab('comunidade');
  }

  /* ─────────────────────── Render ─────────────────────── */

  const isAdmin = user?.role === 'admin';
  const canCreate = isSeller;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-32 pt-8 sm:px-6">
      {/* Cabeçalho */}
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 shadow-lg">
            <Newspaper className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              Public<span className="text-blue-600 dark:text-blue-400">ações</span>
            </h1>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              Novidades de produtos e serviços dos vendedores — gosta, comenta
              e contacta pelo código.
            </p>
          </div>
        </div>

        {/* Separadores */}
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('comunidade')}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              tab === 'comunidade'
                ? 'bg-blue-600 text-white shadow-md'
                : 'border border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-blue-500'
            }`}
          >
            Comunidade
          </button>
          {user && (
            <button
              type="button"
              onClick={() => setTab('minhas')}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                tab === 'minhas'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'border border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-blue-500'
              }`}
            >
              As Minhas
            </button>
          )}
          <button
            type="button"
            onClick={load}
            aria-label="Atualizar feed"
            className="ml-auto rounded-full border border-slate-200 bg-white p-2.5 text-slate-500 transition hover:text-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-blue-400"
          >
            <Loader2
              className={`h-4 w-4 ${loading ? 'animate-spin text-blue-600' : ''}`}
            />
          </button>
        </div>
      </header>

      {/* Estados */}
      {loading && posts.length === 0 ? (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 py-16 text-slate-400 dark:border-slate-700">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          <span className="text-sm">A carregar publicações…</span>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-dashed border-rose-300 bg-rose-50 p-8 text-center dark:border-rose-500/40 dark:bg-rose-500/10">
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">
            {error}
          </p>
          <Button
            onClick={load}
            variant="outline"
            className="mt-4 h-10 border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10"
          >
            Tentar novamente
          </Button>
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
          {canCreate ? (
            <>
              <Camera className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
              <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                {tab === 'minhas'
                  ? 'Ainda não publicaste nada'
                  : 'Sê o primeiro a publicar!'}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Partilha novidades dos teus produtos ou serviços.
              </p>
              <Button
                onClick={() => setCreateOpen(true)}
                className="mt-5 h-11 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 px-6 font-semibold text-white shadow-md hover:from-blue-700 hover:to-purple-700"
              >
                <Plus className="mr-2 h-4 w-4" /> Criar Publicação
              </Button>
            </>
          ) : (
            <>
              <Newspaper className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
              <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Ainda não há publicações
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Volta em breve — os vendedores estão a preparar novidades.
              </p>
            </>
          )}
        </div>
      ) : (
        <ul className="space-y-5">
          {posts.map((post) => {
            const commentsOpen = openComments.has(post.id);
            const comments = commentsByPost[post.id] ?? [];
            const commentsBusy = commentsLoading.has(post.id);
            const draft = commentDraft[post.id] ?? '';
            return (
              <li
                key={post.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
              >
                {/* Autor */}
                <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  {post.author.profile_image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={post.author.profile_image}
                      alt={`Foto de ${post.author.name}`}
                      loading="lazy"
                      className="h-10 w-10 shrink-0 rounded-full border border-slate-200 object-cover dark:border-slate-700"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-purple-600 text-sm font-bold text-white">
                      {initials(post.author.name) || <User className="h-5 w-5" />}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900 dark:text-white">
                      {post.author.username ? (
                        <Link
                          href={`/portfolio/${encodeURIComponent(post.author.username)}`}
                          className="truncate hover:text-blue-600 dark:hover:text-blue-400"
                        >
                          {post.author.name}
                        </Link>
                      ) : (
                        <span className="truncate">{post.author.name}</span>
                      )}
                      <BadgeCheck className="h-4 w-4 shrink-0 text-sky-500" aria-label="Vendedor" />
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      @{post.author.username ?? 'vendedor'} · {timeAgo(post.created_at)}
                    </p>
                  </div>
                  {(post.is_mine || isAdmin) && (
                    <button
                      type="button"
                      onClick={() => handleDelete(post)}
                      aria-label={
                        armDelete === post.id
                          ? 'Confirmar apagar'
                          : 'Apagar a minha publicação'
                      }
                      className={`rounded-lg p-2 transition ${
                        armDelete === post.id
                          ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400'
                          : 'text-slate-300 hover:bg-rose-50 hover:text-rose-500 dark:text-slate-600 dark:hover:bg-rose-500/10'
                      }`}
                    >
                      {armDelete === post.id ? (
                        <span className="text-xs font-bold">Confirmar</span>
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>

                {/* Imagem */}
                {post.image_url && (
                  <button
                    type="button"
                    onClick={() => setZoomPost(post)}
                    aria-label="Ampliar imagem da publicação"
                    className="block w-full"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={post.image_url}
                      alt={`Imagem: ${post.title}`}
                      loading="lazy"
                      className="max-h-[560px] w-full bg-slate-50 object-cover dark:bg-slate-950"
                    />
                  </button>
                )}

                {/* Texto */}
                <div className="px-4 py-4 sm:px-5">
                  <h2 className="text-lg font-bold leading-snug text-slate-900 dark:text-white">
                    {post.title}
                  </h2>
                  <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                    {post.content}
                  </p>
                </div>

                {/* Acções */}
                <div className="flex flex-wrap items-center gap-1 border-t border-slate-100 px-2 py-2 dark:border-slate-800 sm:px-3">
                  <button
                    type="button"
                    onClick={() => toggleLike(post)}
                    aria-pressed={post.liked_by_me}
                    aria-label={post.liked_by_me ? 'Remover gosto' : 'Gostar'}
                    className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                      post.liked_by_me
                        ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400'
                        : 'text-slate-500 hover:bg-rose-50 hover:text-rose-500 dark:text-slate-400 dark:hover:bg-rose-500/10'
                    }`}
                  >
                    <Heart
                      className={`h-5 w-5 ${post.liked_by_me ? 'fill-current' : ''}`}
                    />
                    {post.likes > 0 && post.likes}
                    {post.likes === 0 && 'Gostar'}
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleComments(post)}
                    aria-expanded={commentsOpen}
                    className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-slate-500 transition hover:bg-blue-50 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-blue-500/10 dark:hover:text-blue-400"
                  >
                    <MessageCircle className="h-5 w-5" />
                    {post.comments > 0 ? post.comments : 'Comentar'}
                  </button>

                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    {post.contact_code && (
                      <button
                        type="button"
                        onClick={() => copyCode(post.contact_code as string)}
                        title="Copiar código de contacto"
                        aria-label={`Copiar código ${post.contact_code}`}
                        className="rounded-xl border border-slate-200 px-3 py-1.5 font-mono text-xs text-slate-500 transition hover:border-blue-300 hover:text-blue-600 dark:border-slate-700 dark:text-slate-400 dark:hover:border-blue-500"
                      >
                        {post.contact_code}
                      </button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => contactSeller(post)}
                      className="h-9 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
                    >
                      Contactar Vendedor
                    </Button>
                  </div>
                </div>

                {/* Comentários (expansível) */}
                {commentsOpen && (
                  <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-4 dark:border-slate-800 dark:bg-slate-950/40 sm:px-5">
                    {commentsBusy ? (
                      <div className="flex items-center justify-center gap-2 py-4 text-slate-400">
                        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                        <span className="text-xs">A carregar comentários…</span>
                      </div>
                    ) : (
                      <>
                        {comments.length === 0 ? (
                          <p className="py-2 text-center text-xs text-slate-400 dark:text-slate-500">
                            Ainda sem comentários — sê o primeiro!
                          </p>
                        ) : (
                          <ul className="space-y-3">
                            {comments.map((c) => (
                              <li
                                key={c.id}
                                className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                              >
                                <div className="flex items-center gap-2">
                                  {c.user_image ? (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img
                                      src={c.user_image}
                                      alt=""
                                      loading="lazy"
                                      className="h-6 w-6 rounded-full object-cover"
                                    />
                                  ) : (
                                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                      {initials(c.user_name ?? '?')}
                                    </span>
                                  )}
                                  <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
                                    {c.user_name ?? 'Membro'}
                                    {c.user_username && (
                                      <span className="ml-1 font-normal text-slate-400">
                                        @{c.user_username}
                                      </span>
                                    )}
                                  </span>
                                  <span className="ml-auto text-[11px] text-slate-400">
                                    {timeAgo(c.created_at)}
                                  </span>
                                </div>
                                <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                                  {c.content}
                                </p>
                              </li>
                            ))}
                          </ul>
                        )}

                        {/* Formulário */}
                        {user ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              submitComment(post);
                            }}
                            className="mt-3 flex items-end gap-2"
                          >
                            <Textarea
                              value={draft}
                              onChange={(e) =>
                                setCommentDraft((prev) => ({
                                  ...prev,
                                  [post.id]: e.target.value,
                                }))
                              }
                              maxLength={1000}
                              rows={2}
                              placeholder="Escreve um comentário…"
                              aria-label="Escrever comentário"
                              className="min-h-11 flex-1 resize-none rounded-xl border-slate-200 bg-white text-sm dark:border-slate-700 dark:bg-slate-900"
                            />
                            <Button
                              type="submit"
                              size="icon"
                              disabled={
                                draft.trim().length < 2 || sendingComment === post.id
                              }
                              aria-label="Enviar comentário"
                              className="h-11 w-11 shrink-0 rounded-xl bg-blue-600 hover:bg-blue-700"
                            >
                              {sendingComment === post.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Send className="h-4 w-4" />
                              )}
                            </Button>
                          </form>
                        ) : (
                          <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white p-3 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                            Entra na tua conta para comentar —{' '}
                            <Link href="/perfil" className="font-semibold text-blue-600 dark:text-blue-400">
                              Entrar
                            </Link>
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* FAB — Criar Publicação (vendedores) */}
      {canCreate && (
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          aria-label="Criar publicação"
          className="fixed bottom-24 right-4 z-40 flex h-14 items-center gap-2 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 px-5 font-semibold text-white shadow-lg shadow-blue-600/30 transition hover:shadow-xl hover:brightness-110 active:scale-95 md:bottom-8 md:right-8"
        >
          <Plus className="h-5 w-5" />
          <span className="hidden sm:inline">Criar Publicação</span>
        </button>
      )}

      {/* Modal de criação */}
      <CreatePostDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />

      {/* Zoom da imagem */}
      <Dialog open={zoomPost !== null} onOpenChange={(o) => !o && setZoomPost(null)}>
        <DialogContent
          className="max-w-3xl overflow-hidden rounded-2xl border-slate-200 bg-white p-0 dark:border-slate-800 dark:bg-slate-950"
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">
            Imagem da publicação: {zoomPost?.title}
          </DialogTitle>
          {zoomPost?.image_url && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={zoomPost.image_url}
              alt={`Imagem ampliada: ${zoomPost.title}`}
              className="max-h-[80vh] w-full bg-slate-50 object-contain dark:bg-slate-950"
            />
          )}
          {zoomPost && (
            <div className="flex items-start justify-between gap-3 px-5 py-4">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white">
                  {zoomPost.title}
                </h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  por {zoomPost.author.name} · {timeAgo(zoomPost.created_at)}
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  setZoomPost(null);
                  contactSeller(zoomPost);
                }}
                className="h-9 shrink-0 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Contactar Vendedor
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Nota de vazio para não-vendedores logados (sem FAB) */}
      {!canCreate && user && posts.length === 0 && !loading && !error && (
        <p className="mt-4 text-center text-xs text-slate-400 dark:text-slate-500">
          <X className="mr-1 inline h-3 w-3" />
          As publicações são criadas por vendedores — a tua conta de cliente
          pode gostar e comentar.
        </p>
      )}
    </main>
  );
}
