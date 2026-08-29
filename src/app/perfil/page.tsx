'use client';

/**
 * AngoStart — Perfil multi-perfil (marketplace)
 *
 * - Sem sessão: escolha entre "Sou Cliente" e "Quero Vender" com
 *   formulários de login/registo dedicados (o vendedor escolhe o tipo:
 *   criador, prestador ao domicílio ou freelancer remoto).
 * - Cliente: dados pessoais + histórico de compras.
 * - Vendedor: dados do perfil + botão "Adicionar Produto" + lista dos
 *   seus produtos com editar/eliminar.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  BarChart3,
  Briefcase,
  CircleDollarSign,
  Download,
  ExternalLink,
  GraduationCap,
  History,
  Home as HomeIcon,
  LogIn,
  LogOut,
  Mail,
  Package,
  Pencil,
  Phone,
  Plus,
  ShoppingCart,
  Sparkles,
  Trash2,
  User as UserIcon,
  UserRound,
  UserRoundPlus,
  Globe,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth, type AuthUser } from '@/context/AuthContext';
import { authHeaders } from '@/context/AuthContext';
import { formatKz, formatDateTime } from '@/lib/format';
import {
  ORDER_STATUS_BADGES,
  ORDER_STATUS_LABELS,
} from '@/lib/kwik';
import type { Product, ProductType } from '@/lib/products-data';

type AccountKind = 'cliente' | 'vendedor';
type FormMode = 'login' | 'registo';
type SellerRoleChoice = 'criador' | 'prestador_domicilio' | 'prestador_remoto';

const SELLER_ROLES: {
  value: SellerRoleChoice;
  label: string;
  hint: string;
  icon: typeof GraduationCap;
}[] = [
  {
    value: 'criador',
    label: 'Criador de Infoprodutos',
    hint: 'Vende cursos, eBooks e templates digitais',
    icon: GraduationCap,
  },
  {
    value: 'prestador_domicilio',
    label: 'Prestador ao Domicílio',
    hint: 'Limpeza, electricista, canalização, AC…',
    icon: HomeIcon,
  },
  {
    value: 'prestador_remoto',
    label: 'Freelancer Remoto',
    hint: 'Design, websites, redes sociais…',
    icon: Globe,
  },
];

const ROLE_BADGE: Record<string, string> = {
  cliente: 'Cliente',
  criador: 'Criador de Infoprodutos',
  prestador_domicilio: 'Prestador ao Domicílio',
  prestador_remoto: 'Freelancer Remoto',
};

interface OrderRecord {
  id: number;
  items: {
    id: number;
    name: string;
    price_kz: number;
    quantity: number;
    type?: string | null;
    file_url?: string | null;
  }[];
  total_kz: number;
  status: string;
  delivery_type?: string;
  created_at: string;
}

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export default function PerfilPage() {
  const { user, loading, isSeller, logout } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-400">
        <UserIcon className="mr-3 h-5 w-5 animate-pulse" />
        <span className="text-sm">A verificar a tua sessão…</span>
      </div>
    );
  }

  if (user) {
    return isSeller ? (
      <SellerProfile user={user} onLogout={logout} />
    ) : (
      <ClientProfile user={user} onLogout={logout} />
    );
  }

  return <AuthGate />;
}

/* ═══════════════════ Porta de entrada (sem sessão) ═══════════════════ */

function AuthGate() {
  const [kind, setKind] = useState<AccountKind | null>(null);

  if (!kind) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-500/30">
            <UserRound className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-2xl font-bold text-slate-900 sm:text-3xl">
            Bem-vindo(a) à AngoStart
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Entra na tua conta ou cria um perfil novo. Escolhe a opção que
            descreve melhor o que queres fazer na plataforma.
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <button
            onClick={() => setKind('cliente')}
            className="group flex flex-col items-center rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-emerald-300 hover:shadow-xl"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md">
              <ShoppingCart className="h-7 w-7" />
            </span>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">Sou Cliente</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              Navega, pesquisa e compra infoprodutos, produtos físicos e
              serviços com preços em Kwanzas.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-emerald-600">
              Entrar / criar conta
              <LogIn className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </span>
          </button>

          <button
            onClick={() => setKind('vendedor')}
            className="group flex flex-col items-center rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-emerald-300 hover:shadow-xl"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-md">
              <Briefcase className="h-7 w-7" />
            </span>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">Quero Vender</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              Publica cursos, produtos ou serviços e recebe pedidos de clientes
              de todo o país.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-emerald-600">
              Entrar / criar conta
              <LogIn className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </span>
          </button>
        </div>

        <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
          <p className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            A tua conta serve para comprar <strong>e</strong> vender. Podes ter
            os dois tipos de acesso com emails diferentes — os dados ficam
            seguros com palavra-passe.
          </p>
        </div>
      </div>
    );
  }

  return <AuthForms kind={kind} onBack={() => setKind(null)} />;
}

/* ═══════════════════ Formulários login / registo ═══════════════════ */

function AuthForms({ kind, onBack }: { kind: AccountKind; onBack: () => void }) {
  const { login, registerCliente, registerVendedor } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [mode, setMode] = useState<FormMode>('login');
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    telefone: '',
    role: 'criador' as SellerRoleChoice,
    bio: '',
    area_atuacao: '',
    cidade: '',
    especialidade: '',
    portfolio_url: '',
  });

  const isClient = kind === 'cliente';
  const selectedRole = SELLER_ROLES.find((r) => r.value === form.role);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    try {
      if (mode === 'login') {
        const user = await login(form.email, form.password);
        toast({
          title: `Olá, ${user.name.split(' ')[0]}!`,
          description: 'Sessão iniciada com sucesso.',
        });
      } else if (isClient) {
        const user = await registerCliente({
          name: form.name,
          email: form.email,
          password: form.password,
          telefone: form.telefone,
        });
        toast({
          title: 'Conta criada!',
          description: `Bem-vindo(a) à AngoStart, ${user.name.split(' ')[0]}.`,
        });
      } else {
        const user = await registerVendedor({
          name: form.name,
          email: form.email,
          password: form.password,
          telefone: form.telefone,
          role: form.role,
          bio: form.bio,
          area_atuacao: form.area_atuacao,
          cidade: form.cidade,
          especialidade: form.especialidade,
          portfolio_url: form.portfolio_url,
        });
        toast({
          title: 'Conta de vendedor criada!',
          description: 'Já podes publicar o teu primeiro produto ou serviço.',
        });
      }
      router.push('/perfil');
    } catch (error) {
      toast({
        title: 'Não foi possível continuar',
        description:
          error instanceof Error ? error.message : 'Tenta novamente em instantes.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10 sm:px-6">
      <button
        onClick={onBack}
        className="mb-4 text-sm font-medium text-slate-500 transition-colors hover:text-emerald-600"
      >
        ← Voltar às opções
      </button>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="text-center">
          <span
            className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg ${
              isClient
                ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-emerald-500/30'
                : 'bg-gradient-to-br from-orange-400 to-amber-600 shadow-amber-500/30'
            }`}
          >
            {isClient ? (
              <ShoppingCart className="h-6 w-6" />
            ) : (
              <Briefcase className="h-6 w-6" />
            )}
          </span>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">
            {isClient ? 'Sou Cliente' : 'Quero Vender'}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {mode === 'login'
              ? 'Entra com o teu email e palavra-passe.'
              : isClient
                ? 'Cria a tua conta de cliente em menos de um minuto.'
                : 'Cria a tua conta de vendedor e começa a publicar.'}
          </p>
        </div>

        {/* Alternância Login / Registo */}
        <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" role="tablist">
          {(['login', 'registo'] as FormMode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`h-9 rounded-lg text-sm font-semibold transition-all ${
                mode === m
                  ? 'bg-white text-slate-900 shadow'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {m === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          {mode === 'registo' && (
            <div className="space-y-2">
              <Label htmlFor="auth-nome">Nome completo</Label>
              <Input
                id="auth-nome"
                type="text"
                autoComplete="name"
                placeholder="Ex.: Ana Kiala"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-11"
                required
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="auth-email">Email</Label>
            <Input
              id="auth-email"
              type="email"
              autoComplete="email"
              placeholder="ana@exemplo.ao"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="h-11"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="auth-password">Palavra-passe</Label>
            <Input
              id="auth-password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="Mínimo 6 caracteres"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="h-11"
              required
            />
            {mode === 'login' && (
              <Link
                href="/recuperar-senha"
                className="inline-block text-xs font-medium text-emerald-600 transition-colors hover:text-emerald-700"
              >
                Esqueci a senha — recuperar por email
              </Link>
            )}
          </div>

          {mode === 'registo' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="auth-telefone">Telefone / WhatsApp</Label>
                <Input
                  id="auth-telefone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="958 176 915"
                  value={form.telefone}
                  onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                  className="h-11"
                  required
                />
              </div>

              {/* Selector de tipo de vendedor */}
              {!isClient && (
                <div className="space-y-2">
                  <Label htmlFor="auth-role">Quero vender como…</Label>
                  <div className="grid gap-2" role="radiogroup" aria-label="Tipo de vendedor">
                    {SELLER_ROLES.map(({ value, label, hint, icon: Icon }) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={form.role === value}
                        onClick={() => setForm({ ...form, role: value })}
                        className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                          form.role === value
                            ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
                            : 'border-slate-200 bg-white hover:border-emerald-300'
                        }`}
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            form.role === value
                              ? 'bg-emerald-500 text-white'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span>
                          <span className="block text-sm font-semibold text-slate-900">
                            {label}
                          </span>
                          <span className="block text-xs text-slate-500">{hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Campos condicionais por perfil de vendedor */}
              {!isClient && form.role === 'criador' && (
                <div className="space-y-2">
                  <Label htmlFor="auth-bio">Biografia / o que vendes</Label>
                  <textarea
                    id="auth-bio"
                    rows={3}
                    placeholder="Ex.: Sou formador em marketing digital e vendo cursos práticos para pequenas empresas."
                    value={form.bio}
                    onChange={(e) => setForm({ ...form, bio: e.target.value })}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                    required
                  />
                </div>
              )}

              {!isClient && form.role === 'prestador_domicilio' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="auth-area">Área de atuação</Label>
                    <Input
                      id="auth-area"
                      type="text"
                      placeholder="Ex.: Limpeza, Electricista…"
                      value={form.area_atuacao}
                      onChange={(e) => setForm({ ...form, area_atuacao: e.target.value })}
                      className="h-11"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="auth-cidade">Cidade</Label>
                    <Input
                      id="auth-cidade"
                      type="text"
                      placeholder="Ex.: Luanda"
                      value={form.cidade}
                      onChange={(e) => setForm({ ...form, cidade: e.target.value })}
                      className="h-11"
                      required
                    />
                  </div>
                </div>
              )}

              {!isClient && form.role === 'prestador_remoto' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="auth-especialidade">Especialidade</Label>
                    <Input
                      id="auth-especialidade"
                      type="text"
                      placeholder="Ex.: Design gráfico, Programação web…"
                      value={form.especialidade}
                      onChange={(e) => setForm({ ...form, especialidade: e.target.value })}
                      className="h-11"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="auth-portfolio">Portfólio (link, opcional)</Label>
                    <Input
                      id="auth-portfolio"
                      type="url"
                      placeholder="https://teu-portfolio.ao"
                      value={form.portfolio_url}
                      onChange={(e) => setForm({ ...form, portfolio_url: e.target.value })}
                      className="h-11"
                    />
                  </div>
                </>
              )}
            </>
          )}

          <Button
            type="submit"
            disabled={submitting}
            className={`h-12 w-full text-base font-semibold text-white ${
              isClient
                ? 'bg-emerald-500 hover:bg-emerald-600'
                : 'bg-amber-500 hover:bg-amber-600'
            }`}
          >
            {submitting ? (
              'A processar…'
            ) : mode === 'login' ? (
              <>
                <LogIn className="mr-2 h-5 w-5" /> Entrar
              </>
            ) : (
              <>
                <UserRoundPlus className="mr-2 h-5 w-5" /> Criar conta
              </>
            )}
          </Button>

          <p className="text-center text-xs text-slate-400">
            {mode === 'login'
              ? 'Ainda não tens conta? Muda para «Criar conta».'
              : 'Já tens conta? Muda para «Entrar».'}
          </p>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════ Cabeçalho comum do perfil ═══════════════════ */

function ProfileHeader({ user, badge }: { user: AuthUser; badge: string }) {
  return (
    <div className="bg-brand-dark px-6 py-8 text-center text-white sm:px-10">
      <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-2xl font-bold text-white shadow-lg shadow-emerald-500/30">
        {initialsOf(user.name)}
      </span>
      <h1 className="mt-4 text-xl font-bold sm:text-2xl">{user.name}</h1>
      <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-emerald-400">
        <BadgeCheck className="h-3.5 w-3.5" /> {badge}
      </p>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
      <Icon className="h-4 w-4 shrink-0 text-emerald-600" />
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-sm font-medium text-slate-800">{value || '—'}</p>
      </div>
    </div>
  );
}

/* ═══════════════════ Perfil do CLIENTE ═══════════════════ */

function ClientProfile({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const { toast } = useToast();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/orders?mine=1', { headers: authHeaders() });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { orders: OrderRecord[] };
        if (!cancelled) setOrders(data.orders ?? []);
      } catch {
        if (!cancelled) setOrders([]);
      } finally {
        if (!cancelled) setOrdersLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleLogout() {
    onLogout();
    toast({ title: 'Sessão terminada', description: 'Volta sempre à AngoStart!' });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <ProfileHeader user={user} badge={ROLE_BADGE[user.role] ?? 'Cliente'} />

        <div className="space-y-4 px-6 py-8 sm:px-10">
          <InfoRow icon={Mail} label="Email" value={user.email} />
          <InfoRow icon={Phone} label="Telefone" value={user.telefone} />

          <div className="grid gap-3 pt-2 sm:grid-cols-2">
            <Button
              asChild
              className="h-11 bg-emerald-500 text-white hover:bg-emerald-600"
            >
              <Link href="/produtos">
                <ShoppingCart className="mr-2 h-4 w-4" /> Continuar a comprar
              </Link>
            </Button>
            <Button
              onClick={handleLogout}
              variant="outline"
              className="h-11 border-rose-200 text-rose-600 hover:bg-rose-50"
            >
              <LogOut className="mr-2 h-4 w-4" /> Terminar sessão
            </Button>
          </div>

          {/* Histórico de compras */}
          <div className="mt-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <History className="h-5 w-5 text-emerald-600" /> Histórico de compras
            </h2>

            {!ordersLoaded ? (
              <p className="mt-3 text-sm text-slate-400">A carregar encomendas…</p>
            ) : orders.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                <Package className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">
                  Ainda não fizeste nenhuma compra. Explora o catálogo e recebe
                  a confirmação no WhatsApp.
                </p>
                <Button
                  asChild
                  size="sm"
                  className="mt-4 bg-emerald-500 text-white hover:bg-emerald-600"
                >
                  <Link href="/produtos">Ver produtos</Link>
                </Button>
              </div>
            ) : (
              <ul className="mt-3 space-y-3">
                {orders.map((order) => (
                  <li
                    key={order.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        Encomenda n.º {order.id}
                      </p>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          ORDER_STATUS_BADGES[order.status] ??
                          'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {ORDER_STATUS_LABELS[order.status] ?? order.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      {formatDateTime(order.created_at)} ·{' '}
                      {order.delivery_type === 'domicilio' ? 'Entrega ao domicílio' : 'Retirada'}
                    </p>
                    <ul className="mt-2 space-y-1 text-sm text-slate-600">
                      {order.items.map((item, index) => {
                        const canDownload =
                          item.type === 'infoproduto' &&
                          item.file_url &&
                          ['pago', 'entregue'].includes(order.status);
                        return (
                          <li
                            key={`${order.id}-${index}`}
                            className="flex flex-wrap items-center justify-between gap-2"
                          >
                            <span className="truncate">
                              {item.quantity}× {item.name}
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              {canDownload && (
                                <a
                                  href={`/api/products/${item.id}/download`}
                                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-600"
                                >
                                  <Download className="h-3.5 w-3.5" /> Descarregar
                                </a>
                              )}
                              <span className="font-medium">
                                {formatKz(item.price_kz * item.quantity)}
                              </span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {order.items.some(
                      (i) => i.type === 'infoproduto' && i.file_url
                    ) &&
                      !['pago', 'entregue'].includes(order.status) && (
                        <p className="mt-1 text-[11px] text-slate-400">
                          O download dos teus infoprodutos fica disponível assim que o
                          pagamento for confirmado.
                        </p>
                      )}
                    <p className="mt-2 border-t border-slate-100 pt-2 text-right text-sm font-bold text-slate-900">
                      Total: {formatKz(order.total_kz)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ Perfil do VENDEDOR ═══════════════════ */

function SellerProfile({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const { toast } = useToast();
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadProducts = useCallback(async () => {
    try {
      const res = await fetch('/api/products?meu=1', { headers: authHeaders() });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { products: Product[] };
      setProducts(data.products ?? []);
    } catch {
      setProducts([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  async function handleDelete(product: Product) {
    if (deletingId !== product.id) {
      setDeletingId(product.id);
      return;
    }
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error);
      toast({ title: 'Produto eliminado', description: product.name });
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
    } catch (error) {
      toast({
        title: 'Não foi possível eliminar',
        description: error instanceof Error ? error.message : 'Tenta novamente.',
      });
    } finally {
      setDeletingId(null);
    }
  }

  function handleLogout() {
    onLogout();
    toast({ title: 'Sessão terminada', description: 'Volta sempre à AngoStart!' });
  }

  const sellerInfo: { icon: typeof Mail; label: string; value: string | null }[] = [];
  if (user.role === 'criador') {
    sellerInfo.push({ icon: Sparkles, label: 'Bio', value: user.bio });
  }
  if (user.role === 'prestador_domicilio') {
    sellerInfo.push({ icon: Briefcase, label: 'Área de atuação', value: user.area_atuacao });
    sellerInfo.push({ icon: HomeIcon, label: 'Cidade', value: user.cidade });
  }
  if (user.role === 'prestador_remoto') {
    sellerInfo.push({ icon: Briefcase, label: 'Especialidade', value: user.especialidade });
    sellerInfo.push({ icon: Globe, label: 'Portfólio', value: user.portfolio_url });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <ProfileHeader user={user} badge={ROLE_BADGE[user.role] ?? 'Vendedor'} />

        <div className="space-y-4 px-6 py-8 sm:px-10">
          <InfoRow icon={Mail} label="Email" value={user.email} />
          <InfoRow icon={Phone} label="Telefone" value={user.telefone} />
          {sellerInfo.map(({ icon, label, value }) => (
            <InfoRow key={label} icon={icon} label={label} value={value} />
          ))}

          {/* Ações do vendedor */}
          <div className="grid gap-3 pt-2 sm:grid-cols-2">
            <Button
              onClick={() => router.push('/adicionar-produto')}
              className="h-11 bg-amber-500 text-white hover:bg-amber-600"
            >
              <Plus className="mr-2 h-4 w-4" /> Adicionar Produto
            </Button>
            <Button
              onClick={() => router.push('/dashboard/vendedor')}
              className="h-11 bg-slate-900 text-white hover:bg-slate-800"
            >
              <BarChart3 className="mr-2 h-4 w-4" /> Painel de vendas
            </Button>
            <Button
              onClick={() => router.push('/dashboard/vendedor/portfolio')}
              variant="outline"
              className="h-11 border-emerald-500 text-emerald-600 hover:bg-emerald-50"
            >
              <Pencil className="mr-2 h-4 w-4" /> Editar portfólio
            </Button>
            {user.username && (
              <Button
                onClick={() => router.push(`/portfolio/${user.username}`)}
                variant="outline"
                className="h-11 border-emerald-500 text-emerald-600 hover:bg-emerald-50"
              >
                <ExternalLink className="mr-2 h-4 w-4" /> Ver portfólio público
              </Button>
            )}
            <Button
              onClick={handleLogout}
              variant="outline"
              className="h-11 border-rose-200 text-rose-600 hover:bg-rose-50"
            >
              <LogOut className="mr-2 h-4 w-4" /> Terminar sessão
            </Button>
          </div>

          {/* Lista dos produtos publicados */}
          <div className="mt-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <Package className="h-5 w-5 text-emerald-600" /> Os meus produtos e serviços
            </h2>

            {!loaded ? (
              <p className="mt-3 text-sm text-slate-400">A carregar os teus produtos…</p>
            ) : products.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                <CircleDollarSign className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">
                  Ainda não publicaste nada. Adiciona o teu primeiro produto ou
                  serviço e aparece no catálogo da AngoStart.
                </p>
                <Button
                  onClick={() => router.push('/adicionar-produto')}
                  size="sm"
                  className="mt-4 bg-amber-500 text-white hover:bg-amber-600"
                >
                  <Plus className="mr-2 h-4 w-4" /> Publicar agora
                </Button>
              </div>
            ) : (
              <ul className="mt-3 space-y-3">
                {products.map((product) => (
                  <li
                    key={product.id}
                    className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {product.name}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                        {product.description}
                      </p>
                      <p className="mt-1 text-sm font-bold text-emerald-600">
                        {formatKz(product.price_kz)}
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                          {product.type.replace('_', ' ')}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        onClick={() => router.push(`/adicionar-produto?edit=${product.id}`)}
                        size="sm"
                        variant="outline"
                        className="h-9 border-emerald-500 text-emerald-600 hover:bg-emerald-50"
                        aria-label={`Editar ${product.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                        <span className="ml-1.5">Editar</span>
                      </Button>
                      <Button
                        onClick={() => handleDelete(product)}
                        size="sm"
                        variant="outline"
                        className={`h-9 ${
                          deletingId === product.id
                            ? 'border-rose-500 bg-rose-500 text-white hover:bg-rose-600'
                            : 'border-rose-200 text-rose-600 hover:bg-rose-50'
                        }`}
                        aria-label={`Eliminar ${product.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="ml-1.5">
                          {deletingId === product.id ? 'Confirmar?' : 'Eliminar'}
                        </span>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
