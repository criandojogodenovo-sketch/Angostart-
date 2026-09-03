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
  BadgeCheck,
  Ban,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Eye,
  FileText,
  Film,
  Gavel,
  Loader2,
  LogOut,
  Mail,
  Megaphone,
  Percent,
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
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import AdminGate from '@/components/AdminGate';
import AdminKycTab from '@/components/AdminKycTab';
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
  /** Fase 15: palavras-chave de busca declaradas pelo vendedor. */
  keywords?: string[] | null;
}

interface CommissionRate {
  scope: string;
  percent: number;
  updated_at: string;
}

interface CommissionOverride {
  user_id: number;
  name: string | null;
  email: string | null;
  percent: number;
  updated_at: string;
}

interface CommissionAuditRow {
  id: number;
  admin_name: string | null;
  scope: string;
  seller_id: number | null;
  seller_name: string | null;
  old_percent: number | null;
  new_percent: number;
  created_at: string;
}

interface CommissionReport {
  por_categoria: { categoria: string; vendas: number; receita: number; comissao: number }[];
  por_mes: { mes: string; comissao: number }[];
  total_comissoes: number;
}

interface CommissionData {
  rates: CommissionRate[];
  overrides: CommissionOverride[];
  audit: CommissionAuditRow[];
  report: CommissionReport;
}

type Tab =
  | 'utilizadores'
  | 'produtos'
  | 'videos'
  | 'encomendas'
  | 'carteira'
  | 'disputas'
  | 'comissoes'
  | 'kyc'
  | 'admins'
  | 'anuncios'
  | 'monitorizacao'
  | 'relatorios'
  | 'seguranca';

interface AdminVideoRow {
  id: string;
  title: string;
  status: string;
  playback_id: string | null;
  error_message: string | null;
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
  user_id: number | null;
  author_name: string | null;
  author_email: string | null;
}

const VIDEO_STATUS_LABELS: Record<string, string> = {
  uploading: 'A finalizar envio',
  processing: 'A processar',
  ready: 'Pronto',
  errored: 'Falhou',
};

const VIDEO_STATUS_STYLES: Record<string, string> = {
  uploading: 'bg-amber-500/15 text-amber-400',
  processing: 'bg-blue-600/15 text-blue-400',
  ready: 'bg-teal-500/15 text-teal-400',
  errored: 'bg-rose-500/15 text-rose-400',
};

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
  /* Fase 6 (ponto 8) */
  usersByMonth?: { month: string; n: number }[];
  topProducts?: { id: number; name: string; units: number; revenue: number }[];
  topSellers?: { id: number; name: string; username: string | null; revenue: number; sales: number }[];
  completion?: { concluidas: number; perdidas: number; total: number; rate: number };
}

interface DisputeRow {
  id: number;
  order_id: number;
  reason: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolution: string | null;
  total_kz: number;
  order_status: string;
  buyer_name: string | null;
  buyer_email: string | null;
  seller_name: string | null;
  resolved_by_name: string | null;
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

/** Filtros por método de pagamento (Fase 8). */
const METHOD_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Todos os métodos' },
  { value: 'kwik', label: 'KWiK' },
  { value: 'paypay', label: 'PayPay' },
  { value: 'multicaixa_express', label: 'Multicaixa Express' },
  { value: 'carteira', label: 'Carteira' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'momenu', label: 'MoMenu' },
];

const TABS: { key: Tab; label: string; icon: typeof Users }[] = [
  { key: 'encomendas', label: 'Comprovativos', icon: FileText },
  { key: 'carteira', label: 'Carteira', icon: Wallet },
  { key: 'disputas', label: 'Disputas', icon: Gavel },
  { key: 'comissoes', label: 'Comissões', icon: Percent },
  { key: 'utilizadores', label: 'Utilizadores', icon: Users },
  { key: 'kyc', label: 'Verificação de Identidade', icon: BadgeCheck },
  { key: 'produtos', label: 'Produtos', icon: Package },
  { key: 'videos', label: 'Vídeos', icon: Film },
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

  /* ── Vídeos (Busbt / Mux) ── */
  const [videos, setVideos] = useState<AdminVideoRow[]>([]);
  const [videosLoading, setVideosLoading] = useState(false);
  const [videoBusyId, setVideoBusyId] = useState<string | null>(null);

  /* ── Encomendas / comprovativos KWiK ── */
  const [orders, setOrders] = useState<KwikAdminOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('aguardando_validacao');
  const [methodFilter, setMethodFilter] = useState('');

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

  /* ── Disputas (Fase 6, ponto 7) ── */
  const [disputes, setDisputes] = useState<DisputeRow[]>([]);
  const [disputesLoading, setDisputesLoading] = useState(false);
  const [disputeBusyId, setDisputeBusyId] = useState<number | null>(null);

  /* ── Comissões (Fase 7) ── */
  const [commissions, setCommissions] = useState<CommissionData | null>(null);
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({});
  const [overrideSellerId, setOverrideSellerId] = useState('');
  const [overridePercent, setOverridePercent] = useState('');
  const [commissionsBusy, setCommissionsBusy] = useState(false);
  const [disputeNote, setDisputeNote] = useState<Record<number, string>>({});

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

  const loadVideos = useCallback(async () => {
    setVideosLoading(true);
    try {
      const res = await fetch('/api/admin/videos', { headers: authHeaders() });
      const data = (await res.json()) as { videos?: AdminVideoRow[]; error?: string };
      if (!res.ok) {
        toast({ title: 'Erro', description: data.error });
        return;
      }
      setVideos(data.videos ?? []);
    } finally {
      setVideosLoading(false);
    }
  }, [toast]);

  /** Força o estado de um vídeo preso (errored = desbloqueia o cartão). */
  async function forceVideoStatus(v: AdminVideoRow, status: string) {
    setVideoBusyId(v.id);
    try {
      const res = await fetch(`/api/admin/videos/${v.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status }),
      });
      const data = (await res.json()) as { status?: string; error?: string };
      if (!res.ok) {
        toast({ title: 'Não foi possível atualizar', description: data.error });
        return;
      }
      toast({ title: 'Vídeo atualizado', description: `«${v.title || v.id}» → ${data.status}` });
      loadVideos();
    } finally {
      setVideoBusyId(null);
    }
  }

  /** Pergunta ao Mux o estado real e atualiza a linha (self-healing). */
  async function refreshVideoAtMux(v: AdminVideoRow) {
    setVideoBusyId(v.id);
    try {
      const res = await fetch(`/api/admin/videos/${v.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ refresh: true }),
      });
      const data = (await res.json()) as { status?: string; error?: string };
      if (!res.ok) {
        toast({ title: 'Não foi possível reverificar', description: data.error });
        return;
      }
      toast({ title: 'Estado verificado no Mux', description: `«${v.title || v.id}» → ${data.status}` });
      loadVideos();
    } finally {
      setVideoBusyId(null);
    }
  }

  /** Apaga o vídeo (linha + asset no Mux, via /api/videos/[id]). */
  async function deleteVideo(v: AdminVideoRow) {
    setVideoBusyId(v.id);
    try {
      const res = await fetch(`/api/videos/${v.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        toast({ title: 'Não foi possível eliminar', description: data.error });
        return;
      }
      toast({ title: 'Vídeo eliminado', description: v.title || v.id });
      loadVideos();
    } finally {
      setVideoBusyId(null);
    }
  }

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const methodQuery = methodFilter ? `&method=${methodFilter}` : '';
      const res = await fetch(
        `/api/admin/orders?status=${statusFilter}${methodQuery}`,
        {
          headers: authHeaders(),
        }
      );
      const data = (await res.json()) as { orders?: KwikAdminOrder[]; error?: string };
      if (!res.ok) {
        toast({ title: 'Erro', description: data.error });
        return;
      }
      setOrders(data.orders ?? []);
    } finally {
      setOrdersLoading(false);
    }
  }, [toast, statusFilter, methodFilter]);

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

  /* ── Disputas (Fase 6, ponto 7) ── */
  const loadDisputes = useCallback(async () => {
    setDisputesLoading(true);
    try {
      const res = await fetch('/api/admin/disputes', { headers: authHeaders() });
      const data = (await res.json()) as { disputes?: DisputeRow[]; error?: string };
      if (!res.ok) {
        toast({ title: 'Erro', description: data.error });
        return;
      }
      setDisputes(data.disputes ?? []);
    } finally {
      setDisputesLoading(false);
    }
  }, [toast]);

  /** Resolve uma disputa: a favor do cliente (reembolso) ou do vendedor (libertação). */
  async function resolveDispute(dispute: DisputeRow, favor: 'cliente' | 'vendedor') {
    if (disputeBusyId !== null) return;
    const confirmMsg =
      favor === 'cliente'
        ? `Reembolsar ${formatKz(dispute.total_kz)} à carteira de ${dispute.buyer_name ?? 'o cliente'}?`
        : `Libertar o escrow ao vendedor ${dispute.seller_name ?? ''}?`;
    if (!window.confirm(confirmMsg)) return;
    setDisputeBusyId(dispute.id);
    try {
      const res = await fetch(`/api/admin/disputes/${dispute.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ favor, note: disputeNote[dispute.id] ?? '' }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível resolver', description: data.error });
        return;
      }
      toast({
        title: 'Disputa resolvida',
        description:
          favor === 'cliente'
            ? 'Reembolso creditado na carteira do cliente.'
            : 'Escrow libertado para o vendedor.',
      });
      loadDisputes();
    } finally {
      setDisputeBusyId(null);
    }
  }


  /* ── Comissões (Fase 7) ── */
  const loadCommissions = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/commissions', { headers: authHeaders() });
      if (!res.ok) throw new Error();
      setCommissions((await res.json()) as CommissionData);
    } catch {
      setCommissions(null);
    }
  }, []);

  async function saveRate(scope: string) {
    if (commissionsBusy) return;
    setCommissionsBusy(true);
    try {
      const res = await fetch('/api/admin/commissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ scope, percent: Number((rateDraft[scope] ?? '').replace(',', '.')) }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível guardar', description: data.error });
        return;
      }
      toast({ title: 'Taxa atualizada ✓', description: `${scope}: nova taxa guardada com auditoria.` });
      loadCommissions();
    } finally {
      setCommissionsBusy(false);
    }
  }

  async function saveOverride(remove = false) {
    if (commissionsBusy) return;
    setCommissionsBusy(true);
    try {
      const res = await fetch('/api/admin/commissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          seller_id: Number(overrideSellerId.replace(/[^\d]/g, '')),
          percent: remove ? null : Number(overridePercent.replace(',', '.')),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({ title: 'Não foi possível guardar o override', description: data.error });
        return;
      }
      toast({
        title: remove ? 'Override removido ✓' : 'Override guardado ✓',
        description: remove ? 'O vendedor volta à taxa geral.' : `Taxa individual aplicada.`,
      });
      setOverrideSellerId('');
      setOverridePercent('');
      loadCommissions();
    } finally {
      setCommissionsBusy(false);
    }
  }

  useEffect(() => {
    if (tab === 'encomendas') loadOrders();
  }, [tab, loadOrders]);

  useEffect(() => {
    if (tab === 'utilizadores') loadUsers();
    if (tab === 'produtos') loadProducts();
    if (tab === 'videos') loadVideos();
    if (tab === 'admins') loadAdminSecurityData();
    if (tab === 'carteira') loadWalletOps();
    if (tab === 'anuncios') loadAnnouncements();
    if (tab === 'monitorizacao') loadSuspicious();
    if (tab === 'relatorios') loadReport();
    if (tab === 'disputas') loadDisputes();
    if (tab === 'comissoes') loadCommissions();
  }, [tab, loadUsers, loadProducts, loadAdminSecurityData, loadWalletOps, loadAnnouncements, loadSuspicious, loadReport, loadDisputes, loadCommissions]);

  /* Fase 9: a fila de KYC carrega dentro de AdminKycTab (auto-contida). */

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
    <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Fase 16 — fundo Dark Premium fixo atrás de todo o painel */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-[#0B1120]" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-100">
            <ShieldCheck className="h-7 w-7 text-teal-500" /> Administração Total
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Rota oculta <code className="rounded bg-slate-700/40 px-1.5 py-0.5">/admin</code> — não
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
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800/60 text-slate-300 shadow-sm hover:bg-slate-700/60'
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
            {key === 'encomendas' && orders.length > 0 && (
              <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-bold text-slate-950">
                {orders.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* ── Comprovativos (KWiK / PayPay / Multicaixa Express / …) ── */}
      {tab === 'encomendas' && (
        <>
          <nav aria-label="Filtrar encomendas por estado" className="mt-6 flex flex-wrap gap-2">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                onClick={() => setStatusFilter(filter.value)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  statusFilter === filter.value
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-800/60 text-slate-300 shadow-sm hover:bg-slate-700/60'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </nav>
          <nav
            aria-label="Filtrar encomendas por método de pagamento"
            className="mt-2 flex flex-wrap gap-2"
          >
            {METHOD_FILTERS.map((filter) => (
              <button
                key={filter.value || 'todos'}
                onClick={() => setMethodFilter(filter.value)}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
                  methodFilter === filter.value
                    ? 'border-blue-500 bg-blue-600/10 text-blue-300'
                    : 'border-white/10 bg-slate-800/60 backdrop-blur-xl text-slate-400 hover:bg-slate-700/40'
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
                ? 'Sem comprovativos à espera de validação. Bom trabalho!'
                : 'Sem encomendas neste estado.'
            }
            onReload={loadOrders}
            onReview={reviewOrder}
          />
        </>
      )}

      {/* ── Carteira: depósitos e saques ── */}
      {tab === 'carteira' && (
        <section className="mt-6 rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
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
                    <p className="text-sm font-semibold text-slate-100">
                      <span
                        className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${
                          op.tipo === 'deposito'
                            ? 'bg-sky-500/20 text-sky-300'
                            : 'bg-violet-500/20 text-violet-300'
                        }`}
                      >
                        {op.tipo === 'deposito' ? 'Depósito' : 'Saque'}
                      </span>
                      {op.referencia ?? `#${op.id}`}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {op.user_name ?? '—'} ({op.user_email ?? '—'})
                      {op.user_telefone ? ` · ${op.user_telefone}` : ''}
                    </p>
                    <p className="text-xs text-slate-400">
                      {new Date(op.created_at).toLocaleString('pt-PT')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-blue-600">{formatKz(op.valor)}</span>
                    {op.tipo === 'deposito' ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => decideWalletOp(op, true)}
                          disabled={walletBusyId === op.id}
                          className="h-9 bg-blue-600 text-white hover:bg-blue-700"
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
                          className="h-9 border-rose-500/40 text-rose-600 hover:bg-rose-500/10"
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
                          className="h-9 bg-blue-600 text-white hover:bg-blue-700"
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
                          className="h-9 border-rose-500/40 text-rose-600 hover:bg-rose-500/10"
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
        <section className="mt-6 rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-100">Utilizadores ({users.length})</h2>
            <Button variant="ghost" size="sm" onClick={loadUsers}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${usersLoading ? 'animate-spin' : ''}`} /> Atualizar
            </Button>
          </div>
          <ul className="divide-y divide-slate-100">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-100">
                    {u.name}{' '}
                    <span className="font-normal text-slate-400">({u.email})</span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-2 text-xs text-slate-400">
                    <span className="rounded-full bg-slate-700/40 px-2 py-0.5 font-semibold text-slate-300">
                      {ROLE_LABELS[u.role as Role] ?? u.role}
                    </span>
                    {u.two_factor_enabled && (
                      <span className="rounded-full bg-blue-600/10 px-2 py-0.5 font-semibold text-blue-600">
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
                      ? 'border-blue-500/40 text-blue-600 hover:bg-blue-600/10'
                      : 'border-rose-500/40 text-rose-600 hover:bg-rose-500/10'
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
        <section className="mt-6 rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-100">Produtos ({products.length})</h2>
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
                    <p className="text-sm font-semibold text-slate-100">
                      #{p.id} — {p.name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {p.type} · vendedor: {p.seller_name ?? '—'}
                    </p>
                    {p.keywords && p.keywords.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          Keywords:
                        </span>
                        {p.keywords.map((k) => (
                          <span
                            key={k}
                            className="rounded-full bg-slate-700/40 px-2 py-0.5 text-[11px] font-medium text-slate-300"
                          >
                            {k}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-blue-600">{formatKz(p.price_kz)}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deleteProduct(p)}
                      className="h-9 border-rose-500/40 text-rose-600 hover:bg-rose-500/10"
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

      {/* ── Vídeos (Busbt / Mux) — limpar presos, forçar estado ── */}
      {tab === 'videos' && (
        <section className="mt-6 rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-100">Vídeos — Busbt ({videos.length})</h2>
            <Button variant="ghost" size="sm" onClick={loadVideos}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${videosLoading ? 'animate-spin' : ''}`} /> Atualizar
            </Button>
          </div>
          {videos.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">Sem vídeos publicados.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {videos.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-100">
                      {v.title || '(sem título)'}
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-2 text-xs text-slate-400">
                      <span
                        className={`rounded-full px-2 py-0.5 font-semibold ${
                          VIDEO_STATUS_STYLES[v.status] ?? 'bg-slate-700/40 text-slate-300'
                        }`}
                      >
                        {VIDEO_STATUS_LABELS[v.status] ?? v.status}
                      </span>
                      <span>{v.author_name ?? '—'} ({v.author_email ?? 'sem email'})</span>
                      <span>{new Date(v.created_at).toLocaleString('pt-PT')}</span>
                      {v.error_message && (
                        <span className="text-rose-400">{v.error_message}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {(v.status === 'uploading' || v.status === 'processing') && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={videoBusyId === v.id}
                        onClick={() => refreshVideoAtMux(v)}
                        className="h-9 border-blue-500/40 text-blue-400 hover:bg-blue-600/10"
                      >
                        {videoBusyId === v.id ? (
                          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-1 h-4 w-4" />
                        )}
                        Reverificar
                      </Button>
                    )}
                    {v.status !== 'errored' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={videoBusyId === v.id}
                        onClick={() => forceVideoStatus(v, 'errored')}
                        className="h-9 border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                      >
                        <XCircle className="mr-1 h-4 w-4" /> Marcar falhou
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={videoBusyId === v.id}
                      onClick={() => deleteVideo(v)}
                      className="h-9 border-rose-500/40 text-rose-600 hover:bg-rose-500/10"
                    >
                      <Trash2 className="mr-1 h-4 w-4" /> Apagar
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
          <section className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
              <UserPlus className="h-4 w-4" /> Convidar Admin Limitado
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Sem palavra-passe fixa: a conta é criada em <code className="rounded bg-slate-700/40 px-1">/admin-limitado</code> com
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
                className="h-11 w-full bg-blue-600 font-semibold text-white hover:bg-blue-700"
              >
                {inviting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Send className="mr-2 h-4 w-4" /> Enviar convite por email
              </Button>
            </form>
          </section>

          {/* Estado */}
          <section className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-100">Estado da equipa de validação</h2>
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
                            <p className="truncate text-sm font-semibold text-slate-100">{a.name}</p>
                            <p className="truncate text-xs text-slate-400">{a.email}</p>
                            <p className="mt-0.5 flex gap-1.5 text-[11px]">
                              <span className={`rounded-full px-2 py-0.5 font-semibold ${a.two_factor_enabled ? 'bg-blue-600/10 text-blue-600' : 'bg-amber-500/10 text-amber-600'}`}>
                                {a.two_factor_enabled ? '2FA ativa' : '2FA pendente'}
                              </span>
                              {a.blocked && <span className="rounded-full bg-rose-500/10 px-2 py-0.5 font-semibold text-rose-600">bloqueado</span>}
                              {a.whatsapp_contact && (
                                <span className="rounded-full bg-sky-500/10 px-2 py-0.5 font-semibold text-sky-600">
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
                              className="h-8 border-blue-500/40 text-blue-600 hover:bg-blue-600/10"
                            >
                              {busyAdminId === a.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Mail className="mr-1 h-3.5 w-3.5" />}
                              Código diário
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => removeLimitedAdmin(a)}
                              className="h-8 border-rose-500/40 text-rose-600 hover:bg-rose-500/10"
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
                            className="h-8 shrink-0 border-sky-500/40 text-sky-600 hover:bg-sky-500/10"
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
                          ? 'bg-blue-600/10 text-blue-600'
                          : state === 'pendente'
                            ? 'bg-amber-500/10 text-amber-600'
                            : 'bg-slate-700/40 text-slate-400';
                      return (
                        <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-100">{i.email}</p>
                            <p className="text-xs text-slate-400">
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
                                className="h-8 border-rose-500/40 text-rose-600 hover:bg-rose-500/10"
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
                          <p className="truncate text-sm text-slate-200">{c.admin_email}</p>
                          <p className="text-xs text-slate-400">dia {c.date}</p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.used_at ? 'bg-slate-700/40 text-slate-400' : 'bg-blue-600/10 text-blue-600'}`}>
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
          <section className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
              <Megaphone className="h-4 w-4" /> Criar anúncio
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
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
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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
                className="h-11 w-full bg-blue-600 font-semibold text-white hover:bg-blue-700"
              >
                {annCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Send className="mr-2 h-4 w-4" /> Publicar anúncio
              </Button>
            </form>
          </section>

          {/* Lista de anúncios */}
          <section className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-100">
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
                      <p className="text-sm font-semibold text-slate-100">
                        {a.title}{' '}
                        <span
                          className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${
                            a.type === 'exclusivo'
                              ? 'bg-slate-800 text-white'
                              : a.type === 'promo'
                                ? 'bg-amber-500/20 text-amber-300'
                                : a.type === 'destaque'
                                  ? 'bg-blue-600/20 text-blue-300'
                                  : 'bg-sky-500/20 text-sky-300'
                          }`}
                        >
                          {a.type}
                        </span>
                        {!a.active && (
                          <span className="ml-1 rounded-full bg-slate-700/40 px-2 py-0.5 text-[11px] font-semibold text-slate-400">
                            inativo
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{a.content}</p>
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
                        className="h-8 border-rose-500/40 text-rose-600 hover:bg-rose-500/10"
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
        <section className="mt-6 rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/50 px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
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
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700/40 text-slate-300 hover:bg-slate-600'
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
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-100">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${
                          row.severity === 'alta'
                            ? 'bg-rose-500/20 text-rose-300'
                            : row.severity === 'media'
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-slate-700/40 text-slate-300'
                        }`}
                      >
                        {row.severity}
                      </span>
                      <code className="rounded bg-slate-700/40 px-1.5 py-0.5 text-[12px]">{row.action}</code>
                      <span className="font-normal text-slate-400">
                        {row.user_name ?? '—'} ({row.user_email ?? `#${row.user_id}`})
                      </span>
                      {row.user_blocked && (
                        <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-600">
                          conta bloqueada
                        </span>
                      )}
                    </p>
                    {row.details && <p className="mt-1 line-clamp-2 text-xs text-slate-400">{row.details}</p>}
                    <p className="mt-1 text-[11px] text-slate-400">
                      {new Date(row.created_at).toLocaleString('pt-PT')}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {row.user_blocked && (
                      <Button
                        size="sm"
                        onClick={() => suspiciousAction(row, 'desbloquear')}
                        className="h-8 bg-blue-600 text-white hover:bg-blue-700"
                      >
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Desbloquear
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => suspiciousAction(row, 'banir')}
                      className="h-8 border-rose-500/40 text-rose-600 hover:bg-rose-500/10"
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

      {/* ── Disputas (Fase 6, ponto 7) ── */}
      {/* Fase 9 — Verificação de Identidade (BI dos vendedores) */}
      {tab === 'kyc' && <AdminKycTab />}

      {tab === 'disputas' && (
        <section className="mt-6" aria-label="Gestão de disputas">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-100">
              <Gavel className="h-5 w-5 text-blue-600" /> Disputas
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={loadDisputes}
              className="h-9 border-slate-600 text-slate-300 hover:bg-slate-700/40"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Atualizar
            </Button>
          </div>

          {disputesLoading && disputes.length === 0 ? (
            <p className="flex items-center justify-center py-10 text-sm text-slate-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> A carregar disputas…
            </p>
          ) : disputes.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-slate-600 bg-slate-800/60 p-10 text-center text-sm text-slate-400">
              Sem disputas registadas — bom sinal! 🎉
            </p>
          ) : (
            <ul className="mt-4 space-y-4">
              {disputes.map((d) => {
                const aberta = d.status === 'aberta';
                return (
                  <li
                    key={d.id}
                    className={`rounded-2xl border bg-slate-800/60 p-5 shadow-sm ${
                      aberta ? 'border-amber-500/40' : 'border-white/10 opacity-90'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-slate-100">
                          Disputa #{d.id} — Encomenda #{d.order_id}{' '}
                          <span className="ml-1 font-normal text-slate-400">
                            ({formatKz(d.total_kz)} · encomenda {d.order_status})
                          </span>
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          Cliente: <strong>{d.buyer_name ?? '—'}</strong> · Vendedor:{' '}
                          <strong>{d.seller_name ?? '—'}</strong> ·{' '}
                          {new Date(d.created_at).toLocaleString('pt-PT')}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                          aberta
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-blue-600/20 text-blue-300'
                        }`}
                      >
                        {d.status === 'aberta'
                          ? 'ABERTA'
                          : d.status === 'resolvida_cliente'
                            ? 'RESOLVIDA — CLIENTE'
                            : d.status === 'resolvida_vendedor'
                              ? 'RESOLVIDA — VENDEDOR'
                              : d.status.toUpperCase()}
                      </span>
                    </div>

                    <p className="mt-3 whitespace-pre-line rounded-xl bg-slate-900/40 p-3 text-sm text-slate-200">
                      {d.reason}
                    </p>

                    {!aberta && (
                      <p className="mt-2 text-xs text-slate-400">
                        Resolvida por {d.resolved_by_name ?? 'equipa'}
                        {d.resolution ? ` — «${d.resolution}»` : ''}
                      </p>
                    )}

                    {aberta && (
                      <div className="mt-3 space-y-2">
                        <Input
                          value={disputeNote[d.id] ?? ''}
                          onChange={(e) =>
                            setDisputeNote((prev) => ({ ...prev, [d.id]: e.target.value }))
                          }
                          placeholder="Nota da decisão (visível às partes no email — opcional)"
                          maxLength={500}
                          className="h-10"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            onClick={() => resolveDispute(d, 'cliente')}
                            disabled={disputeBusyId === d.id}
                            className="h-10 bg-rose-500 text-white hover:bg-rose-600"
                          >
                            {disputeBusyId === d.id ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <XCircle className="mr-2 h-4 w-4" />
                            )}
                            A favor do cliente (reembolsar {formatKz(d.total_kz)})
                          </Button>
                          <Button
                            onClick={() => resolveDispute(d, 'vendedor')}
                            disabled={disputeBusyId === d.id}
                            className="h-10 bg-blue-600 text-white hover:bg-blue-700"
                          >
                            {disputeBusyId === d.id ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="mr-2 h-4 w-4" />
                            )}
                            A favor do vendedor (libertar escrow)
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
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
              {/* KPIs gerais — contagem animada + entrada em cascata (Fase 18) */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FadeIn delay={0}>
                <div className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase text-slate-400">Receita confirmada</p>
                  <p className="mt-1 text-2xl font-bold text-blue-600">
                    <AnimatedStat value={report.totals.revenue} format={formatKz} />
                  </p>
                </div>
                </FadeIn>
                <FadeIn delay={0.06}>
                <div className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase text-slate-400">Comissões AngoStart</p>
                  <p className="mt-1 text-2xl font-bold text-slate-100">
                    <AnimatedStat value={report.totals.commission} format={formatKz} />
                  </p>
                </div>
                </FadeIn>
                <FadeIn delay={0.12}>
                <div className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase text-slate-400">Novos utilizadores (30d)</p>
                  <p className="mt-1 text-2xl font-bold text-slate-100">
                    <AnimatedStat value={report.totals.newUsers30d} />
                  </p>
                </div>
                </FadeIn>
                <FadeIn delay={0.18}>
                <div className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase text-slate-400">Produtos ativos</p>
                  <p className="mt-1 text-2xl font-bold text-slate-100">
                    <AnimatedStat value={report.products.total} />{' '}
                    <span className="text-sm font-semibold text-amber-500">({report.products.hot} em alta)</span>
                  </p>
                </div>
                </FadeIn>
                {report.completion && (
                  <div className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase text-slate-400">Taxa de conclusão</p>
                    <p className="mt-1 text-2xl font-bold text-blue-600">{report.completion.rate}%</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {report.completion.concluidas} concluídas · {report.completion.perdidas} perdidas ·{' '}
                      {report.completion.total} total
                    </p>
                  </div>
                )}
              </div>

              {/* ── Fase 6 (ponto 8): gráficos Recharts ── */}
              <div className="grid gap-6 lg:grid-cols-2">
                <section className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-100">Receita mensal (Recharts)</h3>
                  <div className="mt-4 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={report.monthly.map((m) => ({ ...m, label: `${m.month.slice(5)}/${m.month.slice(2, 4)}` }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                        <Tooltip
                          formatter={(value: number | string) => formatKz(Number(value))}
                          contentStyle={{ borderRadius: 12, fontSize: 12, backgroundColor: "#1e293b", border: "1px solid #334155", color: "#e2e8f0" }}
                        />
                        <Bar dataKey="revenue" fill="#3b82f6" radius={[6, 6, 0, 0]} name="Receita (Kz)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                <section className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-100">Utilizadores registados por mês</h3>
                  <div className="mt-4 h-56">
                    {(report.usersByMonth?.length ?? 0) > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={report.usersByMonth!.map((m) => ({ ...m, label: `${m.month.slice(5)}/${m.month.slice(2, 4)}` }))}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                          <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12, backgroundColor: "#1e293b", border: "1px solid #334155", color: "#e2e8f0" }} />
                          <Line type="monotone" dataKey="n" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3, fill: '#8b5cf6' }} name="Registos" />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="flex h-full items-center justify-center text-sm text-slate-400">
                        Ainda sem registos nos últimos 12 meses.
                      </p>
                    )}
                  </div>
                </section>
              </div>

              {/* Top produtos e top vendedores */}
              <div className="grid gap-6 lg:grid-cols-2">
                <section className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-100">Top 5 produtos mais vendidos</h3>
                  {(report.topProducts?.length ?? 0) === 0 ? (
                    <p className="mt-3 text-sm text-slate-400">Ainda sem vendas confirmadas.</p>
                  ) : (
                    <ol className="mt-3 space-y-2">
                      {report.topProducts!.map((p, i) => (
                        <li key={p.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-900/40 px-3 py-2 text-sm">
                          <span className="min-w-0 truncate text-slate-200">
                            <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                              {i + 1}
                            </span>
                            {p.name}
                          </span>
                          <span className="shrink-0 text-right text-xs">
                            <strong className="text-slate-100">{formatKz(p.revenue)}</strong>
                            <span className="block text-slate-400">{p.units} un.</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>

                <section className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-100">Top 5 vendedores por receita</h3>
                  {(report.topSellers?.length ?? 0) === 0 ? (
                    <p className="mt-3 text-sm text-slate-400">Ainda sem vendas confirmadas.</p>
                  ) : (
                    <ol className="mt-3 space-y-2">
                      {report.topSellers!.map((s, i) => (
                        <li key={s.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-900/40 px-3 py-2 text-sm">
                          <span className="min-w-0 truncate text-slate-200">
                            <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                              {i + 1}
                            </span>
                            {s.name}
                            {s.username && <span className="ml-1 text-xs text-slate-400">@{s.username}</span>}
                          </span>
                          <span className="shrink-0 text-right text-xs">
                            <strong className="text-slate-100">{formatKz(s.revenue)}</strong>
                            <span className="block text-slate-400">{s.sales} vendas</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                {/* Receita mensal */}
                <section className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-100">Receita mensal (pagas + entregues)</h3>
                  <div className="mt-4 flex h-44 items-end gap-3">
                    {report.monthly.map((m) => {
                      const max = Math.max(...report.monthly.map((x) => x.revenue), 1);
                      return (
                        <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                          <span className="text-[10px] font-semibold text-slate-400">
                            {m.revenue > 0 ? formatKz(m.revenue).replace(' Kz', '') : '0'}
                          </span>
                          <div
                            className="w-full rounded-t-lg bg-gradient-to-t from-blue-600 to-blue-400 transition-all"
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
                <section className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-100">Utilizadores por perfil</h3>
                  <ul className="mt-3 space-y-2">
                    {report.usersByRole.map((r) => (
                      <li key={r.role} className="flex items-center justify-between text-sm">
                        <span className="text-slate-300">{ROLE_LABELS[r.role as Role] ?? r.role}</span>
                        <span className="font-bold text-slate-100">{r.n}</span>
                      </li>
                    ))}
                  </ul>
                  <h3 className="mt-5 text-sm font-bold text-slate-100">Encomendas por estado</h3>
                  <ul className="mt-3 space-y-2">
                    {report.ordersByStatus.length === 0 ? (
                      <li className="text-sm text-slate-400">Sem encomendas registadas.</li>
                    ) : (
                      report.ordersByStatus.map((r) => (
                        <li key={r.status} className="flex items-center justify-between text-sm">
                          <span className="text-slate-300">{r.status}</span>
                          <span className="font-bold text-slate-100">
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

      {/* ── Comissões (Fase 7) ── */}
      {tab === 'comissoes' && (
        <div className="mt-6 space-y-6">
          {/* Taxas por tipo */}
          <section className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-100">Taxas por tipo de venda</h2>
            <p className="mt-1 text-xs text-slate-400">
              Aplicadas no escrow quando o pedido é pago (máx. 50%). Toda a alteração fica
              registada na auditoria.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {(commissions?.rates ?? []).map((r) => {
                const label =
                  r.scope === 'produto'
                    ? 'Produtos físicos / infoprodutos'
                    : r.scope === 'servico_domicilio'
                      ? 'Serviços ao domicílio'
                      : 'Freelancers (remoto)';
                return (
                  <div key={r.scope} className="rounded-xl border border-white/10 p-4">
                    <p className="text-xs font-semibold text-slate-400">{label}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        value={rateDraft[r.scope] ?? String(r.percent)}
                        onChange={(e) =>
                          setRateDraft((d) => ({ ...d, [r.scope]: e.target.value }))
                        }
                        inputMode="decimal"
                        className="h-9 w-24"
                      />
                      <span className="text-sm font-semibold text-slate-300">%</span>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => saveRate(r.scope)}
                        disabled={commissionsBusy}
                        className="ml-auto h-9"
                      >
                        Guardar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Overrides por vendedor */}
          <section className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-100">Taxa individual (override)</h2>
            <p className="mt-1 text-xs text-slate-400">
              Define uma taxa especial para um vendedor pelo ID do utilizador. Vazio + Guardar
              remove o override.
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="ov-seller">ID do vendedor</Label>
                <Input
                  id="ov-seller"
                  value={overrideSellerId}
                  onChange={(e) => setOverrideSellerId(e.target.value.replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                  className="mt-1 h-9 w-36"
                  placeholder="ex.: 42"
                />
              </div>
              <div>
                <Label htmlFor="ov-percent">Taxa (%)</Label>
                <Input
                  id="ov-percent"
                  value={overridePercent}
                  onChange={(e) => setOverridePercent(e.target.value)}
                  inputMode="decimal"
                  className="mt-1 h-9 w-28"
                  placeholder="ex.: 4"
                />
              </div>
              <Button
                type="button"
                onClick={() => saveOverride(false)}
                disabled={commissionsBusy || overrideSellerId.length === 0 || overridePercent.length === 0}
                className="h-9"
              >
                Aplicar override
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => saveOverride(true)}
                disabled={commissionsBusy || overrideSellerId.length === 0}
                className="h-9"
              >
                Remover
              </Button>
            </div>
            {(commissions?.overrides.length ?? 0) > 0 && (
              <ul className="mt-4 divide-y divide-slate-100 text-sm">
                {commissions!.overrides.map((o) => (
                  <li key={o.user_id} className="flex items-center justify-between py-2">
                    <span className="text-slate-200">
                      #{o.user_id} — {o.name ?? o.email ?? 'Vendedor'}
                    </span>
                    <span className="font-semibold text-blue-300">{o.percent}%</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Relatório de comissões */}
          <section className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-100">
              Receita de comissões — total {formatKz(commissions?.report.total_comissoes ?? 0)}
            </h2>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Por categoria
                </h3>
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400">
                      <th className="py-1">Categoria</th>
                      <th className="py-1">Vendas</th>
                      <th className="py-1">Receita líquida</th>
                      <th className="py-1">Comissões</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(commissions?.report.por_categoria ?? []).map((cat) => (
                      <tr key={cat.categoria} className="border-t border-slate-700/50">
                        <td className="py-1.5 font-medium text-slate-200">{cat.categoria}</td>
                        <td className="py-1.5">{cat.vendas}</td>
                        <td className="py-1.5">{formatKz(cat.receita)}</td>
                        <td className="py-1.5 font-semibold text-blue-300">
                          {formatKz(cat.comissao)}
                        </td>
                      </tr>
                    ))}
                    {(commissions?.report.por_categoria.length ?? 0) === 0 && (
                      <tr>
                        <td colSpan={4} className="py-3 text-xs text-slate-400">
                          Ainda sem comissões registadas.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Comissões por mês (12m)
                </h3>
                <div className="mt-2 h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={(commissions?.report.por_mes ?? []).map((m) => ({ mes: m.mes.slice(5), comissao: m.comissao }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} width={54} />
                      <Tooltip formatter={(v) => formatKz(Number(v))} />
                      <Bar dataKey="comissao" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </section>

          {/* Auditoria */}
          <section className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-100">Auditoria de alterações</h2>
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {(commissions?.audit ?? []).map((a) => (
                <li key={a.id} className="py-2 text-slate-300">
                  <span className="font-medium text-slate-200">{a.admin_name ?? 'Admin'}</span>{' '}
                  alterou <span className="font-medium">{a.scope}</span>
                  {a.seller_name ? ` (vendedor ${a.seller_name})` : ''}:{' '}
                  {a.old_percent === null ? '—' : `${a.old_percent}%`} →{' '}
                  <span className={a.new_percent < 0 ? 'text-rose-600' : 'font-semibold text-blue-300'}>
                    {a.new_percent < 0 ? 'removido' : `${a.new_percent}%`}
                  </span>{' '}
                  <span className="text-xs text-slate-400">
                    · {new Date(a.created_at).toLocaleString('pt-PT')}
                  </span>
                </li>
              ))}
              {(commissions?.audit.length ?? 0) === 0 && (
                <li className="py-3 text-xs text-slate-400">Sem alterações registadas.</li>
              )}
            </ul>
          </section>
        </div>
      )}

      {/* ── Segurança 2FA ── */}
      {tab === 'seguranca' && (
        <section className="mt-6 max-w-xl rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-100">Ativar / reconfigurar 2FA (TOTP)</h2>
          <p className="mt-1 text-xs text-slate-400">
            1. Clica em gerar → 2. abre a app autenticadora (Google Authenticator, Aegis, Authy…) →
            3. lê o QR → 4. valida o código de 6 dígitos no ecrã de entrada do painel.
          </p>
          <Button onClick={setup2FA} disabled={generating} className="mt-4 h-11 bg-blue-600 font-semibold text-white hover:bg-blue-700">
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            Gerar QR Code do 2FA
          </Button>
          {qr && (
            <div className="mt-4 rounded-xl border border-white/10 p-4 text-center">
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
import { AnimatedStat, FadeIn } from '@/components/motion';
