'use client';

/**
 * AngoStart — Painel de vendas do vendedor (/dashboard/vendedor).
 *
 * 🔒 Acesso: apenas vendedores autenticados (criador, prestador_domicilio,
 * prestador_remoto). Clientes/visitantes são bloqueados; a API também
 * valida o role no servidor.
 *
 * - Cartões: vendas totais, receita confirmada, pendente, produtos publicados
 * - BarChart: receita por mês (últimos 6 meses)
 * - PieChart: produtos mais vendidos
 * - Lista: encomendas recebidas (cliente, artigo, preço, estado)
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Award,
  Bike,
  ClipboardList,
  Copy,
  Crosshair,
  ExternalLink,
  Flame,
  Loader2,
  Lock,
  MapPin,
  Medal,
  MessageCircle,
  Navigation,
  Package,
  PiggyBank,
  Receipt,
  Share2,
  ShieldAlert,
  Star,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { authHeaders } from '@/context/AuthContext';
import { formatKz } from '@/lib/format';
import { useToast } from '@/hooks/use-toast';
import ServiceMap from '@/components/ServiceMap';
import StoreEditorCard from '@/components/StoreEditorCard';

interface DashboardData {
  cards: {
    totalOrders: number;
    itemsSold: number;
    revenueConfirmed: number;
    revenueNet: number;
    commissionRetained: number;
    commissionPercent: number;
    revenuePending: number;
    productsPublished: number;
    clients: number;
    ratingAverage: number;
    ratingCount: number;
    chatMessages7d: number;
    complaints: number;
    suspicious: number;
  };
  revenueByMonth: { month: string; revenue: number }[];
  topProducts: { name: string; vendas: number; receita: number }[];
  recentReviews: {
    rating: number;
    comment: string | null;
    created_at: string;
    product_name: string;
    client_name: string | null;
  }[];
  alerts: { complaints: boolean; suspicious: boolean; message: string | null };
  orders: {
    id: number;
    customer_name: string;
    customer_phone: string;
    status: string;
    created_at: string;
    items: { name: string; price_kz: number; quantity: number; type: string | null }[];
    delivery_address: string | null;
    notes: string | null;
    tracking_active: boolean;
    service_started_at: string | null;
    service_completed: boolean;
    prestador_lat: number | null;
    prestador_lng: number | null;
    prestador_loc_updated_at: string | null;
    client_approx_lat: number | null;
    client_approx_lng: number | null;
    client_has_gps: boolean;
  }[];
}

interface MeuProduto {
  id: number;
  name: string;
  is_hot?: boolean;
  price_kz: number;
}

interface AffiliateData {
  codigo_afiliado: string;
  comissao_percentual: number;
  total_ganho: number;
  earnings: { id: number; order_id: number; comissao: number; status: string; created_at: string }[];
}

interface WalletSummary {
  saldo: number;
  saldo_bloqueado: number;
}

/** Proposta recebida de cliente (Fase 7 — negociação de preço/prazo). */
interface ProviderProposal {
  id: number;
  service_id: number;
  service_name: string | null;
  description: string;
  budget_kz: number;
  price_kz: number;
  deadline_days: number | null;
  status: string;
  created_at: string;
  updated_at: string;
  order_id: number | null;
  my_offer_standing: boolean;
  client_name: string | null;
  is_mine: boolean;
  rounds: number;
}

/** Histórico de uma negociação (contrapropostas — Fase 7). */
interface CounterEntry {
  id: number;
  price_kz: number;
  deadline_days: number | null;
  message: string | null;
  created_at: string;
  author_name: string | null;
  by_me: boolean;
}

/** Gamificação do vendedor (Fase 7). */
interface GamificationData {
  points: number;
  level: string;
  sales_count: number;
  badges: { code: string; name: string; description: string; icon: string; awarded_at: string }[];
  next_level: { key: string; label: string; missing: number } | null;
  progress: number;
  locked_badges: { code: string; name: string; description: string; icon: string }[];
}

const PIE_COLORS = ['#10b981', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ef4444'];

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  pendente: { label: 'Pendente', className: 'bg-amber-100 text-amber-700' },
  pago: { label: 'Pago', className: 'bg-emerald-100 text-emerald-700' },
  entregue: { label: 'Entregue', className: 'bg-emerald-100 text-emerald-700' },
  rejeitado: { label: 'Rejeitado', className: 'bg-rose-100 text-rose-700' },
  falhou: { label: 'Falhou', className: 'bg-rose-100 text-rose-700' },
};

export default function DashboardVendedorPage() {
  const { user, loading: authLoading, isSeller } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const { toast } = useToast();

  /* ── Fase 4: produtos (hot), afiliados e carteira ── */
  const [meusProdutos, setMeusProdutos] = useState<MeuProduto[]>([]);
  const [affiliate, setAffiliate] = useState<AffiliateData | null>(null);
  const [affiliateCarregado, setAffiliateCarregado] = useState(false);
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [hotBusyId, setHotBusyId] = useState<number | null>(null);
  const [aRegistarAfiliado, setARegistarAfiliado] = useState(false);

  const loadFase4 = useCallback(async () => {
    // Produtos do vendedor (toggle Em alta)
    fetch('/api/products?meu=1', { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { products?: MeuProduto[] } | null) =>
        setMeusProdutos(payload?.products ?? [])
      )
      .catch(() => setMeusProdutos([]));

    // Carteira (saldo + escrow)
    fetch('/api/wallet', { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: WalletSummary | null) => setWallet(payload))
      .catch(() => setWallet(null));

    // Afiliado (404 = ainda não aderiu)
    fetch('/api/affiliate', { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: AffiliateData | null) => setAffiliate(payload))
      .catch(() => setAffiliate(null))
      .finally(() => setAffiliateCarregado(true));
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !isSeller) {
      setUnauthorized(true);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch('/api/dashboard/vendedor', {
          headers: authHeaders(),
        });
        if (res.status === 401 || res.status === 403) {
          setUnauthorized(true);
          return;
        }
        const payload = (await res.json()) as DashboardData;
        setData(payload);
      } catch {
        toast({ title: 'Erro de ligação', description: 'Não foi possível carregar o painel.' });
      } finally {
        setLoading(false);
      }
    })();
    loadFase4();
  }, [authLoading, user, isSeller, toast, loadFase4]);

  /** Alterna o badge "Em alta" 🔥 de um produto (PATCH /api/products/[id]). */
  async function toggleHot(produto: MeuProduto) {
    setHotBusyId(produto.id);
    try {
      const res = await fetch(`/api/products/${produto.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ is_hot: !produto.is_hot }),
      });
      const payload = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !payload.ok) {
        toast({ title: 'Não foi possível', description: payload.error });
        return;
      }
      setMeusProdutos((prev) =>
        prev.map((p) => (p.id === produto.id ? { ...p, is_hot: !produto.is_hot } : p))
      );
      toast({
        title: !produto.is_hot ? 'Produto em alta 🔥' : 'Badge removido',
        description: produto.name,
      });
    } catch {
      toast({ title: 'Erro de ligação', description: 'Tenta novamente.' });
    } finally {
      setHotBusyId(null);
    }
  }

  /** Adere ao programa de afiliados (POST /api/affiliate/register). */
  async function registarAfiliado() {
    setARegistarAfiliado(true);
    try {
      const res = await fetch('/api/affiliate/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      const payload = (await res.json()) as { ok?: boolean; codigo_afiliado?: string; error?: string };
      if (!res.ok || !payload.ok) {
        toast({ title: 'Não foi possível aderir', description: payload.error });
        return;
      }
      toast({
        title: 'Bem-vindo ao programa de afiliados!',
        description: `O teu código: ${payload.codigo_afiliado}`,
      });
      setAffiliateCarregado(false);
      fetch('/api/affiliate', { headers: authHeaders() })
        .then((r) => (r.ok ? r.json() : null))
        .then((payload2: AffiliateData | null) => setAffiliate(payload2))
        .catch(() => undefined)
        .finally(() => setAffiliateCarregado(true));
    } catch {
      toast({ title: 'Erro de ligação', description: 'Tenta novamente.' });
    } finally {
      setARegistarAfiliado(false);
    }
  }

  function copiarCodigo() {
    if (!affiliate) return;
    navigator.clipboard
      ?.writeText(affiliate.codigo_afiliado)
      .then(() =>
        toast({
          title: 'Código copiado',
          description: affiliate.codigo_afiliado,
        })
      )
      .catch(() => undefined);
  }

  /* ── Ponto 4A: disponibilidade do prestador (is_available = fonte de
   *    verdade do checkout — cliente NÃO pode pagar se estiveres offline) ── */
  const [aAtualizarLocal, setAAtualizarLocal] = useState(false);
  const [estadoDisponibilidade, setEstadoDisponibilidade] = useState<{
    is_available: boolean;
    available_until: string | null;
  } | null>(null);

  useEffect(() => {
    if (!user || unauthorized) return;
    fetch('/api/perfil/location', { headers: authHeaders(), cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d: { is_available?: boolean; available_until?: string | null } | null) =>
          setEstadoDisponibilidade({
            is_available: Boolean(d?.is_available),
            available_until: d?.available_until ?? null,
          })
      )
      .catch(() => setEstadoDisponibilidade(null));
  }, [user, unauthorized]);

  function marcarDisponivel() {
    if (!navigator.geolocation) {
      toast({ title: 'Geolocalização indisponível', description: 'O teu navegador não suporta partilha de localização.' });
      return;
    }
    setAAtualizarLocal(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch('/api/perfil/location', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
          });
          const payload = (await res.json()) as { ok?: boolean; error?: string };
          if (!res.ok || !payload.ok) {
            toast({ title: 'Não foi possível', description: payload.error });
            return;
          }
          setEstadoDisponibilidade({ is_available: true, available_until: '+2h' });
          toast({ title: 'Estás DISPONÍVEL ✓', description: 'Clientes já podem contratar e pagar os teus serviços — continua visível até te desligares.' });
        } finally {
          setAAtualizarLocal(false);
        }
      },
      () => {
        setAAtualizarLocal(false);
        toast({ title: 'Permissão recusada', description: 'Autoriza a localização no navegador para ficar disponível.' });
      },
      { enableHighAccuracy: false, timeout: 10_000 }
    );
  }

  async function ficarIndisponivel() {
    setAAtualizarLocal(true);
    try {
      await fetch('/api/perfil/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ clear: true }),
      });
      setEstadoDisponibilidade({ is_available: false, available_until: null });
      toast({ title: 'Estás INDISPONÍVEL ⏸', description: 'O checkout bloqueia novos pagamentos até te marcares disponível outra vez.' });
    } finally {
      setAAtualizarLocal(false);
    }
  }

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-400">
        <Loader2 className="mr-3 h-5 w-5 animate-spin text-emerald-500" />
        <span className="text-sm">A carregar o teu painel…</span>
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
          O painel de vendas é exclusivo para vendedores AngoStart (criadores,
          prestadores ao domicílio e freelancers remotos).
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Button asChild className="h-11 bg-emerald-500 px-6 font-semibold text-white hover:bg-emerald-600">
            <Link href="/perfil">Entrar como vendedor</Link>
          </Button>
          <Button asChild variant="outline" className="h-11 px-6">
            <Link href="/"><ArrowLeft className="mr-2 h-4 w-4" /> Início</Link>
          </Button>
        </div>
      </div>
    );
  }

  const cards = data?.cards;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
            Painel de vendas
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Olá {user?.name?.split(' ')[0]} — aqui está o resumo do teu negócio na AngoStart.
          </p>
        </div>
        <div className="flex gap-2">
          {user?.username && (
            <Button asChild variant="outline" className="h-10 border-slate-300 text-slate-600 hover:bg-slate-50">
              <Link href={`/portfolio/${user.username}`} target="_blank">
                <ExternalLink className="mr-2 h-4 w-4" /> Ver Mini-Loja pública
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" className="h-10 border-emerald-500 text-emerald-600 hover:bg-emerald-50">
            <Link href="/dashboard/vendedor/portfolio">Editar portfólio</Link>
          </Button>
          <Button asChild className="h-10 bg-amber-500 font-semibold text-white hover:bg-amber-600">
            <Link href="/adicionar-produto">Publicar produto</Link>
          </Button>
        </div>
      </div>

      {/* Fase 9 — Loja virtual: editor + página pública */}
      <div className="mt-4">
        <StoreEditorCard />
      </div>

      {/* Mini-Loja — números públicos (Fase 6, ponto 1) */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5 font-semibold text-emerald-900">
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
            {cards && cards.ratingCount > 0
              ? `${cards.ratingAverage.toFixed(1)} ★ (${cards.ratingCount})`
              : 'Avaliação estimada da plataforma · sem avaliações reais'}
          </span>
          <span className="flex items-center gap-1.5 text-emerald-900">
            <Package className="h-4 w-4 text-emerald-600" />
            {cards?.productsPublished ?? 0} produtos publicados
          </span>
          <span className="flex items-center gap-1.5 text-emerald-900">
            <Users className="h-4 w-4 text-emerald-600" />
            {cards?.clients ?? 0} clientes servidos
          </span>
        </div>
        <p className="text-[11px] text-emerald-800/70">
          Estes números são o que os clientes veem na tua Mini-Loja.
        </p>
      </div>

      {/* Alertas (Fase 5) */}
      {data?.alerts.message && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p>{data.alerts.message}</p>
        </div>
      )}

      {/* Cartões de métricas — linha 1 */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            icon: Receipt,
            label: 'Encomendas recebidas',
            value: String(cards?.totalOrders ?? 0),
            hint: `${cards?.itemsSold ?? 0} artigos vendidos`,
            tone: 'bg-emerald-50 text-emerald-600',
          },
          {
            icon: PiggyBank,
            label: 'Receita bruta confirmada',
            value: formatKz(cards?.revenueConfirmed ?? 0),
            hint: 'pagamentos validados',
            tone: 'bg-sky-50 text-sky-600',
          },
          {
            icon: TrendingUp,
            label: 'Receita líquida (após comissão)',
            value: formatKz(cards?.revenueNet ?? 0),
            hint:
              cards && cards.commissionRetained > 0
                ? `comissão AngoStart ${cards.commissionPercent}%: ${formatKz(cards.commissionRetained)}`
                : 'sem comissões retidas',
            tone: 'bg-teal-50 text-teal-600',
          },
          {
            icon: ClipboardList,
            label: 'Receita pendente',
            value: formatKz(cards?.revenuePending ?? 0),
            hint: 'à espera de validação',
            tone: 'bg-amber-50 text-amber-600',
          },
        ].map(({ icon: Icon, label, value, hint, tone }) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
                <Icon className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-bold text-slate-900">{value}</p>
            <p className="text-sm font-medium text-slate-600">{label}</p>
            <p className="text-xs text-slate-400">{hint}</p>
          </div>
        ))}
      </div>

      {/* Cartões de métricas — linha 2 (Fase 5) */}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          {
            icon: Users,
            label: 'Clientes',
            value: String(cards?.clients ?? 0),
            hint: 'clientes distintos servidos',
            tone: 'bg-violet-50 text-violet-600',
          },
          {
            icon: Star,
            label: 'Avaliação média',
            value: cards && cards.ratingCount > 0 ? `${cards.ratingAverage} ★` : '—',
            hint: `${cards?.ratingCount ?? 0} avaliações recebidas`,
            tone: 'bg-amber-50 text-amber-600',
          },
          {
            icon: MessageCircle,
            label: 'Mensagens no chat (7d)',
            value: String(cards?.chatMessages7d ?? 0),
            hint: 'responde rápido para vender mais',
            tone: 'bg-sky-50 text-sky-600',
          },
          {
            icon: Package,
            label: 'Produtos publicados',
            value: String(cards?.productsPublished ?? 0),
            hint: 'no catálogo ativo',
            tone: 'bg-emerald-50 text-emerald-600',
          },
        ].map(({ icon: Icon, label, value, hint, tone }) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tone}`}>
              <Icon className="h-4 w-4" />
            </span>
            <p className="mt-2 text-xl font-bold text-slate-900">{value}</p>
            <p className="text-xs font-medium text-slate-600">{label}</p>
            <p className="text-[11px] text-slate-400">{hint}</p>
          </div>
        ))}
      </div>

      {/* Gráficos */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section aria-label="Receita por mês" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Receita por mês (confirmada)</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.revenueByMonth ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                />
                <Tooltip
                  formatter={(value) => [formatKz(Number(value)), 'Receita']}
                  labelFormatter={(label) => `Mês ${label}`}
                  contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 13 }}
                />
                <Bar dataKey="revenue" fill="#10b981" radius={[8, 8, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section aria-label="Produtos mais vendidos" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Produtos mais vendidos</h2>
          {(data?.topProducts?.length ?? 0) === 0 ? (
            <p className="mt-10 text-center text-sm text-slate-400">
              Ainda sem vendas — publica produtos e partilha o teu catálogo!
            </p>
          ) : (
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data?.topProducts ?? []}
                    dataKey="vendas"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={95}
                    paddingAngle={3}
                  >
                    {(data?.topProducts ?? []).map((entry, index) => (
                      <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [`${value} vendas`, name]}
                    contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 13 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      {/* Fase 4/5 — Carteira / Afiliados / Em alta + Disponibilidade */}
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* Carteira */}
        <section aria-label="Carteira" className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-500 to-teal-600 p-5 text-white shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Wallet className="h-5 w-5" /> Carteira AngoStart
          </h2>
          <p className="mt-3 text-xs text-emerald-100">Saldo disponível</p>
          <p className="text-2xl font-bold">{formatKz(wallet?.saldo ?? 0)}</p>
          <p className="mt-2 text-xs text-emerald-100">Em escrow (até entrega)</p>
          <p className="text-lg font-semibold">{formatKz(wallet?.saldo_bloqueado ?? 0)}</p>
          <Button
            asChild
            className="mt-4 h-10 w-full bg-white font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            <Link href="/carteira">Abrir carteira</Link>
          </Button>
        </section>

        {/* Afiliados */}
        <section aria-label="Programa de afiliados" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Share2 className="h-5 w-5 text-amber-500" /> Programa de afiliados
          </h2>
          {!affiliateCarregado ? (
            <p className="mt-6 text-sm text-slate-400">A carregar…</p>
          ) : affiliate ? (
            <>
              <p className="mt-3 text-xs text-slate-500">
                O teu código ({affiliate.comissao_percentual}% de comissão por venda):
              </p>
              <div className="mt-1 flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <span className="font-mono text-lg font-bold text-amber-700">
                  {affiliate.codigo_afiliado}
                </span>
                <button
                  onClick={copiarCodigo}
                  aria-label="Copiar código de afiliado"
                  className="rounded-lg p-2 text-amber-600 hover:bg-amber-100"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-3 text-sm text-slate-600">
                Total ganho:{' '}
                <strong className="text-emerald-600">{formatKz(affiliate.total_ganho)}</strong>
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {affiliate.earnings.length}{' '}
                {affiliate.earnings.length === 1 ? 'comissão' : 'comissões'} registadas
              </p>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm leading-relaxed text-slate-500">
                Ganha 10% de cada venda feita com o teu código de referência.
                A comissão entra direto na tua carteira quando o pedido é pago.
              </p>
              <Button
                onClick={registarAfiliado}
                disabled={aRegistarAfiliado}
                className="mt-4 h-10 w-full bg-amber-500 font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
              >
                {aRegistarAfiliado ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Tornar-me afiliado'
                )}
              </Button>
            </>
          )}
        </section>

        {/* Em alta — gestão rápida */}
        <section aria-label="Marcar produtos em alta" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Flame className="h-5 w-5 text-orange-500" /> Produtos em alta
          </h2>
          {meusProdutos.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">
              Ainda não publicaste produtos — usa «Publicar produto».
            </p>
          ) : (
            <>
              <p className="mt-2 text-xs text-slate-400">
                Marca até 3 produtos como «em alta» para brilharem no catálogo.
              </p>
              <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                {meusProdutos.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                      {p.name}
                    </span>
                    <button
                      onClick={() => toggleHot(p)}
                      disabled={hotBusyId === p.id}
                      aria-pressed={Boolean(p.is_hot)}
                      aria-label={`Alternar «em alta» em ${p.name}`}
                      className={`flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold transition-colors disabled:opacity-50 ${
                        p.is_hot
                          ? 'bg-orange-500 text-white hover:bg-orange-600'
                          : 'border border-orange-200 bg-white text-orange-600 hover:bg-orange-50'
                      }`}
                    >
                      {hotBusyId === p.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Flame className="h-3.5 w-3.5" />
                      )}
                      {p.is_hot ? 'Em alta' : 'Marcar'}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {/* Fase 5 — Atividade recente: avaliações + disponibilidade (domicílio) */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Últimas avaliações recebidas */}
        <section aria-label="Avaliações recentes" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Star className="h-5 w-5 text-amber-500" /> Avaliações recentes
          </h2>
          {(data?.recentReviews?.length ?? 0) === 0 ? (
            <p className="mt-4 text-sm text-slate-400">
              Ainda sem avaliações — clientes com compra confirmada podem avaliar os teus produtos.
            </p>
          ) : (
            <ul className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-1">
              {data!.recentReviews.map((r, i) => (
                <li key={i} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                  <p className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <span className="text-amber-500">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                    {r.product_name}
                    <span className="ml-auto font-normal text-slate-400">
                      {new Date(r.created_at).toLocaleDateString('pt-PT')}
                    </span>
                  </p>
                  {r.comment && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{r.comment}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Ponto 4A: toggle de disponibilidade — o checkout bloqueia se estiveres offline */}
        {user?.role === 'prestador_domicilio' && (
          <section
            aria-label="Disponibilidade de serviço"
            className={`rounded-2xl border p-5 text-white shadow-sm ${
              estadoDisponibilidade?.is_available
                ? 'border-emerald-300 bg-gradient-to-br from-emerald-500 to-teal-600'
                : 'border-orange-200 bg-gradient-to-br from-orange-500 to-amber-500'
            }`}
          >
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <MapPin className="h-5 w-5" /> Disponibilidade ao domicílio
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-white/90">
              Enquanto estiveres <strong>indisponível</strong>, o checkout bloqueia o pagamento de
              novos serviços — o cliente vê «prestador temporariamente indisponível». Liga-te para
              poderes receber e cobrar serviços.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                  estadoDisponibilidade?.is_available
                    ? 'bg-white/25 text-white'
                    : 'bg-black/20 text-white/90'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    estadoDisponibilidade?.is_available ? 'bg-emerald-200 animate-pulse' : 'bg-white/60'
                  }`}
                />
                {estadoDisponibilidade?.is_available
                  ? 'DISPONÍVEL — podes receber pedidos'
                  : 'INDISPONÍVEL — checkout bloqueado'}
              </span>
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                onClick={marcarDisponivel}
                disabled={aAtualizarLocal || estadoDisponibilidade?.is_available}
                className="h-10 flex-1 bg-white font-semibold text-orange-600 hover:bg-orange-50 disabled:opacity-70"
              >
                {aAtualizarLocal ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Crosshair className="mr-2 h-4 w-4" />
                )}
                Estou disponível
              </Button>
              <Button
                onClick={ficarIndisponivel}
                disabled={aAtualizarLocal || (estadoDisponibilidade != null && !estadoDisponibilidade.is_available)}
                variant="outline"
                className="h-10 border-white/40 text-white hover:bg-white/10 disabled:opacity-70"
              >
                Estou indisponível
              </Button>
            </div>
          </section>
        )}
      </div>

      {/* Encomendas recebidas */}
      <section aria-label="Encomendas recebidas" className="mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Encomendas recebidas</h2>
          <Package className="h-5 w-5 text-slate-300" />
        </div>
        {(data?.orders?.length ?? 0) === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            Sem encomendas por agora. Partilha os teus produtos para receberes pedidos!
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data!.orders.map((order) => {
              const status = STATUS_STYLE[order.status] ?? {
                label: order.status,
                className: 'bg-slate-100 text-slate-600',
              };
              return (
                <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      #{order.id} — {order.customer_name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {order.items.map((i) => `${i.quantity}× ${i.name}`).join(' · ')}
                    </p>
                    <p className="text-xs text-slate-400">
                      {new Date(order.created_at).toLocaleString('pt-PT')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.className}`}>
                      {status.label}
                    </span>
                    <span className="text-sm font-bold text-emerald-600">
                      {formatKz(order.items.reduce((acc, i) => acc + i.price_kz * i.quantity, 0))}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Ponto 4B: serviços ao domicílio pagos — iniciar deslocação + GPS em tempo real */}
      <ServicosAtivosCard />

      {/* Gamificação — selos, nível e progresso (Fase 7) */}
      <GamificationCard />

      {/* Comissão efetiva aplicada às vendas (Fase 7) */}
      <CommissionRateCard />

      {/* Propostas v2 — negociação (Fase 7) */}
      <PropostasRecebidas />
    </div>
  );
}

/* ════════════════════════ Fase 7 — Gamificação ════════════════════════ */

const LEVEL_STYLE: Record<string, { label: string; emoji: string; bar: string }> = {
  bronze: { label: 'Bronze', emoji: '🥉', bar: 'bg-amber-600' },
  prata: { label: 'Prata', emoji: '🥈', bar: 'bg-slate-400' },
  ouro: { label: 'Ouro', emoji: '🥇', bar: 'bg-yellow-500' },
  platina: { label: 'Platina', emoji: '💎', bar: 'bg-emerald-500' },
};

/** Selos, nível e progresso para o próximo nível (Fase 7, ponto 3). */
function GamificationCard() {
  const [data, setData] = useState<GamificationData | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/dashboard/gamification', { headers: authHeaders() });
        if (!res.ok) throw new Error();
        setData((await res.json()) as GamificationData);
      } catch {
        setData(null);
      }
    })();
  }, []);

  if (!data) return null;
  const level = LEVEL_STYLE[data.level] ?? LEVEL_STYLE.bronze;

  return (
    <section aria-label="Nível e selos" className="mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">Nível e selos</h2>
        <Medal className="h-5 w-5 text-slate-300" />
      </div>
      <div className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1 text-sm font-bold text-white`}>
            {level.emoji} {level.label}
          </span>
          <span className="text-sm text-slate-600">
            <strong className="text-slate-900">{data.points}</strong> pontos ·{' '}
            {data.sales_count} vendas concluídas
          </span>
        </div>

        {/* Progresso para o próximo nível */}
        {data.next_level ? (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Progresso para {data.next_level.label}</span>
              <span>
                faltam <strong>{data.next_level.missing}</strong> pontos
              </span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${level.bar} transition-all`}
                style={{ width: `${Math.round(data.progress * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Como ganhar pontos: +1 por venda concluída · +5 por avaliação 5★ · +10 por resposta
              ao chat em menos de 1 h.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-xs font-semibold text-emerald-600">
            Nível máximo atingido — parabéns! 💎
          </p>
        )}

        {/* Selos conquistados + bloqueados */}
        <div className="mt-4 flex flex-wrap gap-2">
          {data.badges.map((b) => (
            <span
              key={b.code}
              title={b.description}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"
            >
              <Award className="h-3.5 w-3.5" /> {b.name}
            </span>
          ))}
          {data.locked_badges.slice(0, 6).map((b) => (
            <span
              key={b.code}
              title={b.description}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-400"
            >
              <Lock className="h-3 w-3" /> {b.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Taxa de comissão efetiva do vendedor (Fase 7 — transparência). */
function CommissionRateCard() {
  const [percent, setPercent] = useState<number | null>(null);
  const [source, setSource] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/dashboard/commission', { headers: authHeaders() });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { percent: number; source: string };
        setPercent(data.percent);
        setSource(data.source);
      } catch {
        setPercent(null);
      }
    })();
  }, []);

  if (percent === null) return null;

  return (
    <section
      aria-label="Taxa de comissão"
      className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm"
    >
      <div className="flex items-center gap-3">
        <Receipt className="h-5 w-5 text-emerald-500" />
        <div>
          <p className="text-sm font-semibold text-slate-900">
            Comissão AngoStart: {percent}%
          </p>
          <p className="text-xs text-slate-400">
            {source === 'override'
              ? 'Taxa personalizada definida pela equipa AngoStart.'
              : source === 'tabela'
                ? 'Taxa standard para a tua categoria.'
                : 'Taxa por defeito da plataforma.'}
          </p>
        </div>
      </div>
      <p className="text-xs text-slate-400">Descontada no escrow quando o pedido é pago.</p>
    </section>
  );
}

/* ══════════════════ Fase 7 — Propostas v2 (negociação) ══════════════════ */

/** Propostas recebidas: aceitar, recusar ou contrapropor (Fase 7). */
function PropostasRecebidas() {
  const { toast } = useToast();
  const [proposals, setProposals] = useState<ProviderProposal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<'todas' | 'pendente' | 'aceite' | 'recusada'>('todas');
  const [counterFor, setCounterFor] = useState<ProviderProposal | null>(null);
  const [counterPrice, setCounterPrice] = useState('');
  const [counterDeadline, setCounterDeadline] = useState('');
  const [counterMessage, setCounterMessage] = useState('');
  const [history, setHistory] = useState<{ proposalId: number; entries: CounterEntry[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/proposals?scope=recebidas', { headers: authHeaders() });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { proposals?: ProviderProposal[] };
      setProposals(data.proposals ?? []);
    } catch {
      setProposals([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered =
    statusFilter === 'todas' ? proposals : proposals.filter((p) => p.status === statusFilter);

  async function answer(id: number, action: 'aceite' | 'recusada') {
    if (busyId !== null) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/proposals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; order_id?: number };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível responder', description: data.error });
        return;
      }
      toast({
        title: action === 'aceite' ? 'Proposta aceite ✓' : 'Proposta recusada',
        description:
          action === 'aceite'
            ? `Pedido #${data.order_id} criado — o cliente foi notificado para pagar via KWiK.`
            : 'O cliente foi notificado.',
      });
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function sendCounter() {
    if (!counterFor || busyId !== null) return;
    setBusyId(counterFor.id);
    try {
      const res = await fetch(`/api/proposals/${counterFor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          action: 'contrapropor',
          price_kz: Number(counterPrice.replace(/[^\d]/g, '')),
          deadline_days:
            counterDeadline.length > 0 ? Number(counterDeadline.replace(/[^\d]/g, '')) : undefined,
          message: counterMessage || undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível contrapropor', description: data.error });
        return;
      }
      toast({ title: 'Contraproposta enviada ✓', description: 'O cliente foi notificado (email + push).' });
      setCounterFor(null);
      setCounterPrice('');
      setCounterDeadline('');
      setCounterMessage('');
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function openHistory(proposalId: number) {
    if (history?.proposalId === proposalId) {
      setHistory(null);
      return;
    }
    try {
      const res = await fetch(`/api/proposals/${proposalId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { history?: CounterEntry[] };
      setHistory({ proposalId, entries: data.history ?? [] });
    } catch {
      toast({ title: 'Não foi possível carregar o histórico.' });
    }
  }

  if (!loaded) return null;

  return (
    <section aria-label="Propostas recebidas" className="mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">Propostas recebidas</h2>
        <div className="flex gap-1">
          {(['todas', 'pendente', 'aceite', 'recusada'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                statusFilter === s
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-400">
          Sem propostas {statusFilter === 'todas' ? 'por agora' : `«${statusFilter}»`} — os clientes
          podem negociar preço e prazo a partir das páginas dos teus produtos e serviços.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {filtered.map((p) => (
            <li key={p.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">
                  {p.client_name ?? 'Cliente'} — sobre «{p.service_name}»
                </p>
                <div className="flex items-center gap-2">
                  {p.rounds > 1 && (
                    <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700">
                      {p.rounds} rodadas
                    </span>
                  )}
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      p.status === 'pendente'
                        ? 'bg-amber-100 text-amber-700'
                        : p.status === 'aceite'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {p.status}
                  </span>
                </div>
              </div>
              <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{p.description}</p>
              <p className="mt-1 text-xs text-slate-400">
                Oferta atual: <strong className="text-emerald-700">{formatKz(p.price_kz)}</strong>
                {p.deadline_days ? ` · prazo ${p.deadline_days} dias` : ''} ·{' '}
                {p.my_offer_standing && p.status === 'pendente'
                  ? 'a tua oferta está na mesa — aguarda o cliente'
                  : new Date(p.updated_at).toLocaleString('pt-PT')}
                {p.order_id ? ` · pedido #${p.order_id}` : ''}
              </p>

              {/* Histórico da negociação */}
              {history?.proposalId === p.id && (
                <ol className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  {history.entries.map((h) => (
                    <li key={h.id} className="text-xs text-slate-600">
                      <span className={h.by_me ? 'font-semibold text-emerald-700' : 'font-semibold'}>
                        {h.author_name ?? 'Parte'} ofereceu {formatKz(h.price_kz)}
                        {h.deadline_days ? ` · ${h.deadline_days} dias` : ''}
                      </span>
                      {h.message ? <span> — “{h.message.slice(0, 160)}”</span> : null}
                      <span className="text-slate-400"> · {new Date(h.created_at).toLocaleString('pt-PT')}</span>
                    </li>
                  ))}
                </ol>
              )}

              {/* Formulário de contraproposta */}
              {counterFor?.id === p.id && (
                <div className="mt-3 space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      value={counterPrice}
                      onChange={(e) => setCounterPrice(e.target.value.replace(/[^\d]/g, ''))}
                      inputMode="numeric"
                      placeholder={`O teu preço em Kz (atual: ${p.price_kz})`}
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-400"
                    />
                    <input
                      value={counterDeadline}
                      onChange={(e) => setCounterDeadline(e.target.value.replace(/[^\d]/g, ''))}
                      inputMode="numeric"
                      placeholder="Prazo em dias (opcional)"
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-400"
                    />
                  </div>
                  <textarea
                    value={counterMessage}
                    onChange={(e) => setCounterMessage(e.target.value)}
                    rows={2}
                    maxLength={2000}
                    placeholder="Mensagem com a contraproposta (opcional)…"
                    className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm outline-none focus:border-emerald-400"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={sendCounter}
                      disabled={busyId === p.id || counterPrice.length === 0}
                      className="inline-flex h-8 items-center rounded-lg bg-emerald-500 px-3 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                    >
                      {busyId === p.id ? 'A enviar…' : 'Enviar contraproposta'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCounterFor(null)}
                      className="inline-flex h-8 items-center rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {p.status === 'pendente' && counterFor?.id !== p.id && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {p.my_offer_standing ? (
                    <span className="inline-flex h-8 items-center rounded-lg bg-slate-100 px-3 text-xs font-medium text-slate-500">
                      Aguarda a resposta do cliente
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => answer(p.id, 'aceite')}
                        disabled={busyId === p.id}
                        className="inline-flex h-8 items-center rounded-lg bg-emerald-500 px-3 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                      >
                        Aceitar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCounterFor(p);
                          setCounterPrice(String(p.price_kz));
                        }}
                        disabled={busyId === p.id}
                        className="inline-flex h-8 items-center rounded-lg bg-violet-500 px-3 text-xs font-semibold text-white hover:bg-violet-600 disabled:opacity-50"
                      >
                        Contrapropor
                      </button>
                      <button
                        type="button"
                        onClick={() => answer(p.id, 'recusada')}
                        disabled={busyId === p.id}
                        className="inline-flex h-8 items-center rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Recusar
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => openHistory(p.id)}
                    className="inline-flex h-8 items-center rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                  >
                    {history?.proposalId === p.id ? 'Esconder histórico' : 'Histórico'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ═══════ Ponto 4B — Serviços ao domicílio pagos: deslocação + GPS em tempo real ═══════ */

interface ServicoOrder {
  id: number;
  customer_name: string;
  status: string;
  items: { name: string; price_kz: number; quantity: number; type: string | null }[];
  delivery_address: string | null;
  notes: string | null;
  tracking_active: boolean;
  service_started_at: string | null;
  service_completed: boolean;
  client_approx_lat: number | null;
  client_approx_lng: number | null;
  client_has_gps: boolean;
}

/**
 * Lista os serviços ao domicílio com status `pago` (dinheiro já em escrow)
 * e conduz o fluxo de deslocação:
 *  1. «Iniciar deslocação» → POST /api/orders/[id]/start-service;
 *  2. GPS do telemóvel via watchPosition + envio ao servidor a cada 5 s
 *     (POST /api/orders/[id]/location);
 *  3. Mapa com a posição APROXIMADA do cliente (raio de 500 m — a exata
 *     nunca sai do servidor) + a tua última posição conhecida.
 * O rastreamento para quando o cliente confirma a conclusão.
 */
function ServicosAtivosCard() {
  const { toast } = useToast();
  const [servicos, setServicos] = useState<ServicoOrder[] | null>(null);
  const [aIniciar, setAIniciar] = useState<number | null>(null);
  const [gpsAtivo, setGpsAtivo] = useState<Record<number, boolean>>({});
  const [ultimaPos, setUltimaPos] = useState<{ lat: number; lng: number } | null>(null);

  const carregar = useCallback(() => {
    fetch('/api/dashboard/vendedor', { headers: authHeaders(), cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DashboardData | null) => {
        if (!d?.orders) {
          setServicos([]);
          return;
        }
        setServicos(
          d.orders.filter(
            (o) =>
              o.items.some((i) => i.type === 'servico_domicilio') &&
              ['pago', 'entregue'].includes(o.status) &&
              !o.service_completed
          )
        );
      })
      .catch(() => setServicos([]));
  }, []);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 15_000);
    return () => clearInterval(t);
  }, [carregar]);

  async function iniciarDeslocacao(orderId: number) {
    if (aIniciar !== null) return;
    setAIniciar(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}/start-service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível iniciar', description: data.error });
        return;
      }
      toast({
        title: 'Deslocação iniciada 🛵',
        description: 'O teu GPS é partilhado com o cliente a cada 5 segundos.',
      });
      carregar();
    } catch {
      toast({ title: 'Erro de ligação', description: 'Tenta novamente.' });
    } finally {
      setAIniciar(null);
    }
  }

  /** Liga o GPS contínuo para um pedido: watchPosition + envio a cada 5 s. */
  function ligarGps(orderId: number) {
    if (!('geolocation' in navigator)) {
      toast({ title: 'GPS indisponível neste dispositivo.' });
      return;
    }
    let latest: { lat: number; lng: number } | null = null;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        latest = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUltimaPos(latest);
      },
      () => {
        toast({
          title: 'Sem acesso ao GPS',
          description: 'Autoriza a localização para o cliente te acompanhar.',
        });
      },
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 15_000 }
    );

    // Envio periódico a cada 5 s (o servidor valida tracking ativo)
    const sender = setInterval(() => {
      if (!latest) return;
      fetch(`/api/orders/${orderId}/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ latitude: latest.lat, longitude: latest.lng }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { tracking_active?: boolean } | null) => {
          if (d && d.tracking_active === false) {
            pararGps();
            carregar();
          }
        })
        .catch(() => {});
    }, 5_000);

    function pararGps() {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(sender);
      setGpsAtivo((prev) => ({ ...prev, [orderId]: false }));
    }
    // exposto via closure para o useEffect de limpeza e para o próprio fluxo
    (ligarGps as unknown as { _parar?: () => void })._parar = pararGps;
    setGpsAtivo((prev) => ({ ...prev, [orderId]: true }));
  }

  if (servicos === null) {
    return (
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">
        A carregar serviços…
      </section>
    );
  }

  if (servicos.length === 0) return null;

  return (
    <section
      aria-label="Serviços ao domicílio ativos"
      className="mt-8 rounded-2xl border border-sky-200 bg-white shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Bike className="h-5 w-5 text-sky-600" /> Serviços ao domicílio — em curso
        </h2>
        <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-700">
          {servicos.length}
        </span>
      </div>
      <ul className="divide-y divide-slate-100">
        {servicos.map((s) => {
          const emCurso = Boolean(s.service_started_at) || s.tracking_active;
          return (
            <li key={s.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    #{s.id} — {s.customer_name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {s.items.map((i) => `${i.quantity}× ${i.name}`).join(' · ')}
                  </p>
                  {s.delivery_address && (
                    <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-600">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      <span>
                        <strong>Morada:</strong> {s.delivery_address}
                        {s.notes ? ` · Nota: ${s.notes}` : ''}
                      </span>
                    </p>
                  )}
                  {!s.client_has_gps && (
                    <p className="mt-1 text-[11px] text-amber-600">
                      O cliente não partilhou GPS — segue a morada acima ou fala no chat.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  {!emCurso ? (
                    <Button
                      onClick={() => iniciarDeslocacao(s.id)}
                      disabled={aIniciar === s.id}
                      className="h-10 bg-sky-600 font-semibold text-white hover:bg-sky-700"
                    >
                      {aIniciar === s.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Navigation className="mr-2 h-4 w-4" />
                      )}
                      Iniciar deslocação
                    </Button>
                  ) : (
                    <>
                      <span className="flex items-center gap-1.5 rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-sky-700">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" />
                        Rastreamento ativo
                      </span>
                      {!gpsAtivo[s.id] && (
                        <Button
                          onClick={() => ligarGps(s.id)}
                          variant="outline"
                          className="h-9 border-sky-500 text-xs font-semibold text-sky-600 hover:bg-sky-50"
                        >
                          <Crosshair className="mr-2 h-4 w-4" /> Ligar GPS
                        </Button>
                      )}
                      {ultimaPos && gpsAtivo[s.id] && (
                        <p className="text-[11px] text-slate-400">
                          A enviar posição… ({ultimaPos.lat.toFixed(4)},{' '}
                          {ultimaPos.lng.toFixed(4)})
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Mapa: posição APROXIMADA do cliente (raio 500 m) */}
              {s.client_has_gps && s.client_approx_lat != null && s.client_approx_lng != null && (
                <div className="mt-3">
                  <ServiceMap
                    providerLat={s.client_approx_lat}
                    providerLng={s.client_approx_lng}
                    cidade="Local do cliente (raio ~500 m)"
                    height={260}
                  />
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    🔒 Por privacidade, vês apenas a área aproximada do cliente (raio de 500 m) —
                    a posição exata nunca sai do servidor. Usa a morada e o chat para os últimos
                    metros.
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
