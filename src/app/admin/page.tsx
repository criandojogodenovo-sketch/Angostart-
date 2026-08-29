'use client';

/**
 * AngoStart — Painel de Administração Total (/admin) — ROTA OCULTA.
 *
 * 🔒 Proteção: middleware exige cookie 2FA (role='admin'); a API valida
 * Bearer + role em cada pedido. Esta rota NÃO está linkada em menus,
 * sitemap ou robots.txt — acesso apenas por URL direto.
 *
 * Funcionalidades: utilizadores (bloquear), produtos (eliminar),
 * validação de comprovativos (aprovar/rejeitar), gestão dinâmica de
 * admins limitados (convites + código diário) e ativação do 2FA (QR TOTP).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Ban,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Eye,
  FileText,
  Loader2,
  LogOut,
  Mail,
  Megaphone,
  Package,
  RefreshCw,
  Send,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import AdminGate from '@/components/AdminGate';
import ProofReviewList, {
  type KwikAdminOrder,
} from '@/components/ProofReviewList';
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

type Tab =
  | 'utilizadores'
  | 'produtos'
  | 'encomendas'
  | 'carteira'
  | 'admins'
  | 'anuncios'
  | 'monitorizacao'
  | 'relatorios'
  | 'seguranca';

interface AdminInviteRow {
  id: number;
  email: string;
  name: string | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  created_by_email: string | null;
}

interface LimitedAdminRow {
  id: number;
  name: string;
  email: string;
  blocked: boolean;
  two_factor_enabled: boolean;
  whatsapp_contact: string | null;
  created_at: string;
}

interface AnnouncementRow {
  id: number;
  title: string;
  content: string;
  type: string;
  target_role: string | null;
  active: boolean;
  created_at: string;
  created_by_name: string | null;
}

interface SuspiciousRow {
  id: number;
  user_id: number;
  action: string;
  details: string | null;
  severity: string;
  status: string;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
  user_blocked: boolean | null;
}

interface AdminReport {
  usersByRole: { role: string; n: number }[];
  products: { total: number; hot: number; activeSellers: number };
  ordersByStatus: { status: string; n: number; volume: number }[];
  monthly: { month: string; orders: number; revenue: number; commission: number }[];
  totals: { revenue: number; commission: number; newUsers30d: number };
}

interface DailyCodeRow {
  id: number;
  admin_id: number;
  admin_email: string;
  date: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

interface WalletOpRow {
  id: number;
  tipo: 'deposito' | 'saque';
  valor: number;
  status: string;
  referencia: string | null;
  descricao: string | null;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
  user_telefone: string | null;
}

/** Filtros de estado da fila de comprovativos. */
const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'aguardando_validacao', label: 'Aguardando validação' },
  { value: 'pendente', label: 'Pendentes (sem comprovativo)' },
  { value: 'pago', label: 'Pagas' },
  { value: 'rejeitado', label: 'Rejeitadas' },
  { value: 'entregue', label: 'Entregues' },
  { value: 'falhou', label: 'Falhadas' },
];

const TABS: { key: Tab; label: string; icon: typeof Users }[] = [
  { key: 'encomendas', label: 'Comprovativos', icon: FileText },
  { key: 'carteira', label: 'Carteira', icon: Wallet },
  { key: 'utilizadores', label: 'Utilizadores', icon: Users },
  { key: 'produtos', label: 'Produtos', icon: Package },
  { key: 'anuncios', label: 'Anúncios', icon: Megaphone },
  { key: 'monitorizacao', label: 'Monitorização', icon: Eye },
  { key: 'relatorios', label: 'Relatórios', icon: BarChart3 },
  { key: 'admins', label: 'Gerir Admins Limitados', icon: UserPlus },
  { key: 'seguranca', label: 'Segurança 2FA', icon: ShieldCheck },
];

const ANNOUNCEMENT_TYPES = [
  { value: 'promo', label: 'Promoção' },
  { value: 'destaque', label: 'Destaque' },
  { value: 'novidade', label: 'Novidade' },
  { value: 'exclusivo', label: 'Exclusivo (só equipa)' },
];

const TARGET_ROLE_OPTIONS = [
  { value: 'todos', label: 'Todos' },
  { value: 'cliente', label: 'Clientes' },
  { value: 'criador', label: 'Criadores' },
  { value: 'prestador_domicilio', label: 'Prestadores ao Domicílio' },
  { value: 'prestador_remoto', label: 'Freelancers Remotos' },
  { value: 'admin_limitado', label: 'Admins Limitados' },
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

  /* ── Encomendas / comprovativos KWiK ── */
  const [orders, setOrders] = useState<KwikAdminOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('aguardando_validacao');

  /* ── Carteira: depósitos e saques pendentes (Fase 4) ── */
  const [walletOps, setWalletOps] = useState<WalletOpRow[]>([]);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletBusyId, setWalletBusyId] = useState<number | null>(null);

  /* ── Gerir Admins Limitados (convites + código diário) ── */
  const [invites, setInvites] = useState<AdminInviteRow[]>([]);
  const [limitedAdmins, setLimitedAdmins] = useState<LimitedAdminRow[]>([]);
  const [dailyCodes, setDailyCodes] = useState<DailyCodeRow[]>([]);
  const [adminDataLoading, setAdminDataLoading] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [busyAdminId, setBusyAdminId] = useState<number | null>(null);
  const [whatsappDraft, setWhatsappDraft] = useState<Record<number, string>>({});

  /* ── Anúncios (Fase 5) ── */
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(false);
  const [annTitle, setAnnTitle] = useState('');
  const [annContent, setAnnContent] = useState('');
  const [annType, setAnnType] = useState('promo');
  const [annTarget, setAnnTarget] = useState('todos');
  const [annCreating, setAnnCreating] = useState(false);

  /* ── Monitorização anti-burla (Fase 5) ── */
  const [suspicious, setSuspicious] = useState<SuspiciousRow[]>([]);
  const [suspiciousLoading, setSuspiciousLoading] = useState(false);
  const [suspiciousStatus, setSuspiciousStatus] = useState('aberta');

  /* ── Relatórios (Fase 5) ── */
  const [report, setReport] = useState<AdminReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

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
      const res = await fetch(`/api/admin/orders?status=${statusFilter}`, {
        headers: authHeaders(),
      });
      const data = (await res.json()) as { orders?: KwikAdminOrder[]; error?: string };
      if (!res.ok) {
        toast({ title: 'Erro', description: data.error });
        return;
      }
      setOrders(data.orders ?? []);
    } finally {
      setOrdersLoading(false);
    }
  }, [toast, statusFilter]);

  const loadWalletOps = useCallback(async () => {
    setWalletLoading(true);
    try {
      const res = await fetch('/api/admin/wallet', { headers: authHeaders() });
      const data = (await res.json()) as { ops?: WalletOpRow[]; error?: string };
      if (!res.ok) {
        toast({ title: 'Erro', description: data.error });
        return;
      }
      setWalletOps(data.ops ?? []);
    } finally {
      setWalletLoading(false);
    }
  }, [toast]);

  const loadAdminSecurityData = useCallback(async () => {
    setAdminDataLoading(true);
    try {
      const res = await fetch('/api/admin/invites', { headers: authHeaders() });
      const data = (await res.json()) as {
        invites?: AdminInviteRow[];
        limitedAdmins?: LimitedAdminRow[];
        dailyCodes?: DailyCodeRow[];
        error?: string;
      };
      if (!res.ok) {
        toast({ title: 'Erro', description: data.error });
        return;
      }
      setInvites(data.invites ?? []);
      setLimitedAdmins(data.limitedAdmins ?? []);
      setDailyCodes(data.dailyCodes ?? []);
    } finally {
      setAdminDataLoading(false);
    }
  }, [toast]);

  /* ── Anúncios (Fase 5) ── */
  const loadAnnouncements = useCallback(async () => {
    setAnnouncementsLoading(true);
    try {
      const res = await fetch('/api/admin/announcements', { headers: authHeaders() });
      const data = (await res.json()) as { announcements?: AnnouncementRow[] };
      setAnnouncements(data.announcements ?? []);
    } finally {
      setAnnouncementsLoading(false);
    }
  }, []);

  /* ── Monitorização anti-burla (Fase 5) ── */
  const loadSuspicious = useCallback(async () => {
    setSuspiciousLoading(true);
    try {
      const res = await fetch(`/api/admin/monitorizacao?status=${suspiciousStatus}`, {
        headers: authHeaders(),
      });
      const data = (await res.json()) as { activities?: SuspiciousRow[] };
      setSuspicious(data.activities ?? []);
    } finally {
      setSuspiciousLoading(false);
    }
  }, [suspiciousStatus]);

  /* ── Relatórios (Fase 5) ── */
  const loadReport = useCallback(async () => {
    setReportLoading(true);
    try {
      const res = await fetch('/api/admin/report', { headers: authHeaders() });
      const data = (await res.json()) as { error?: string } & Partial<AdminReport>;
      if (!res.ok) {
        toast({ title: 'Erro', description: data.error });
        return;
      }
      if (data.usersByRole && data.products && data.ordersByStatus && data.monthly && data.totals) {
        setReport(data as AdminReport);
      }
    } finally {
      setReportLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (tab === 'encomendas') loadOrders();
  }, [tab, loadOrders]);

  useEffect(() => {
    if (tab === 'utilizadores') loadUsers();
    if (tab === 'produtos') loadProducts();
    if (tab === 'admins') loadAdminSecurityData();
    if (tab === 'carteira') loadWalletOps();
    if (tab === 'anuncios') loadAnnouncements();
    if (tab === 'monitorizacao') loadSuspicious();
    if (tab === 'relatorios') loadReport();
  }, [tab, loadUsers, loadProducts, loadAdminSecurityData, loadWalletOps, loadAnnouncements, loadSuspicious, loadReport]);

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    setInviting(true);
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ name: inviteName, email: inviteEmail }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string; code?: string; delivered?: boolean };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível convidar', description: data.error });
        return;
      }
      toast({
        title: 'Convite criado',
        description: data.delivered === false ? data.code : data.message,
      });
      setInviteName('');
      setInviteEmail('');
      loadAdminSecurityData();
    } finally {
      setInviting(false);
    }
  }

  async function revokeInvite(invite: AdminInviteRow) {
    const res = await fetch(`/api/admin/invites/${invite.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      toast({ title: 'Não foi possível revogar', description: data.error });
      return;
    }
    toast({ title: 'Convite revogado', description: invite.email });
    loadAdminSecurityData();
  }

  async function sendDailyCode(admin: LimitedAdminRow) {
    setBusyAdminId(admin.id);
    try {
      const res = await fetch('/api/admin/daily-code/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ admin_id: admin.id }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível enviar', description: data.error });
        return;
      }
      toast({ title: 'Código diário enviado', description: `${admin.email} — ${data.message}` });
      loadAdminSecurityData();
    } finally {
      setBusyAdminId(null);
    }
  }

  async function removeLimitedAdmin(admin: LimitedAdminRow) {
    const res = await fetch(`/api/admin/limited-admins/${admin.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      toast({ title: 'Não foi possível remover', description: data.error });
      return;
    }
    toast({ title: 'Admin limitado removido', description: admin.email });
    loadAdminSecurityData();
  }

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

  async function reviewOrder(
    order: KwikAdminOrder,
    approve: boolean,
    note: string
  ) {
    const res = await fetch(`/api/admin/orders/${order.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        status: approve ? 'pago' : 'rejeitado',
        admin_note: note || undefined,
      }),
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

  /** Aprova/recusa um depósito ou saque da carteira (Fase 4). */
  async function decideWalletOp(op: WalletOpRow, approve: boolean) {
    setWalletBusyId(op.id);
    try {
      const res = await fetch(`/api/admin/wallet/${op.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: approve ? 'aprovar' : 'rejeitar' }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível processar', description: data.error });
        return;
      }
      toast({
        title: approve
          ? `${op.tipo === 'deposito' ? 'Depósito' : 'Saque'} aprovado`
          : `${op.tipo === 'deposito' ? 'Depósito' : 'Saque'} recusado`,
        description: op.referencia ?? `#${op.id}`,
      });
      loadWalletOps();
    } finally {
      setWalletBusyId(null);
    }
  }

  /* ── WhatsApp do admin limitado (Fase 5 — código enviado manualmente) ── */
  async function saveWhatsapp(admin: LimitedAdminRow) {
    setBusyAdminId(admin.id);
    try {
      const res = await fetch(`/api/admin/limited-admins/${admin.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ whatsapp_contact: whatsappDraft[admin.id] ?? admin.whatsapp_contact ?? '' }),
      });
      const data = (await res.json()) as { ok?: boolean; whatsapp_contact?: string; error?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível guardar', description: data.error });
        return;
      }
      toast({
        title: 'WhatsApp guardado',
        description: `${admin.name}: ${data.whatsapp_contact ?? 'removido'}`,
      });
      loadAdminSecurityData();
    } finally {
      setBusyAdminId(null);
    }
  }

  /* ── Anúncios (Fase 5) ── */
  async function createAnnouncement(event: React.FormEvent) {
    event.preventDefault();
    setAnnCreating(true);
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          title: annTitle,
          content: annContent,
          type: annType,
          target_role: annTarget === 'todos' ? null : annTarget,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível criar', description: data.error });
        return;
      }
      toast({ title: 'Anúncio criado', description: 'Já está visível no site.' });
      setAnnTitle('');
      setAnnContent('');
      loadAnnouncements();
    } finally {
      setAnnCreating(false);
    }
  }

  async function toggleAnnouncement(a: AnnouncementRow) {
    const res = await fetch(`/api/admin/announcements/${a.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ active: !a.active }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      toast({ title: 'Não foi possível atualizar', description: data.error });
      return;
    }
    loadAnnouncements();
  }

  async function deleteAnnouncement(a: AnnouncementRow) {
    const res = await fetch(`/api/admin/announcements/${a.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      toast({ title: 'Não foi possível remover', description: data.error });
      return;
    }
    toast({ title: 'Anúncio removido' });
    loadAnnouncements();
  }

  /* ── Monitorização: decidir atividade suspeita (Fase 5) ── */
  async function suspiciousAction(row: SuspiciousRow, acao: string) {
    const res = await fetch('/api/admin/monitorizacao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ id: row.id, acao }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      toast({ title: 'Não foi possível aplicar', description: data.error });
      return;
    }
    toast({
      title:
        acao === 'desbloquear'
          ? 'Conta desbloqueada'
          : acao === 'banir'
            ? 'Banimento aplicado'
            : acao === 'ignorar'
              ? 'Atividade ignorada'
              : 'Atividade resolvida',
      description: `${row.user_name ?? row.user_email ?? '#' + row.user_id}`,
    });
    loadSuspicious();
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

      {/* ── Comprovativos KWiK ── */}
      {tab === 'encomendas' && (
        <>
          <nav aria-label="Filtrar encomendas por estado" className="mt-6 flex flex-wrap gap-2">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                onClick={() => setStatusFilter(filter.value)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  statusFilter === filter.value
                    ? 'bg-emerald-500 text-white shadow-sm'
                    : 'bg-white text-slate-600 shadow-sm hover:bg-slate-50'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </nav>
          <ProofReviewList
            orders={orders}
            loading={ordersLoading}
            emptyMessage={
              statusFilter === 'aguardando_validacao'
                ? 'Sem comprovativos KWiK à espera de validação. Bom trabalho!'
                : 'Sem encomendas neste estado.'
            }
            onReload={loadOrders}
            onReview={reviewOrder}
          />
        </>
      )}

      {/* ── Carteira: depósitos e saques ── */}
      {tab === 'carteira' && (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Carteira — depósitos e saques pendentes
              </h2>
              <p className="text-xs text-slate-400">
                Depósito aprovado entra no saldo; saque recusado devolve o valor.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={loadWalletOps}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${walletLoading ? 'animate-spin' : ''}`} /> Atualizar
            </Button>
          </div>
          {walletOps.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">
              Sem operações pendentes na carteira.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {walletOps.map((op) => (
                <li key={op.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      <span
                        className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${
                          op.tipo === 'deposito'
                            ? 'bg-sky-100 text-sky-700'
                            : 'bg-violet-100 text-violet-700'
                        }`}
                      >
                        {op.tipo === 'deposito' ? 'Depósito' : 'Saque'}
                      </span>
                      {op.referencia ?? `#${op.id}`}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {op.user_name ?? '—'} ({op.user_email ?? '—'})
                      {op.user_telefone ? ` · ${op.user_telefone}` : ''}
                    </p>
                    <p className="text-xs text-slate-400">
                      {new Date(op.created_at).toLocaleString('pt-PT')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-emerald-600">{formatKz(op.valor)}</span>
                    {op.tipo === 'deposito' ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => decideWalletOp(op, true)}
                          disabled={walletBusyId === op.id}
                          className="h-9 bg-emerald-500 text-white hover:bg-emerald-600"
                        >
                          {walletBusyId === op.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="mr-1 h-4 w-4" />
                          )}
                          Aprovar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => decideWalletOp(op, false)}
                          disabled={walletBusyId === op.id}
                          className="h-9 border-rose-300 text-rose-600 hover:bg-rose-50"
                        >
                          <XCircle className="mr-1 h-4 w-4" /> Recusar
                        </Button>
                      </>
                    ) : (
                      <>
                        {/* Saque: o dinheiro já saiu do saldo do utilizador */}
                        <Button
                          size="sm"
                          onClick={() => decideWalletOp(op, true)}
                          disabled={walletBusyId === op.id}
                          className="h-9 bg-emerald-500 text-white hover:bg-emerald-600"
                        >
                          {walletBusyId === op.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="mr-1 h-4 w-4" />
                          )}
                          Enviado
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => decideWalletOp(op, false)}
                          disabled={walletBusyId === op.id}
                          className="h-9 border-rose-300 text-rose-600 hover:bg-rose-50"
                        >
                          <XCircle className="mr-1 h-4 w-4" /> Recusar e devolver
                        </Button>
                      </>
                    )}
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

      {/* ── Gerir Admins Limitados (convites + código diário) ── */}
      {tab === 'admins' && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* Convidar */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <UserPlus className="h-4 w-4" /> Convidar Admin Limitado
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Sem palavra-passe fixa: a conta é criada em <code className="rounded bg-slate-100 px-1">/admin-limitado</code> com
              email + código de convite (24 h) e fica protegida por 2FA. Nos dias seguintes, o acesso
              usa um código diário de 6 dígitos enviado por email.
            </p>
            <form onSubmit={sendInvite} className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="al-nome">Nome</Label>
                <Input id="al-nome" value={inviteName} onChange={(e) => setInviteName(e.target.value)} required minLength={3} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="al-email">Email do convidado</Label>
                <Input id="al-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
              </div>
              <Button
                type="submit"
                disabled={inviting}
                className="h-11 w-full bg-slate-900 font-semibold text-white hover:bg-slate-800"
              >
                {inviting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Send className="mr-2 h-4 w-4" /> Enviar convite por email
              </Button>
            </form>
          </section>

          {/* Estado */}
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">Estado da equipa de validação</h2>
              <Button variant="ghost" size="sm" onClick={loadAdminSecurityData}>
                <RefreshCw className={`mr-1.5 h-4 w-4 ${adminDataLoading ? 'animate-spin' : ''}`} /> Atualizar
              </Button>
            </div>
            <div className="max-h-96 space-y-6 overflow-y-auto px-5 py-4">
              {/* Contas ativas */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  Contas ativas ({limitedAdmins.length})
                </h3>
                {limitedAdmins.length === 0 ? (
                  <p className="py-3 text-sm text-slate-400">Ainda sem admins limitados — envia o primeiro convite.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {limitedAdmins.map((a) => (
                      <li key={a.id} className="py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{a.name}</p>
                            <p className="truncate text-xs text-slate-500">{a.email}</p>
                            <p className="mt-0.5 flex gap-1.5 text-[11px]">
                              <span className={`rounded-full px-2 py-0.5 font-semibold ${a.two_factor_enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                                {a.two_factor_enabled ? '2FA ativa' : '2FA pendente'}
                              </span>
                              {a.blocked && <span className="rounded-full bg-rose-50 px-2 py-0.5 font-semibold text-rose-600">bloqueado</span>}
                              {a.whatsapp_contact && (
                                <span className="rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-600">
                                  WhatsApp: {a.whatsapp_contact}
                                </span>
                              )}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => sendDailyCode(a)}
                              disabled={busyAdminId === a.id}
                              className="h-8 border-emerald-300 text-emerald-600 hover:bg-emerald-50"
                            >
                              {busyAdminId === a.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Mail className="mr-1 h-3.5 w-3.5" />}
                              Código diário
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => removeLimitedAdmin(a)}
                              className="h-8 border-rose-300 text-rose-600 hover:bg-rose-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        {/* Contacto WhatsApp (Fase 5): envio MANUAL do código */}
                        <div className="mt-2 flex items-center gap-2">
                          <Input
                            value={whatsappDraft[a.id] ?? a.whatsapp_contact ?? ''}
                            onChange={(e) => setWhatsappDraft((prev) => ({ ...prev, [a.id]: e.target.value }))}
                            placeholder="9XX XXX XXX (para envio manual do código)"
                            inputMode="tel"
                            className="h-8 flex-1 text-xs"
                            aria-label={`WhatsApp de ${a.name}`}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => saveWhatsapp(a)}
                            disabled={busyAdminId === a.id}
                            className="h-8 shrink-0 border-sky-300 text-sky-600 hover:bg-sky-50"
                          >
                            {busyAdminId === a.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              'Guardar WhatsApp'
                            )}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Convites */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  Convites ({invites.length})
                </h3>
                {invites.length === 0 ? (
                  <p className="py-3 text-sm text-slate-400">Sem convites enviados.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {invites.map((i) => {
                      const expired = new Date(i.expires_at).getTime() <= Date.now();
                      const state = i.accepted_at ? 'aceite' : expired ? 'expirado' : 'pendente';
                      const stateCls =
                        state === 'aceite'
                          ? 'bg-emerald-50 text-emerald-600'
                          : state === 'pendente'
                            ? 'bg-amber-50 text-amber-600'
                            : 'bg-slate-100 text-slate-500';
                      return (
                        <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{i.email}</p>
                            <p className="text-xs text-slate-500">
                              {i.name ? `${i.name} · ` : ''}expira {new Date(i.expires_at).toLocaleDateString('pt-PT')}{' '}
                              {new Date(i.expires_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${stateCls}`}>{state}</span>
                            {!i.accepted_at && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => revokeInvite(i)}
                                className="h-8 border-rose-300 text-rose-600 hover:bg-rose-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Códigos diários gerados */}
              <div>
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
                  <CalendarClock className="h-3.5 w-3.5" /> Códigos diários gerados (últimos)
                </h3>
                {dailyCodes.length === 0 ? (
                  <p className="py-3 text-sm text-slate-400">Ainda não foram gerados códigos.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {dailyCodes.slice(0, 10).map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-slate-700">{c.admin_email}</p>
                          <p className="text-xs text-slate-400">dia {c.date}</p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.used_at ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-600'}`}>
                          {c.used_at ? 'usado' : 'ativo'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-slate-400">
                  <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
                  Por segurança os códigos ficam guardados apenas com hash — não podem ser
                  mostrados aqui; usa “Código diário” para reenviar um novo por email.
                </p>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ── Anúncios (Fase 5) ── */}
      {tab === 'anuncios' && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[380px_1fr]">
          {/* Criar anúncio */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Megaphone className="h-4 w-4" /> Criar anúncio
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Promoções, destaques e novidades aparecem no topo do site. Como administrador
              total também podes criar anúncios <strong>exclusivos</strong> (visíveis só à equipa).
              Admins limitados não têm acesso ao tipo exclusivo.
            </p>
            <form onSubmit={createAnnouncement} className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ann-titulo">Título</Label>
                <Input
                  id="ann-titulo"
                  value={annTitle}
                  onChange={(e) => setAnnTitle(e.target.value)}
                  placeholder="Ex.: -20% em infoprodutos até sexta"
                  required
                  minLength={3}
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ann-conteudo">Conteúdo</Label>
                <textarea
                  id="ann-conteudo"
                  value={annContent}
                  onChange={(e) => setAnnContent(e.target.value)}
                  rows={3}
                  placeholder="Detalhes do anúncio…"
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  required
                  minLength={5}
                  maxLength={800}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ann-tipo">Tipo</Label>
                  <select
                    id="ann-tipo"
                    value={annType}
                    onChange={(e) => setAnnType(e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    {ANNOUNCEMENT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ann-target">Destinatários</Label>
                  <select
                    id="ann-target"
                    value={annTarget}
                    onChange={(e) => setAnnTarget(e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    {TARGET_ROLE_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <Button
                type="submit"
                disabled={annCreating}
                className="h-11 w-full bg-emerald-500 font-semibold text-white hover:bg-emerald-600"
              >
                {annCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Send className="mr-2 h-4 w-4" /> Publicar anúncio
              </Button>
            </form>
          </section>

          {/* Lista de anúncios */}
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">
                Anúncios ({announcements.length})
              </h2>
              <Button variant="ghost" size="sm" onClick={loadAnnouncements}>
                <RefreshCw className={`mr-1.5 h-4 w-4 ${announcementsLoading ? 'animate-spin' : ''}`} /> Atualizar
              </Button>
            </div>
            {announcements.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-400">
                Sem anúncios — cria o primeiro no formulário ao lado.
              </p>
            ) : (
              <ul className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto">
                {announcements.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {a.title}{' '}
                        <span
                          className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${
                            a.type === 'exclusivo'
                              ? 'bg-slate-800 text-white'
                              : a.type === 'promo'
                                ? 'bg-amber-100 text-amber-700'
                                : a.type === 'destaque'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-sky-100 text-sky-700'
                          }`}
                        >
                          {a.type}
                        </span>
                        {!a.active && (
                          <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                            inativo
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{a.content}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {a.target_role ? `para ${a.target_role} · ` : 'para todos · '}
                        {new Date(a.created_at).toLocaleDateString('pt-PT')} · {a.created_by_name ?? '—'}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleAnnouncement(a)}
                        className="h-8"
                      >
                        {a.active ? 'Desativar' : 'Ativar'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => deleteAnnouncement(a)}
                        className="h-8 border-rose-300 text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* ── Monitorização anti-burla (Fase 5) ── */}
      {tab === 'monitorizacao' && (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <Eye className="h-4 w-4" /> Monitorização anti-burla
              </h2>
              <p className="text-xs text-slate-400">
                2 atividades abertas bloqueiam a conta automaticamente — desbloqueia ou bane aqui.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {['aberta', 'resolvida', 'ignorada'].map((s) => (
                <button
                  key={s}
                  onClick={() => setSuspiciousStatus(s)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    suspiciousStatus === s
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {s}
                </button>
              ))}
              <Button variant="ghost" size="sm" onClick={loadSuspicious}>
                <RefreshCw className={`mr-1.5 h-4 w-4 ${suspiciousLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
          {suspicious.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">
              {suspiciousStatus === 'aberta'
                ? 'Sem atividades suspeitas abertas — a plataforma está tranquila. 🎉'
                : 'Sem atividades neste estado.'}
            </p>
          ) : (
            <ul className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
              {suspicious.map((row) => (
                <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${
                          row.severity === 'alta'
                            ? 'bg-rose-100 text-rose-700'
                            : row.severity === 'media'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {row.severity}
                      </span>
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px]">{row.action}</code>
                      <span className="font-normal text-slate-500">
                        {row.user_name ?? '—'} ({row.user_email ?? `#${row.user_id}`})
                      </span>
                      {row.user_blocked && (
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600">
                          conta bloqueada
                        </span>
                      )}
                    </p>
                    {row.details && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{row.details}</p>}
                    <p className="mt-1 text-[11px] text-slate-400">
                      {new Date(row.created_at).toLocaleString('pt-PT')}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {row.user_blocked && (
                      <Button
                        size="sm"
                        onClick={() => suspiciousAction(row, 'desbloquear')}
                        className="h-8 bg-emerald-500 text-white hover:bg-emerald-600"
                      >
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Desbloquear
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => suspiciousAction(row, 'banir')}
                      className="h-8 border-rose-300 text-rose-600 hover:bg-rose-50"
                    >
                      <Ban className="mr-1 h-3.5 w-3.5" /> Banir
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => suspiciousAction(row, 'ignorar')}
                      className="h-8"
                    >
                      <XCircle className="mr-1 h-3.5 w-3.5" /> Ignorar
                    </Button>
                    {suspiciousStatus !== 'aberta' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => suspiciousAction(row, 'resolver')}
                        className="h-8"
                      >
                        Resolver
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ── Relatórios (Fase 5) ── */}
      {tab === 'relatorios' && (
        <div className="mt-6 space-y-6">
          {reportLoading && !report ? (
            <p className="flex items-center justify-center py-10 text-sm text-slate-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> A gerar relatório…
            </p>
          ) : !report ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">Sem dados de relatório.</p>
          ) : (
            <>
              {/* KPIs gerais */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase text-slate-400">Receita confirmada</p>
                  <p className="mt-1 text-2xl font-bold text-emerald-600">{formatKz(report.totals.revenue)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase text-slate-400">Comissões AngoStart</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{formatKz(report.totals.commission)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase text-slate-400">Novos utilizadores (30d)</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{report.totals.newUsers30d}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase text-slate-400">Produtos ativos</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">
                    {report.products.total}{' '}
                    <span className="text-sm font-semibold text-amber-500">({report.products.hot} em alta)</span>
                  </p>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                {/* Receita mensal */}
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-900">Receita mensal (pagas + entregues)</h3>
                  <div className="mt-4 flex h-44 items-end gap-3">
                    {report.monthly.map((m) => {
                      const max = Math.max(...report.monthly.map((x) => x.revenue), 1);
                      return (
                        <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                          <span className="text-[10px] font-semibold text-slate-500">
                            {m.revenue > 0 ? formatKz(m.revenue).replace(' Kz', '') : '0'}
                          </span>
                          <div
                            className="w-full rounded-t-lg bg-gradient-to-t from-emerald-600 to-emerald-400 transition-all"
                            style={{ height: `${Math.max((m.revenue / max) * 130, 4)}px` }}
                            title={`${m.orders} encomendas — ${formatKz(m.revenue)}`}
                          />
                          <span className="text-[10px] text-slate-400">{m.month.slice(5)}/{m.month.slice(2, 4)}</span>
                        </div>
                      );
                    })}
                  </div>
                  {report.monthly.length === 0 && (
                    <p className="text-center text-xs text-slate-400">Ainda sem vendas confirmadas.</p>
                  )}
                </section>

                {/* Utilizadores por perfil + encomendas por estado */}
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-900">Utilizadores por perfil</h3>
                  <ul className="mt-3 space-y-2">
                    {report.usersByRole.map((r) => (
                      <li key={r.role} className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">{ROLE_LABELS[r.role as Role] ?? r.role}</span>
                        <span className="font-bold text-slate-900">{r.n}</span>
                      </li>
                    ))}
                  </ul>
                  <h3 className="mt-5 text-sm font-bold text-slate-900">Encomendas por estado</h3>
                  <ul className="mt-3 space-y-2">
                    {report.ordersByStatus.length === 0 ? (
                      <li className="text-sm text-slate-400">Sem encomendas registadas.</li>
                    ) : (
                      report.ordersByStatus.map((r) => (
                        <li key={r.status} className="flex items-center justify-between text-sm">
                          <span className="text-slate-600">{r.status}</span>
                          <span className="font-bold text-slate-900">
                            {r.n} <span className="text-xs font-normal text-slate-400">({formatKz(r.volume)})</span>
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                </section>
              </div>
            </>
          )}
        </div>
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
