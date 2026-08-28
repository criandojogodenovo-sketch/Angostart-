'use client';

/**
 * AngoStart — Painel de Administração Total (/admin) — ROTA OCULTA.
 *
 * 🔒 Proteção: middleware exige cookie 2FA (role='admin'); a API valida
 * Bearer + role em cada pedido. Esta rota NÃO está linkada em menus,
 * sitemap ou robots.txt — acesso apenas por URL direto.
 *
 * Funcionalidades: utilizadores (bloquear), produtos (eliminar),
 * validação de comprovativos (aprovar/rejeitar), criação de admins
 * limitados e ativação do 2FA (QR TOTP).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  LogOut,
  Package,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react';
import AdminGate from '@/components/AdminGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authHeaders, useAuth } from '@/context/AuthContext';
import { formatKz } from '@/lib/format';
import { ROLE_LABELS, type Role } from '@/lib/roles';
import { useToast } from '@/hooks/use-toast';

interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: string;
  username: string | null;
  cidade: string | null;
  blocked: boolean;
  two_factor_enabled: boolean;
  created_at: string;
}

interface AdminProduct {
  id: number;
  name: string;
  price_kz: number;
  type: string;
  user_id: number | null;
  seller_name?: string | null;
}

interface AdminOrder {
  id: number;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  items: { id: number; name: string; price_kz: number; quantity: number }[];
  total_kz: number;
  status: string;
  comprovativo_url: string | null;
  created_at: string;
}

type Tab = 'utilizadores' | 'produtos' | 'encomendas' | 'admins' | 'seguranca';

const TABS: { key: Tab; label: string; icon: typeof Users }[] = [
  { key: 'encomendas', label: 'Comprovativos', icon: FileText },
  { key: 'utilizadores', label: 'Utilizadores', icon: Users },
  { key: 'produtos', label: 'Produtos', icon: Package },
  { key: 'admins', label: 'Admin Limitado', icon: UserPlus },
  { key: 'seguranca', label: 'Segurança 2FA', icon: ShieldCheck },
];

export default function AdminPage() {
  return (
    <AdminGate title="Administração Total">
      {() => <AdminPanel />}
    </AdminGate>
  );
}

function AdminPanel() {
  const { logout } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('encomendas');

  /* ── Utilizadores ── */
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  /* ── Produtos ── */
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);

  /* ── Encomendas pendentes ── */
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  /* ── Criar admin limitado ── */
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPass, setNewPass] = useState('');
  const [creating, setCreating] = useState(false);

  /* ── 2FA setup ── */
  const [qr, setQr] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await fetch('/api/admin/users', { headers: authHeaders() });
      const data = (await res.json()) as { users?: AdminUser[]; error?: string };
      if (!res.ok) {
        toast({ title: 'Erro', description: data.error });
        return;
      }
      setUsers(data.users ?? []);
    } finally {
      setUsersLoading(false);
    }
  }, [toast]);

  const loadProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const res = await fetch('/api/products');
      const data = (await res.json()) as { products?: AdminProduct[] };
      setProducts(data.products ?? []);
    } finally {
      setProductsLoading(false);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const res = await fetch('/api/admin/orders?status=pendente', { headers: authHeaders() });
      const data = (await res.json()) as { orders?: AdminOrder[]; error?: string };
      if (!res.ok) {
        toast({ title: 'Erro', description: data.error });
        return;
      }
      setOrders(data.orders ?? []);
    } finally {
      setOrdersLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (tab === 'utilizadores') loadUsers();
    if (tab === 'produtos') loadProducts();
  }, [tab, loadUsers, loadProducts]);

  async function toggleBlock(user: AdminUser) {
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ blocked: !user.blocked }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      toast({ title: 'Não foi possível atualizar', description: data.error });
      return;
    }
    toast({
      title: user.blocked ? 'Utilizador desbloqueado' : 'Utilizador bloqueado',
      description: user.email,
    });
    loadUsers();
  }

  async function deleteProduct(product: AdminProduct) {
    const res = await fetch(`/api/products/${product.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      toast({ title: 'Não foi possível eliminar', description: data.error });
      return;
    }
    toast({ title: 'Produto eliminado', description: product.name });
    loadProducts();
  }

  async function reviewOrder(order: AdminOrder, approve: boolean) {
    const res = await fetch(`/api/admin/orders/${order.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ status: approve ? 'pago' : 'rejeitado' }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      toast({ title: 'Não foi possível validar', description: data.error });
      return;
    }
    toast({
      title: approve ? `Encomenda #${order.id} aprovada` : `Encomenda #${order.id} rejeitada`,
    });
    loadOrders();
  }

  async function createLimited(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/admin/limited', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ name: newName, email: newEmail, password: newPass }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível criar', description: data.error });
        return;
      }
      toast({ title: 'Admin limitado criado', description: data.message });
      setNewName('');
      setNewEmail('');
      setNewPass('');
    } finally {
      setCreating(false);
    }
  }

  async function setup2FA() {
    setGenerating(true);
    try {
      const res = await fetch('/api/auth/2fa/setup', {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = (await res.json()) as { qr?: string; otpauth?: string; error?: string };
      if (!res.ok) {
        toast({ title: 'Erro no 2FA', description: data.error });
        return;
      }
      setQr(data.qr ?? null);
      setOtpauth(data.otpauth ?? null);
    } finally {
      setGenerating(false);
    }
  }

  async function logoutAdmin() {
    await fetch('/api/auth/2fa/logout', { method: 'POST' });
    logout();
    window.location.href = '/?admin=out';
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <ShieldCheck className="h-7 w-7 text-emerald-500" /> Administração Total
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Rota oculta <code className="rounded bg-slate-100 px-1.5 py-0.5">/admin</code> — não
            indexada nem linkada no site.
          </p>
        </div>
        <Button variant="outline" onClick={logoutAdmin} className="h-10">
          <LogOut className="mr-2 h-4 w-4" /> Sair do painel
        </Button>
      </div>

      {/* Tabs */}
      <nav aria-label="Secções do painel" className="mt-6 flex flex-wrap gap-2">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              tab === key
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 shadow-sm hover:bg-slate-50'
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
            {key === 'encomendas' && orders.length > 0 && (
              <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-bold text-slate-900">
                {orders.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* ── Comprovativos ── */}
      {tab === 'encomendas' && (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">
              Encomendas pendentes de validação
            </h2>
            <Button variant="ghost" size="sm" onClick={loadOrders}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${ordersLoading ? 'animate-spin' : ''}`} /> Atualizar
            </Button>
          </div>
          {orders.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">
              Sem encomendas pendentes. Bom trabalho!
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {orders.map((order) => (
                <li key={order.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        #{order.id} — {order.customer_name}{' '}
                        <span className="font-normal text-slate-400">({order.customer_phone})</span>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {order.items.map((i) => `${i.quantity}× ${i.name}`).join(' · ')}
                      </p>
                      <p className="text-xs text-slate-400">
                        {new Date(order.created_at).toLocaleString('pt-PT')}
                      </p>
                      {order.comprovativo_url ? (
                        <a
                          href={order.comprovativo_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-sky-600 hover:underline"
                        >
                          <FileText className="h-3.5 w-3.5" /> Ver comprovativo <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <p className="mt-2 text-xs text-slate-400">Sem comprovativo anexado</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-base font-bold text-emerald-600">
                        {formatKz(order.total_kz)}
                      </span>
                      <Button
                        size="sm"
                        onClick={() => reviewOrder(order, true)}
                        className="h-9 bg-emerald-500 text-white hover:bg-emerald-600"
                      >
                        <CheckCircle2 className="mr-1 h-4 w-4" /> Aprovar
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => reviewOrder(order, false)}
                        variant="outline"
                        className="h-9 border-rose-300 text-rose-600 hover:bg-rose-50"
                      >
                        <XCircle className="mr-1 h-4 w-4" /> Rejeitar
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ── Utilizadores ── */}
      {tab === 'utilizadores' && (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">Utilizadores ({users.length})</h2>
            <Button variant="ghost" size="sm" onClick={loadUsers}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${usersLoading ? 'animate-spin' : ''}`} /> Atualizar
            </Button>
          </div>
          <ul className="divide-y divide-slate-100">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {u.name}{' '}
                    <span className="font-normal text-slate-400">({u.email})</span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">
                      {ROLE_LABELS[u.role as Role] ?? u.role}
                    </span>
                    {u.two_factor_enabled && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-600">
                        2FA ativa
                      </span>
                    )}
                    {u.username && <span>@{u.username}</span>}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toggleBlock(u)}
                  className={`h-9 ${
                    u.blocked
                      ? 'border-emerald-300 text-emerald-600 hover:bg-emerald-50'
                      : 'border-rose-300 text-rose-600 hover:bg-rose-50'
                  }`}
                >
                  {u.blocked ? (
                    <>
                      <CheckCircle2 className="mr-1 h-4 w-4" /> Desbloquear
                    </>
                  ) : (
                    <>
                      <Ban className="mr-1 h-4 w-4" /> Bloquear
                    </>
                  )}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Produtos ── */}
      {tab === 'produtos' && (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">Produtos ({products.length})</h2>
            <Button variant="ghost" size="sm" onClick={loadProducts}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${productsLoading ? 'animate-spin' : ''}`} /> Atualizar
            </Button>
          </div>
          {products.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">Sem produtos publicados.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {products.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      #{p.id} — {p.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {p.type} · vendedor: {p.seller_name ?? '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-emerald-600">{formatKz(p.price_kz)}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deleteProduct(p)}
                      className="h-9 border-rose-300 text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="mr-1 h-4 w-4" /> Eliminar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ── Criar admin limitado ── */}
      {tab === 'admins' && (
        <section className="mt-6 max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Adicionar Admin Limitado</h2>
          <p className="mt-1 text-xs text-slate-500">
            Este admin só pode validar comprovativos em <code>/admin-limitado</code> — sem acesso
            a utilizadores, produtos ou criação de admins. Deve ativar o 2FA no primeiro acesso.
          </p>
          <form onSubmit={createLimited} className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="al-nome">Nome</Label>
              <Input id="al-nome" value={newName} onChange={(e) => setNewName(e.target.value)} required minLength={3} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="al-email">Email</Label>
              <Input id="al-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="al-pass">Palavra-passe (mín. 8)</Label>
              <Input
                id="al-pass"
                type="password"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <Button
              type="submit"
              disabled={creating}
              className="h-11 w-full bg-slate-900 font-semibold text-white hover:bg-slate-800"
            >
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <UserPlus className="mr-2 h-4 w-4" /> Criar admin limitado
            </Button>
          </form>
        </section>
      )}

      {/* ── Segurança 2FA ── */}
      {tab === 'seguranca' && (
        <section className="mt-6 max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Ativar / reconfigurar 2FA (TOTP)</h2>
          <p className="mt-1 text-xs text-slate-500">
            1. Clica em gerar → 2. abre a app autenticadora (Google Authenticator, Aegis, Authy…) →
            3. lê o QR → 4. valida o código de 6 dígitos no ecrã de entrada do painel.
          </p>
          <Button onClick={setup2FA} disabled={generating} className="mt-4 h-11 bg-emerald-500 font-semibold text-white hover:bg-emerald-600">
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            Gerar QR Code do 2FA
          </Button>
          {qr && (
            <div className="mt-4 rounded-xl border border-slate-200 p-4 text-center">
              { }
              <img src={qr} alt="QR Code 2FA" className="mx-auto rounded-lg" width={220} height={220} />
              <p className="mt-3 break-all text-[11px] text-slate-400">{otpauth}</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
