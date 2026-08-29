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

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Boxes,
  ClipboardList,
  Loader2,
  Lock,
  Package,
  PiggyBank,
  Receipt,
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
    revenuePending: number;
    productsPublished: number;
  };
  revenueByMonth: { month: string; revenue: number }[];
  topProducts: { name: string; vendas: number; receita: number }[];
  orders: {
    id: number;
    customer_name: string;
    status: string;
    created_at: string;
    items: { name: string; price_kz: number; quantity: number }[];
  }[];
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
  }, [authLoading, user, isSeller, toast]);

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

      {/* Cartões de métricas */}
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
            label: 'Receita confirmada',
            value: formatKz(cards?.revenueConfirmed ?? 0),
            hint: 'pagamentos validados',
            tone: 'bg-sky-50 text-sky-600',
          },
          {
            icon: ClipboardList,
            label: 'Receita pendente',
            value: formatKz(cards?.revenuePending ?? 0),
            hint: 'à espera de validação',
            tone: 'bg-amber-50 text-amber-600',
          },
          {
            icon: Boxes,
            label: 'Produtos publicados',
            value: String(cards?.productsPublished ?? 0),
            hint: 'no catálogo ativo',
            tone: 'bg-violet-50 text-violet-600',
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
