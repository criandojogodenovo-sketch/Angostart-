'use client';

/**
 * AngoStart — Secção de comentários (Fase 11).
 *
 * Reutilizável para os 3 alvos do sistema:
 *   - target_type='product' → página de detalhe do produto
 *   - target_type='seller'  → portfólio público do vendedor
 *   - target_type='store'   → página da loja virtual
 *
 * Diferente das avaliações (estrelas): qualquer conta autenticada pode
 * comentar. O conteúdo é escapado pelo React e foi sanitizado na API
 * (defesa em profundidade contra XSS armazenado). O autor pode apagar
 * os seus comentários; admins podem moderar qualquer um (a API valida).
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageSquare, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth, authHeaders } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import VerifiedBadge from '@/components/VerifiedBadge';

export type CommentTargetType = 'product' | 'seller' | 'store';

interface CommentItem {
  id: number;
  content: string;
  created_at: string;
  user_id: number | null;
  user_name: string | null;
  user_username: string | null;
  user_verified?: boolean;
}

const MAX_CONTENT = 1000;

export default function CommentsSection({
  targetType,
  targetId,
  title = 'Comentários',
}: {
  targetType: CommentTargetType;
  targetId: number;
  title?: string;
}) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/comments?target_type=${targetType}&target_id=${targetId}`,
        { cache: 'no-store' }
      );
      const data = (await res.json()) as { comments?: CommentItem[] };
      setComments(data.comments ?? []);
    } catch {
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [targetType, targetId]);

  useEffect(() => {
    if (!targetId) return;
    load();
  }, [targetId, load]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (content.trim().length < 2 || sending) return;

    setSending(true);
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ target_type: targetType, target_id: targetId, content }),
      });
      const data = (await res.json()) as { ok?: boolean; comment?: CommentItem; error?: string };
      if (!res.ok || !data.ok || !data.comment) {
        toast({
          title: 'Não foi possível comentar',
          description: data.error ?? 'Tenta novamente em instantes.',
        });
        return;
      }
      setComments((prev) => [data.comment as CommentItem, ...prev]);
      setContent('');
      toast({ title: 'Comentário publicado', description: 'Obrigado por participares!' });
    } catch {
      toast({ title: 'Erro de ligação', description: 'Tenta novamente em instantes.' });
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(id: number) {
    if (deletingId) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/comments?id=${id}`, {
        method: 'DELETE',
        headers: { ...authHeaders() },
      });
      if (res.ok) {
        setComments((prev) => prev.filter((c) => c.id !== id));
        toast({ title: 'Comentário apagado' });
      } else {
        const data = (await res.json()) as { error?: string };
        toast({
          title: 'Não foi possível apagar',
          description: data.error ?? 'Tenta novamente em instantes.',
        });
      }
    } catch {
      toast({ title: 'Erro de ligação', description: 'Tenta novamente em instantes.' });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section aria-label={title} className="mt-12">
      <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900">
        <MessageSquare className="h-5 w-5 text-blue-600" />
        {title} ({comments.length})
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Comentários são livres e não precisam de compra — diferente das avaliações com estrelas.
      </p>

      {/* Formulário (apenas autenticados) */}
      {user ? (
        <form onSubmit={handleSubmit} className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={MAX_CONTENT}
            rows={3}
            placeholder="Escreve um comentário construtivo…"
            aria-label="Escrever comentário"
            className="min-h-20 text-sm"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {content.length}/{MAX_CONTENT}
            </span>
            <Button
              type="submit"
              disabled={sending || content.trim().length < 2}
              className="h-10 bg-blue-600 px-5 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {sending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Publicar
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-500">
          Entra na tua conta para comentares.
        </p>
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-slate-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin text-blue-600" />
          <span className="text-sm">A carregar comentários…</span>
        </div>
      ) : comments.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400">
          Ainda não há comentários — sê o primeiro a escrever!
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900">
                  {c.user_name ?? 'Utilizador AngoStart'}
                  {c.user_username && (
                    <span className="ml-1 text-xs font-normal text-slate-400">@{c.user_username}</span>
                  )}
                  {c.user_verified && <VerifiedBadge size={13} />}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">
                    {new Date(c.created_at).toLocaleDateString('pt-PT')}
                  </span>
                  {user && c.user_id === user.id && (
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id)}
                      disabled={deletingId === c.id}
                      aria-label="Apagar o meu comentário"
                      className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                    >
                      {deletingId === c.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                {c.content}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
