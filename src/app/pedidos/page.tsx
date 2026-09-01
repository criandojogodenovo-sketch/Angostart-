'use client';

/**
 * AngoStart — «Pedidos no Ar» (Fase 16, /pedidos).
 *
 * Marketplace de pedidos com ACEITAÇÃO ÚNICA (estilo Uber/DiDi):
 * - Qualquer utilizador publica um pedido (categoria, título, descrição,
 *   orçamento opcional, cidade).
 * - Prestadores veem o quadro de pedidos abertos e «Aceitar» — apenas o
 *   PRIMEIRO a confirmar ganha (transação atómica no servidor).
 * - Dono acompanha os seus pedidos (abertos/aceites/concluídos/cancelados),
 *   cancela ou marca como concluído.
 *
 * 🔒 Privacidade: nunca há contactos — tudo pelo chat interno.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  CheckCircle2,
  Clock,
  Filter,
  Inbox,
  Loader2,
  MapPin,
  Megaphone,
  PlusCircle,
  RefreshCw,
  Send,
  Sparkles,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth, authHeaders } from '@/context/AuthContext';
import ContactRequestsCard from '@/components/ContactRequestsCard';
import { formatKz } from '@/lib/format';
import {
  AIR_ORDER_CATEGORIES,
  airOrderCategoryLabel,
  type AirOrderRow,
} from '@/lib/air-orders';

type TabKey = 'abertos' | 'meus' | 'aceites' | 'contactos';

const STATUS_STYLE: Record<string, string> = {
  aberto: 'bg-blue-50 text-blue-700 ring-blue-200',
  aceite: 'bg-purple-50 text-purple-700 ring-purple-200',
  concluido: 'bg-teal-50 text-teal-700 ring-teal-200',
  cancelado: 'bg-slate-100 text-slate-500 ring-slate-200',
};

const STATUS_LABEL: Record<string, string> = {
  aberto: 'Aberto',
  aceite: 'Aceite',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} dia${days > 1 ? 's' : ''}`;
}

export default function PedidosPage() {
  const { user, loading } = useAuth();
  const { toast } = useToast();

  const [tab, setTab] = useState<TabKey>('abertos');
  const [categoria, setCategoria] = useState<string>('all');
  const [abertos, setAbertos] = useState<AirOrderRow[]>([]);
  const [meus, setMeus] = useState<AirOrderRow[]>([]);
  const [aceites, setAceites] = useState<AirOrderRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<number | null>(null);
  const [actingId, setActingId] = useState<number | null>(null);

  /* ── Publicar ── */
  const [publishOpen, setPublishOpen] = useState(false);
  const [pubTitle, setPubTitle] = useState('');
  const [pubCategory, setPubCategory] = useState('outro');
  const [pubDescription, setPubDescription] = useState('');
  const [pubBudget, setPubBudget] = useState('');
  const [pubCidade, setPubCidade] = useState('');
  const [publishing, setPublishing] = useState(false);

  const isProvider =
    user?.role === 'prestador_domicilio' ||
    user?.role === 'prestador_remoto' ||
    user?.role === 'criador';

  const loadAbertos = useCallback(
    async (silent = false) => {
      if (!silent) setListLoading(true);
      try {
        const params = new URLSearchParams();
        if (categoria !== 'all') params.set('categoria', categoria);
        params.set('limit', '40');
        const res = await fetch(`/api/air-orders?${params.toString()}`, {
          cache: 'no-store',
        });
        const data = (await res.json()) as { items?: AirOrderRow[]; error?: string };
        if (res.ok && data.items) setAbertos(data.items);
      } catch {
        /* silencioso — retry no próximo ciclo */
      } finally {
        if (!silent) setListLoading(false);
      }
    },
    [categoria]
  );

  const loadMeus = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/air-orders?meus=1', {
        headers: authHeaders(),
        cache: 'no-store',
      });
      const data = (await res.json()) as { items?: AirOrderRow[] };
      if (res.ok && data.items) setMeus(data.items);
    } catch {
      /* silencioso */
    }
  }, [user]);

  const loadAceites = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/air-orders?aceites=1', {
        headers: authHeaders(),
        cache: 'no-store',
      });
      const data = (await res.json()) as { items?: AirOrderRow[] };
      if (res.ok && data.items) setAceites(data.items);
    } catch {
      /* silencioso */
    }
  }, [user]);

  useEffect(() => {
    loadAbertos();
  }, [loadAbertos]);

  useEffect(() => {
    if (user) {
      loadMeus();
      loadAceites();
    }
  }, [user, loadMeus, loadAceites]);

  /* Deep link das notificações: /pedidos?tab=contactos|meus|aceites */
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'meus' || t === 'aceites' || t === 'contactos' || t === 'abertos') {
      setTab(t);
    }
  }, []);

  /* Auto-refresh: abertos a cada 15 s (corrida pela aceitação) */
  const abertosRef = useRef(loadAbertos);
  abertosRef.current = loadAbertos;
  useEffect(() => {
    const id = window.setInterval(() => abertosRef.current(true), 15_000);
    return () => window.clearInterval(id);
  }, []);

  /* ── Ações ── */

  async function acceptOrder(orderId: number) {
    setAcceptingId(orderId);
    try {
      const res = await fetch(`/api/air-orders/${orderId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        toast({
          title: 'Pedido é teu! ✓',
          description: 'O cliente já foi notificado. Combina os detalhes pelo chat.',
        });
        loadAbertos(true);
        loadAceites();
      } else if (res.status === 409) {
        toast({
          title: 'Quase!',
          description: data.error ?? 'Pedido já aceite por outro prestador.',
          variant: 'destructive',
        });
        loadAbertos(true);
      } else {
        toast({ title: 'Não foi possível aceitar', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({
        title: 'Sem ligação',
        description: 'Verifica a tua internet e tenta aceitar novamente.',
        variant: 'destructive',
      });
    } finally {
      setAcceptingId(null);
    }
  }

  async function cancelOrder(orderId: number) {
    setActingId(orderId);
    try {
      const res = await fetch(`/api/air-orders/${orderId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        toast({ title: 'Pedido cancelado' });
        loadMeus();
        loadAbertos(true);
      } else {
        toast({ title: 'Não foi possível cancelar', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Sem ligação', description: 'Tenta novamente.', variant: 'destructive' });
    } finally {
      setActingId(null);
    }
  }

  async function completeOrder(orderId: number) {
    setActingId(orderId);
    try {
      const res = await fetch(`/api/air-orders/${orderId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        toast({ title: 'Pedido concluído ✓', description: 'O prestador foi notificado.' });
        loadMeus();
      } else {
        toast({ title: 'Não foi possível concluir', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Sem ligação', description: 'Tenta novamente.', variant: 'destructive' });
    } finally {
      setActingId(null);
    }
  }

  async function publish() {
    if (pubTitle.trim().length < 5) {
      toast({ title: 'Título muito curto', description: 'Pelo menos 5 caracteres.' });
      return;
    }
    if (pubDescription.trim().length < 10) {
      toast({ title: 'Descrição muito curta', description: 'Descreve o que precisas (mín. 10 caracteres).' });
      return;
    }
    setPublishing(true);
    try {
      const res = await fetch('/api/air-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          title: pubTitle.trim(),
          description: pubDescription.trim(),
          category: pubCategory,
          budget_kz: pubBudget.trim() === '' ? null : pubBudget.trim(),
          cidade: pubCidade.trim() || user?.cidade || null,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        toast({
          title: 'Pedido no ar! 🚀',
          description: 'Os prestadores já o estão a ver — o primeiro a aceitar ganha.',
        });
        setPublishOpen(false);
        setPubTitle('');
        setPubDescription('');
        setPubBudget('');
        setTab('meus');
        loadMeus();
        loadAbertos(true);
      } else {
        toast({ title: 'Não foi possível publicar', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({
        title: 'Sem ligação',
        description: 'A tua internet caiu — tenta publicar novamente.',
        variant: 'destructive',
      });
    } finally {
      setPublishing(false);
    }
  }

  /* ── Cartão de pedido ── */
  function renderCard(order: AirOrderRow, context: TabKey) {
    const isMine = user !== null && order.user_id === user.id;
    const acceptedByMe = user !== null && order.provider_id === user.id;
    return (
      <div
        key={order.id}
        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
                {airOrderCategoryLabel(order.category)}
              </span>
              {context !== 'abertos' && order.status && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${
                    STATUS_STYLE[order.status] ?? 'bg-slate-100 text-slate-500 ring-slate-200'
                  }`}
                >
                  {STATUS_LABEL[order.status] ?? order.status}
                </span>
              )}
              <span className="text-xs text-slate-400">{timeAgo(order.created_at)}</span>
            </div>
            <h3 className="truncate text-base font-bold text-slate-900">{order.title}</h3>
            <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-slate-600">
              {order.description}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              {order.cidade && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-blue-500" /> {order.cidade}
                </span>
              )}
              {order.budget_kz !== null && order.budget_kz !== undefined && (
                <span className="inline-flex items-center gap-1 font-semibold text-teal-700">
                  Orçamento: {formatKz(Number(order.budget_kz))}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />{' '}
                {isMine ? 'Publicaste tu' : (order.publisher_name ?? 'Cliente')}
              </span>
              {order.provider_name && (
                <span className="inline-flex items-center gap-1 text-purple-600">
                  <BadgeCheck className="h-3.5 w-3.5" /> Aceite por {order.provider_name}
                </span>
              )}
            </div>
          </div>

          {/* Ações por contexto */}
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-36">
            {context === 'abertos' && !isMine && (
              <>
                <Button
                  size="sm"
                  disabled={!isProvider || acceptingId === order.id || !user}
                  onClick={() => acceptOrder(order.id)}
                  className="h-10 bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700"
                >
                  {acceptingId === order.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Aceitar pedido
                </Button>
                {!isProvider && user && (
                  <p className="text-[11px] leading-tight text-slate-400">
                    Apenas vendedores e prestadores aceitam pedidos.
                  </p>
                )}
              </>
            )}
            {context === 'meus' && order.status === 'aberto' && (
              <Button
                size="sm"
                variant="outline"
                disabled={actingId === order.id}
                onClick={() => cancelOrder(order.id)}
                className="h-10 border-rose-200 text-rose-600 hover:bg-rose-50"
              >
                {actingId === order.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Ban className="h-4 w-4" />
                )}
                Cancelar
              </Button>
            )}
            {context === 'meus' && order.status === 'aceite' && (
              <Button
                size="sm"
                disabled={actingId === order.id}
                onClick={() => completeOrder(order.id)}
                className="h-10 bg-teal-600 text-white hover:bg-teal-700"
              >
                {actingId === order.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Concluir
              </Button>
            )}
            {context === 'aceites' && acceptedByMe && (
              <Link
                href="/chat"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-blue-600 to-purple-600 px-4 text-sm font-semibold text-white hover:from-blue-700 hover:to-purple-700"
              >
                Falar no chat
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-4xl px-4 pb-24 pt-6">
      {/* Cabeçalho */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              aria-label="Voltar"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="flex items-center gap-2 text-2xl font-extrabold text-slate-900">
              <Megaphone className="h-6 w-6 text-blue-600" />
              Pedidos no Ar
            </h1>
          </div>
          <p className="max-w-xl text-sm text-slate-600">
            Publica o que precisas ou aceita pedidos de clientes —{' '}
            <span className="font-semibold text-slate-800">
              apenas o primeiro prestador a confirmar ganha o pedido
            </span>
            , como na Uber. Sem contactos expostos: tudo pelo chat da plataforma.
          </p>
        </div>

        <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
          <DialogTrigger asChild>
            <Button className="hidden h-11 shrink-0 bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700 sm:inline-flex">
              <PlusCircle className="h-4 w-4" /> Publicar pedido
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Publicar um pedido no ar</DialogTitle>
              <DialogDescription>
                Descreve o serviço de que precisas. O primeiro prestador disponível
                a aceitar ganha o pedido — serás notificado na hora.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="pub-titulo">Título</Label>
                <Input
                  id="pub-titulo"
                  value={pubTitle}
                  onChange={(e) => setPubTitle(e.target.value)}
                  placeholder="Ex.: Preciso de electricista para instalar tomadas"
                  maxLength={140}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Categoria</Label>
                  <Select value={pubCategory} onValueChange={setPubCategory}>
                    <SelectTrigger aria-label="Categoria do pedido">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AIR_ORDER_CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pub-budget">Orçamento (Kz)</Label>
                  <Input
                    id="pub-budget"
                    value={pubBudget}
                    onChange={(e) => setPubBudget(e.target.value)}
                    placeholder="Opcional — ex.: 15000"
                    inputMode="numeric"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pub-desc">Descrição</Label>
                <Textarea
                  id="pub-desc"
                  value={pubDescription}
                  onChange={(e) => setPubDescription(e.target.value)}
                  placeholder="Explica o trabalho, o local e a hora. Não inclucas telefones — combinam pelo chat."
                  rows={4}
                  maxLength={2000}
                />
                <p className="text-[11px] text-slate-400">
                  🔒 Por privacidade, contactos (telefone/email/WhatsApp) são bloqueados
                  automaticamente.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pub-cidade">Cidade</Label>
                <Input
                  id="pub-cidade"
                  value={pubCidade}
                  onChange={(e) => setPubCidade(e.target.value)}
                  placeholder={user?.cidade ?? 'Ex.: Luanda'}
                  maxLength={80}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPublishOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={publish}
                disabled={publishing}
                className="bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700"
              >
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
                Pôr no ar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Publicar (mobile) */}
      {!user ? (
        <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-900">
          <span className="font-semibold">Entra na conta</span> para publicar pedidos ou
          aceitar trabalho.{' '}
          <Link href="/perfil" className="font-bold underline">
            Entrar / criar conta
          </Link>
        </div>
      ) : (
        <Button
          onClick={() => setPublishOpen(true)}
          className="mb-6 w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white sm:hidden"
        >
          <PlusCircle className="h-4 w-4" /> Publicar pedido
        </Button>
      )}

      {/* Tabs + filtros */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="mb-4 grid w-full grid-cols-2 sm:grid-cols-4">
          <TabsTrigger value="abertos">
            <Megaphone className="mr-1 h-4 w-4" /> No ar
          </TabsTrigger>
          <TabsTrigger value="meus">Os meus</TabsTrigger>
          <TabsTrigger value="aceites">Aceites</TabsTrigger>
          <TabsTrigger value="contactos">Contactos</TabsTrigger>
        </TabsList>

        <TabsContent value="abertos" className="space-y-4">
          {/* Filtro por categoria */}
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-slate-400" />
            <button
              onClick={() => setCategoria('all')}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                categoria === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Todas
            </button>
            {AIR_ORDER_CATEGORIES.map((c) => (
              <button
                key={c.value}
                onClick={() => setCategoria(c.value)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  categoria === c.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {listLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
            </div>
          ) : abertos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <Megaphone className="mx-auto mb-3 h-10 w-10 text-slate-300" />
              <p className="font-semibold text-slate-700">Nenhum pedido no ar nesta categoria</p>
              <p className="mt-1 text-sm text-slate-500">
                Publica o teu e os prestadores disponíveis recebem-no já.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {abertos.map((o) => renderCard(o, 'abertos'))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="meus" className="space-y-3">
          {meus.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <PlusCircle className="mx-auto mb-3 h-10 w-10 text-slate-300" />
              <p className="font-semibold text-slate-700">Ainda não publicaste pedidos</p>
              <p className="mt-1 text-sm text-slate-500">
                Clica em «Publicar pedido» e descreve o que precisas.
              </p>
            </div>
          ) : (
            meus.map((o) => renderCard(o, 'meus'))
          )}
        </TabsContent>

        <TabsContent value="aceites" className="space-y-3">
          {!user ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              Entra na conta para veres os pedidos que aceitaste.
            </div>
          ) : aceites.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <Clock className="mx-auto mb-3 h-10 w-10 text-slate-300" />
              <p className="font-semibold text-slate-700">Sem pedidos aceites</p>
              <p className="mt-1 text-sm text-slate-500">
                Vai à aba «No ar» e sê o primeiro a aceitar um pedido.
              </p>
            </div>
          ) : (
            aceites.map((o) => renderCard(o, 'aceites'))
          )}
        </TabsContent>

        <TabsContent value="contactos" className="space-y-6">
          {!user ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              Entra na conta para gerires os teus contactos.
            </div>
          ) : (
            <>
              {/* Pedidos recebidos (visível para vendedores/prestadores) */}
              {isProvider && (
                <div>
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
                    <Inbox className="h-4 w-4" /> Recebidos — clientes que querem falar contigo
                  </h2>
                  <ContactRequestsCard mode="recebidos" />
                </div>
              )}
              {/* Pedidos enviados (cliente) */}
              <div>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
                  <Send className="h-4 w-4" /> Pedidos de serviços que enviaste
                </h2>
                <ContactRequestsCard mode="enviados" />
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Rodapé de refresh */}
      <div className="mt-8 flex items-center justify-center gap-2 text-xs text-slate-400">
        <RefreshCw className="h-3.5 w-3.5" />
        A lista de pedidos no ar atualiza automaticamente a cada 15 segundos.
      </div>
    </div>
  );
}
