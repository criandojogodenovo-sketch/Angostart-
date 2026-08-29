'use client';

/**
 * AngoStart — Editor do portfólio público (/dashboard/vendedor/portfolio).
 *
 * Edita bio do portfólio, foto (URL), especialidade, cidade, link externo
 * e gere a galeria de trabalhos (imagens por URL https).
 * O resultado é publicado em /portfolio/[username].
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, Loader2, Lock, Plus, Trash2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth, authHeaders } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';

interface PortfolioItem {
  id: number;
  title: string;
  description: string;
  image_url: string;
  created_at: string;
}

interface PortfolioData {
  portfolio: {
    id: number;
    name: string;
    username: string | null;
    portfolio_bio: string | null;
    portfolio_image: string | null;
    especialidade: string | null;
    portfolio_url: string | null;
    cidade: string | null;
  } | null;
  items: PortfolioItem[];
}

export default function PortfolioEditorPage() {
  const { user, loading: authLoading, isSeller } = useAuth();
  const { toast } = useToast();

  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [saving, setSaving] = useState(false);

  const [bio, setBio] = useState('');
  const [image, setImage] = useState('');
  const [especialidade, setEspecialidade] = useState('');
  const [url, setUrl] = useState('');
  const [cidade, setCidade] = useState('');

  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newImage, setNewImage] = useState('');
  const [addingItem, setAddingItem] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/portfolio', { headers: authHeaders() });
      if (res.status === 401 || res.status === 403) {
        setUnauthorized(true);
        return;
      }
      const payload = (await res.json()) as PortfolioData;
      setData(payload);
      setBio(payload.portfolio?.portfolio_bio ?? '');
      setImage(payload.portfolio?.portfolio_image ?? '');
      setEspecialidade(payload.portfolio?.especialidade ?? '');
      setUrl(payload.portfolio?.portfolio_url ?? '');
      setCidade(payload.portfolio?.cidade ?? '');
    } catch {
      toast({ title: 'Erro de ligação', description: 'Não foi possível carregar o portfólio.' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !isSeller) {
      setUnauthorized(true);
      setLoading(false);
      return;
    }
    load();
  }, [authLoading, user, isSeller, load]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/portfolio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          portfolio_bio: bio,
          portfolio_image: image,
          especialidade,
          portfolio_url: url,
          cidade,
        }),
      });
      const payload = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !payload.ok) {
        toast({ title: 'Não foi possível guardar', description: payload.error });
        return;
      }
      toast({ title: 'Portfólio guardado!', description: 'Visível em /portfolio/' + (data?.portfolio?.username ?? user?.username) });
    } catch {
      toast({ title: 'Erro de ligação', description: 'Tenta novamente em instantes.' });
    } finally {
      setSaving(false);
    }
  }

  async function addItem(event: React.FormEvent) {
    event.preventDefault();
    setAddingItem(true);
    try {
      const res = await fetch('/api/portfolio/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ title: newTitle, description: newDesc, image_url: newImage }),
      });
      const payload = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !payload.ok) {
        toast({ title: 'Trabalho não adicionado', description: payload.error });
        return;
      }
      toast({ title: 'Trabalho adicionado ao portfólio' });
      setNewTitle('');
      setNewDesc('');
      setNewImage('');
      load();
    } finally {
      setAddingItem(false);
    }
  }

  async function removeItem(id: number) {
    try {
      const res = await fetch(`/api/portfolio/items/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.ok) {
        toast({ title: 'Trabalho removido' });
        load();
      }
    } catch {
      toast({ title: 'Erro de ligação' });
    }
  }

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-400">
        <Loader2 className="mr-3 h-5 w-5 animate-spin text-emerald-500" />
        <span className="text-sm">A carregar o portfólio…</span>
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center sm:px-6">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-rose-100">
          <Lock className="h-8 w-8 text-rose-500" />
        </span>
        <h1 className="mt-5 text-2xl font-bold text-slate-900">Acesso restrito</h1>
        <p className="mt-2 text-sm text-slate-500">
          O editor de portfólio é exclusivo para vendedores AngoStart.
        </p>
        <Button asChild className="mt-8 h-11 bg-emerald-500 px-6 font-semibold text-white hover:bg-emerald-600">
          <Link href="/perfil">Entrar como vendedor</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link
        href="/dashboard/vendedor"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-emerald-600"
      >
        <ArrowLeft className="h-4 w-4" /> Voltar ao painel de vendas
      </Link>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 sm:text-3xl">
          <UserRound className="h-7 w-7 text-emerald-500" /> O meu portfólio público
        </h1>
        {data?.portfolio?.username && (
          <Button asChild variant="outline" className="h-10 border-emerald-500 text-emerald-600 hover:bg-emerald-50">
            <Link href={`/portfolio/${data.portfolio.username}`} target="_blank">
              Ver página pública <ExternalLink className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Esta informação aparece na tua página pública <strong>/portfolio/{data?.portfolio?.username ?? '…'}</strong>.
      </p>

      {/* Perfil do portfólio */}
      <form onSubmit={saveProfile} className="mt-8 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Perfil</h2>
        <div className="space-y-1.5">
          <Label htmlFor="pf-bio">Bio do portfólio</Label>
          <Textarea
            id="pf-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Conta aos clientes quem és, a tua experiência e o que te diferencia…"
            className="min-h-28"
            maxLength={1000}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pf-img">Foto (URL https)</Label>
            <Input
              id="pf-img"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="https://…/foto.jpg"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-esp">Especialidade</Label>
            <Input
              id="pf-esp"
              value={especialidade}
              onChange={(e) => setEspecialidade(e.target.value)}
              placeholder="Ex.: Design gráfico, Eletricista…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-url">Link externo (opcional)</Label>
            <Input
              id="pf-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://meusite.ao"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-cidade">Cidade</Label>
            <Input
              id="pf-cidade"
              value={cidade}
              onChange={(e) => setCidade(e.target.value)}
              placeholder="Ex.: Luanda"
            />
          </div>
        </div>
        <Button
          type="submit"
          disabled={saving}
          className="h-12 w-full bg-emerald-500 font-semibold text-white hover:bg-emerald-600 disabled:opacity-60 sm:w-48"
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar portfólio
        </Button>
      </form>

      {/* Novo trabalho */}
      <form onSubmit={addItem} className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Adicionar trabalho</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pf-titulo">Título</Label>
            <Input
              id="pf-titulo"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Ex.: Identidade visual — Café Kimbo"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-imgurl">Imagem (URL https)</Label>
            <Input
              id="pf-imgurl"
              value={newImage}
              onChange={(e) => setNewImage(e.target.value)}
              placeholder="https://…/trabalho.jpg"
              required
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf-desc">Descrição (opcional)</Label>
          <Textarea
            id="pf-desc"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Descreve o trabalho em 1-2 frases…"
            className="min-h-16"
          />
        </div>
        <Button
          type="submit"
          disabled={addingItem}
          className="h-11 bg-slate-900 font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {addingItem ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Adicionar ao portfólio
        </Button>
      </form>

      {/* Galeria atual */}
      <section aria-label="Trabalhos no portfólio" className="mt-6">
        <h2 className="text-base font-semibold text-slate-900">
          Trabalhos publicados ({data?.items?.length ?? 0})
        </h2>
        {(data?.items?.length ?? 0) === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
            O teu portfólio está vazio — adiciona o teu primeiro trabalho acima.
          </p>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {data!.items.map((item) => (
              <li key={item.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                { }
                <img loading="lazy" src={item.image_url} alt={item.title} className="h-40 w-full object-cover" />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                    <button
                      onClick={() => removeItem(item.id)}
                      aria-label={`Remover ${item.title}`}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {item.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.description}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
