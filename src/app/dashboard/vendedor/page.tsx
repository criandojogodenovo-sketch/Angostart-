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
  ClipboardList,
  Copy,
  Flame,
  Loader2,
  Lock,
  MapPin,
  MessageCircle,
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
    status: string;
    created_at: string;
    items: { name: string; price_kz: number; quantity: number }[];
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

  /* ── Fase 5: disponibilidade do prestador ao domicílio ── */
  const [aAtualizarLocal, setAAtualizarLocal] = useState(false);

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
          toast({ title: 'Estás disponível por 2 horas! 📍', description: 'Clientes próximos já te podem encontrar.' });
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
      toast({ title: 'Pausado — já não apareces como disponível.' });
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
          <Button asChild variant="outline" className="h-10 border-emerald-500 text-emerald-600 hover:bg-emerald-50">
            <Link href="/dashboard/vendedor/portfolio">Editar portfólio</Link>
          </Button>
          <Button asChild className="h-10 bg-amber-500 font-semibold text-white hover:bg-amber-600">
            <Link href="/adicionar-produto">Publicar produto</Link>
          </Button>
        </div>
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

        {/* Estou disponível — prestadores ao domicílio (Fase 5, mapa) */}
        {user?.role === 'prestador_domicilio' && (
          <section
            aria-label="Disponibilidade de serviço"
            className="rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-500 to-amber-500 p-5 text-white shadow-sm"
          >
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <MapPin className="h-5 w-5" /> Disponibilidade ao domicílio
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-orange-50">
              Partilha a tua localização aproximada (expira em 2 h) para apareceres como
              disponível. Clientes veem apenas a área — a localização exata só é revelada
              após pagamento.
            </p>
            <div className="mt-4 flex gap-2">
              <Button
                onClick={marcarDisponivel}
                disabled={aAtualizarLocal}
                className="h-10 flex-1 bg-white font-semibold text-orange-600 hover:bg-orange-50"
              >
                {aAtualizarLocal ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <MapPin className="mr-2 h-4 w-4" />
                )}
                Estou disponível
              </Button>
              <Button
                onClick={ficarIndisponivel}
                disabled={aAtualizarLocal}
                variant="outline"
                className="h-10 border-white/40 text-white hover:bg-white/10"
              >
                Pausar
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
    </div>
  );
}
