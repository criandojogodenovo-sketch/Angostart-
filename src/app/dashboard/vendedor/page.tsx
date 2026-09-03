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
import { AnimatedBar, AnimatedStat, FadeIn } from '@/components/motion';
import {
  ArrowLeft,
  Award,
  BadgeCheck,
  Bike,
  Clock,
  ClipboardList,
  Copy,
  Crosshair,
  ExternalLink,
  Flame,
  Info,
  Link2,
  Loader2,
  Lock,
  MapPin,
  Medal,
  Megaphone,
  MessageCircle,
  Navigation,
  Package,
  Pencil,
  PiggyBank,
  Receipt,
  Share2,
  ShieldAlert,
  Star,
  TrendingUp,
  Users,
  Wallet,
  XCircle,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BackToTop from '@/components/BackToTop';
import { useAuth } from '@/context/AuthContext';
import { authHeaders, getToken, type AuthUser } from '@/context/AuthContext';
import { formatKz } from '@/lib/format';
import { useToast } from '@/hooks/use-toast';
import ServiceMap from '@/components/ServiceMap';
import StoreEditorCard from '@/components/StoreEditorCard';
import BusinessProfileCard from '@/components/BusinessProfileCard';
import KycVerificationCard from '@/components/KycVerificationCard';

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
  /** Fase 16: palavras-chave (Fase 15) — para chips + edição no painel. */
  keywords?: string[] | null;
}

interface AffiliateData {
  codigo_afiliado: string;
  comissao_percentual: number;
  total_ganho: number;
  referral_link: string;
  /** Fase 11: link de afiliado da loja do vendedor (null sem loja). */
  store_link?: string | null;
  /** Fase 10: janela de atribuição (dias) comunicada pelo servidor. */
  atribuicao_dias: number;
  /** Fase 9: progresso do escalão (50 comissões → 15 %). */
  escalao: {
    comissoes_recebidas: number;
    proximo_escalao_em: number;
    percentual_escalao_seguinte: number;
    no_escalao_maximo: boolean;
  };
  /** Fase 10: relatório de comissões por canal (Sub-ID/campanha). */
  sub_id_report: { sub_id: string | null; comissoes: number; total: number }[];
  earnings: {
    id: number;
    order_id: number;
    comissao: number;
    status: string;
    sub_id: string | null;
    created_at: string;
  }[];
}

/** Estado de elegibilidade devolvido pela API quando ainda não é afiliado. */
interface AffiliateEligibilityState {
  eligible: boolean;
  role: string;
  count: number;
  required: number;
  message: string;
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

const PIE_COLORS = ['#3b82f6', '#8b5cf6', '#14b8a6', '#f59e0b', '#64748b'];

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  pendente: { label: 'Pendente', className: 'bg-amber-500/20 text-amber-400' },
  pago: { label: 'Pago', className: 'bg-blue-600/20 text-blue-300' },
  entregue: { label: 'Entregue', className: 'bg-blue-600/20 text-blue-300' },
  rejeitado: { label: 'Rejeitado', className: 'bg-rose-500/20 text-rose-400' },
  falhou: { label: 'Falhou', className: 'bg-rose-500/20 text-rose-400' },
};

export default function DashboardVendedorPage() {
  const { user, loading: authLoading, isSeller, applySession } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const { toast } = useToast();

  /* ── Fase 4: produtos (hot), afiliados e carteira ── */
  const [meusProdutos, setMeusProdutos] = useState<MeuProduto[]>([]);
  const [affiliate, setAffiliate] = useState<AffiliateData | null>(null);
  const [affiliateElegibilidade, setAffiliateElegibilidade] = useState<AffiliateEligibilityState | null>(null);
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

    // Afiliado (404 = ainda não aderiu — a resposta traz a elegibilidade)
    fetch('/api/affiliate', { headers: authHeaders() })
      .then((res) =>
        res.ok ? res.json() : res.json().catch(() => null)
      )
      .then((payload: unknown) => {
        const data = payload as (AffiliateData & { eligibility?: AffiliateEligibilityState }) | null;
        if (data?.codigo_afiliado) {
          setAffiliate(data);
          setAffiliateElegibilidade(null);
        } else {
          setAffiliate(null);
          setAffiliateElegibilidade(
            (payload as { eligibility?: AffiliateEligibilityState } | null)?.eligibility ?? null
          );
        }
      })
      .catch(() => {
        setAffiliate(null);
        setAffiliateElegibilidade(null);
      })
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
      setAffiliateElegibilidade(null);
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
    copiarTexto(affiliate.codigo_afiliado, 'Código copiado', affiliate.codigo_afiliado);
  }

  /* ── Fase 10 — ferramentas de afiliado (campanha, batch, relatório) ── */
  const [subCampanha, setSubCampanha] = useState('');
  const [batchInput, setBatchInput] = useState('');
  const [batchLinks, setBatchLinks] = useState<{ input: string; link: string }[]>([]);
  const [batchAviso, setBatchAviso] = useState<string | null>(null);

  /** Sub-ID validado (≤30 chars, letras/números/-/_ — igual ao servidor). */
  function subNormalizado(): string | null {
    const s = subCampanha.trim().toLowerCase();
    return /^[a-z0-9_-]{1,30}$/.test(s) ? s : null;
  }

  /** Copia texto com confirmação visual (toast). */
  function copiarTexto(texto: string, titulo: string, descricao?: string) {
    navigator.clipboard
      ?.writeText(texto)
      .then(() => toast({ title: titulo, description: descricao }))
      .catch(() =>
        toast({ title: 'Não foi possível copiar', description: texto, variant: 'destructive' })
      );
  }

  /** Link limpo do afiliado para um URL (acrescenta ?ref=CODE&sub=…). */
  function buildAffiliateLink(url: string, sub: string | null): string {
    if (!affiliate) return url;
    try {
      const u = new URL(url, window.location.origin);
      u.searchParams.set('ref', affiliate.codigo_afiliado);
      if (sub) u.searchParams.set('sub', sub);
      else u.searchParams.delete('sub');
      return u.toString();
    } catch {
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}ref=${affiliate.codigo_afiliado}${sub ? `&sub=${sub}` : ''}`;
    }
  }

  /** Link do início da plataforma com a campanha atual (Sub-ID). */
  function linkComCampanha(): string {
    if (!affiliate) return '';
    const sub = subNormalizado();
    return sub ? `${affiliate.referral_link}&sub=${sub}` : affiliate.referral_link;
  }

  /** Gera links de afiliado para vários URLs/IDs de produtos de uma vez. */
  function gerarLinksEmMassa() {
    if (!affiliate) return;
    const linhas = batchInput
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (linhas.length === 0) {
      setBatchAviso('Cola pelo menos um link (ou ID) de produto.');
      setBatchLinks([]);
      return;
    }
    const sub = subNormalizado();
    const out: { input: string; link: string }[] = [];
    let ignoradas = 0;
    for (const linha of linhas.slice(0, 30)) {
      const idMatch = linha.match(/produtos\/(\d+)/) ?? (/^\d+$/.test(linha) ? ['', linha] : null);
      if (idMatch?.[1]) {
        out.push({
          input: linha,
          link: buildAffiliateLink(`${window.location.origin}/produtos/${idMatch[1]}`, sub),
        });
      } else if (/^https?:\/\//.test(linha)) {
        out.push({ input: linha, link: buildAffiliateLink(linha, sub) });
      } else {
        ignoradas += 1;
      }
    }
    setBatchLinks(out);
    setBatchAviso(
      ignoradas > 0
        ? `${ignoradas} linha(s) ignorada(s) — usa links de produto (…/produtos/123) ou o número do produto.`
        : out.length > 0
          ? `${out.length} link(s) gerado(s).`
          : null
    );
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
      <div className="relative flex items-center justify-center py-32 text-slate-400">
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-[#0B1120]" />
        <Loader2 className="mr-3 h-5 w-5 animate-spin text-blue-400" />
        <span className="text-sm">A carregar o teu painel…</span>
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="relative mx-auto max-w-lg px-4 py-24 text-center sm:px-6">
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-[#0B1120]" />
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/15">
          <Lock className="h-8 w-8 text-rose-500" />
        </span>
        <h1 className="mt-5 text-2xl font-bold text-slate-100">Acesso restrito</h1>
        <p className="mt-2 text-sm text-slate-400">
          O painel de vendas é exclusivo para vendedores AngoStart (criadores,
          prestadores ao domicílio e freelancers remotos).
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Button asChild className="h-11 bg-blue-600 px-6 font-semibold text-white hover:bg-blue-700">
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
    <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Fase 16 — fundo Dark Premium fixo atrás de todo o painel */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-[#0B1120]" />
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 sm:text-3xl">
            Painel de vendas
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Olá {user?.name?.split(' ')[0]} — aqui está o resumo do teu negócio na AngoStart.
          </p>
        </div>
        <div className="flex gap-2">
          {user?.username && (
            <Button asChild variant="outline" className="h-10 border-slate-600 text-slate-300 hover:bg-slate-700/40">
              <Link href={`/portfolio/${user.username}`} target="_blank">
                <ExternalLink className="mr-2 h-4 w-4" /> Ver Mini-Loja pública
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" className="h-10 border-blue-500/60 text-blue-400 hover:bg-blue-500/10">
            <Link href="/dashboard/vendedor/portfolio">Editar portfólio</Link>
          </Button>
          <Button asChild className="h-10 bg-blue-600 font-semibold text-white shadow-lg shadow-blue-600/25 hover:bg-blue-700">
            <Link href="/adicionar-produto">Publicar produto</Link>
          </Button>
        </div>
      </div>

      {/* Fase 12 — Verificação de Identidade: aviso de estado + cartão KYC.
          Verified → sem aviso (selo azul já ativo). Pending/not_submitted →
          aviso suave «Verifica a tua identidade…». Rejected → aviso vermelho:
          publicação bloqueada até reenvio do documento. Fase 13: overdue →
          aviso vermelho: prazo de 30 dias expirou, publicação bloqueada. */}
      {user && user.kyc_status !== 'verified' && !user.is_verified_bi && (
        <div
          className={`mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-4 ${
            user.kyc_status === 'rejected' || user.kyc_status === 'overdue'
              ? 'border-rose-500/40 bg-rose-500/10'
              : 'border-amber-500/40 bg-amber-500/10'
          }`}
          role="status"
        >
          <div className="flex items-start gap-3">
            {user.kyc_status === 'rejected' || user.kyc_status === 'overdue' ? (
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
            ) : (
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            )}
            <div>
              <p
                className={`text-sm font-bold ${
                  user.kyc_status === 'rejected' || user.kyc_status === 'overdue'
                    ? 'text-rose-200'
                    : 'text-amber-200'
                }`}
              >
                {user.kyc_status === 'rejected'
                  ? 'Verificação recusada — publicação de novos produtos bloqueada'
                  : user.kyc_status === 'overdue'
                    ? 'Prazo de 30 dias expirou — publicação de novos produtos bloqueada'
                    : 'Verifica a tua identidade para ganhares mais confiança'}
              </p>
              <p
                className={`mt-0.5 text-xs ${
                  user.kyc_status === 'rejected' || user.kyc_status === 'overdue'
                    ? 'text-rose-300'
                    : 'text-amber-300'
                }`}
              >
                {user.kyc_status === 'rejected'
                  ? 'Envia um novo documento (BI, Passaporte ou Cartão de Eleitor) abaixo — a publicação desbloqueia após envio.'
                  : user.kyc_status === 'overdue'
                    ? 'O prazo de 30 dias terminou sem documento. Envia a foto do documento abaixo — a publicação desbloqueia após envio (as vendas existentes continuam).'
                    : 'Podes vender já; com o documento aprovado ganhas o selo azul de vendedor verificado.'}
              </p>
            </div>
          </div>
          <BadgeCheck
            className={`h-6 w-6 shrink-0 ${
              user.kyc_status === 'rejected' || user.kyc_status === 'overdue'
                ? 'text-rose-400'
                : 'text-amber-400'
            }`}
          />
        </div>
      )}
      {user && (
        <Tabs defaultValue="geral" className="mt-4">
          {/* Fase 16 — navegação por tabs: menos scroll, tudo montado (forceMount
              preserva estado — GPS, propostas, dados carregados) */}
          <TabsList className="mb-6 flex h-auto w-full flex-wrap gap-1 rounded-2xl border border-white/10 bg-slate-800/80 p-1.5 backdrop-blur-xl">
            <TabsTrigger
              value="geral"
              className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-purple-600 data-[state=active]:text-white sm:text-sm"
            >
              Visão geral
            </TabsTrigger>
            <TabsTrigger
              value="loja"
              className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-purple-600 data-[state=active]:text-white sm:text-sm"
            >
              Loja & Catálogo
            </TabsTrigger>
            <TabsTrigger
              value="crescimento"
              className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-purple-600 data-[state=active]:text-white sm:text-sm"
            >
              Afiliados & Em alta
            </TabsTrigger>
            <TabsTrigger
              value="servicos"
              className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-purple-600 data-[state=active]:text-white sm:text-sm"
            >
              Serviços & Reputação
            </TabsTrigger>
          </TabsList>

          {/* ═══════════ TAB: LOJA & CATÁLOGO ═══════════ */}
          <TabsContent value="loja" forceMount className="data-[state=inactive]:hidden">
            <KycVerificationCard
              user={user}
              onUpdated={(patch: Partial<AuthUser>) => {
                const t = getToken();
                if (t && user) applySession(t, { ...user, ...patch });
              }}
              compact
            />

            {/* Fase 9 — Loja virtual: editor + página pública */}
            <div className="mt-4">
              <StoreEditorCard />
            </div>

            {/* Fase 16 — Estabelecimento (loja/hotel/empresa) com mapa fixo */}
            <BusinessProfileCard />

            {/* Mini-Loja — números públicos (Fase 6, ponto 1) */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-500/30 bg-blue-600/10 px-5 py-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <span className="flex items-center gap-1.5 font-semibold text-blue-200">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  {cards && cards.ratingCount > 0
                    ? `${cards.ratingAverage.toFixed(1)} ★ (${cards.ratingCount})`
                    : 'Avaliação estimada da plataforma · sem avaliações reais'}
                </span>
                <span className="flex items-center gap-1.5 text-blue-200">
                  <Package className="h-4 w-4 text-blue-300" />
                  {cards?.productsPublished ?? 0} produtos publicados
                </span>
                <span className="flex items-center gap-1.5 text-blue-200">
                  <Users className="h-4 w-4 text-blue-300" />
                  {cards?.clients ?? 0} clientes servidos
                </span>
              </div>
              <p className="text-[11px] text-blue-300/80">
                Estes números são o que os clientes veem na tua Mini-Loja.
              </p>
            </div>

            {/* Alertas (Fase 5) */}
            {data?.alerts.message && (
              <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p>{data.alerts.message}</p>
              </div>
            )}
          </TabsContent>

          {/* ═══════════ TAB: VISÃO GERAL (parte 1) ═══════════ */}
          <TabsContent value="geral" forceMount className="data-[state=inactive]:hidden">

      {/* Cartões de métricas — linha 1 */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            icon: Receipt,
            label: 'Encomendas recebidas',
            value: String(cards?.totalOrders ?? 0),
            num: cards?.totalOrders ?? 0,
            money: false,
            hint: `${cards?.itemsSold ?? 0} artigos vendidos`,
            tone: 'bg-blue-600/15 text-blue-300',
          },
          {
            icon: PiggyBank,
            label: 'Receita bruta confirmada',
            value: formatKz(cards?.revenueConfirmed ?? 0),
            num: cards?.revenueConfirmed ?? 0,
            money: true,
            hint: 'pagamentos validados',
            tone: 'bg-sky-500/15 text-sky-400',
          },
          {
            icon: TrendingUp,
            label: 'Receita líquida (após comissão)',
            value: formatKz(cards?.revenueNet ?? 0),
            num: cards?.revenueNet ?? 0,
            money: true,
            hint:
              cards && cards.commissionRetained > 0
                ? `comissão AngoStart ${cards.commissionPercent}%: ${formatKz(cards.commissionRetained)}`
                : 'sem comissões retidas',
            tone: 'bg-teal-500/15 text-teal-400',
          },
          {
            icon: ClipboardList,
            label: 'Receita pendente',
            value: formatKz(cards?.revenuePending ?? 0),
            num: cards?.revenuePending ?? 0,
            money: true,
            hint: 'à espera de validação',
            tone: 'bg-amber-500/15 text-amber-400',
          },
        ].map(({ icon: Icon, label, value, num, money, hint, tone }, i) => (
          <FadeIn key={label} delay={i * 0.06}>
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5 shadow-sm">
            <Icon aria-hidden="true" className="pointer-events-none absolute -right-3 -top-3 h-20 w-20 text-slate-700/25" />
            <div className="flex items-center justify-between">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
                <Icon className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-bold text-slate-100">
              <AnimatedStat value={num} format={money ? formatKz : undefined} />
            </p>
            <p className="text-sm font-medium text-slate-300">{label}</p>
            <p className="text-xs text-slate-400">{hint}</p>
          </div>
          </FadeIn>
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
            tone: 'bg-violet-500/15 text-violet-400',
          },
          {
            icon: Star,
            label: 'Avaliação média',
            value: cards && cards.ratingCount > 0 ? `${cards.ratingAverage} ★` : '—',
            hint: `${cards?.ratingCount ?? 0} avaliações recebidas`,
            tone: 'bg-amber-500/15 text-amber-400',
          },
          {
            icon: MessageCircle,
            label: 'Mensagens no chat (7d)',
            value: String(cards?.chatMessages7d ?? 0),
            hint: 'responde rápido para vender mais',
            tone: 'bg-sky-500/15 text-sky-400',
          },
          {
            icon: Package,
            label: 'Produtos publicados',
            value: String(cards?.productsPublished ?? 0),
            hint: 'no catálogo ativo',
            tone: 'bg-blue-600/15 text-blue-300',
          },
        ].map(({ icon: Icon, label, value, hint, tone }, i) => (
          <FadeIn key={label} delay={i * 0.06}>
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5 shadow-sm">
            <Icon aria-hidden="true" className="pointer-events-none absolute -right-3 -top-3 h-16 w-16 text-slate-700/25" />
            <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tone}`}>
              <Icon className="h-4 w-4" />
            </span>
            <p className="mt-2 text-xl font-bold text-slate-100">{value}</p>
            <p className="text-xs font-medium text-slate-300">{label}</p>
            <p className="text-[11px] text-slate-400">{hint}</p>
          </div>
          </FadeIn>
        ))}
      </div>

      {/* Gráficos */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section aria-label="Receita por mês" className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-100">Receita por mês (confirmada)</h2>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.revenueByMonth ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#94a3b8' }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                />
                <Tooltip
                  formatter={(value) => [formatKz(Number(value)), 'Receita']}
                  labelFormatter={(label) => `Mês ${label}`}
                  contentStyle={{ borderRadius: 12, borderColor: '#334155', backgroundColor: '#1e293b', color: '#e2e8f0', fontSize: 13 }}
                />
                <Bar dataKey="revenue" fill="#3b82f6" radius={[8, 8, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section aria-label="Produtos mais vendidos" className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-100">Produtos mais vendidos</h2>
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
                    contentStyle={{ borderRadius: 12, borderColor: '#334155', backgroundColor: '#1e293b', color: '#e2e8f0', fontSize: 13 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      {/* Fase 4/5 — Carteira (na Visão geral); Afiliados + Em alta vão para a tab Crescimento */}
      <div className="mt-8">
        {/* Carteira */}
        <section aria-label="Carteira" className="rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-600 to-teal-500 p-5 text-white shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Wallet className="h-5 w-5" /> Carteira AngoStart
          </h2>
          <p className="mt-3 text-xs text-blue-100">Saldo disponível</p>
          <p className="text-2xl font-bold">{formatKz(wallet?.saldo ?? 0)}</p>
          <p className="mt-2 text-xs text-blue-100">Em escrow (até entrega)</p>
          <p className="text-lg font-semibold">{formatKz(wallet?.saldo_bloqueado ?? 0)}</p>
          <Button
            asChild
            className="mt-4 h-10 w-full bg-white font-semibold text-blue-700 hover:bg-blue-50"
          >
            <Link href="/carteira">Abrir carteira</Link>
          </Button>
        </section>
      </div>
      </TabsContent>

      {/* ═══════════ TAB: AFILIADOS & EM ALTA (Crescimento) ═══════════ */}
      <TabsContent value="crescimento" forceMount className="data-[state=inactive]:hidden">
      <div className="mt-2 grid gap-6 lg:grid-cols-2">
        {/* Afiliados — Fase 10 (modelo Shopee/Amazon) */}
        <section aria-label="Programa de afiliados" className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
            <Share2 className="h-5 w-5 text-amber-500" /> Programa de afiliados
          </h2>
          {!affiliateCarregado ? (
            <p className="mt-6 text-sm text-slate-400">A carregar…</p>
          ) : affiliate ? (
            <>
              <p className="mt-3 text-xs text-slate-400">
                O teu código ({affiliate.comissao_percentual}% de comissão por venda):
              </p>
              <div className="mt-1 flex items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <span className="font-mono text-lg font-bold text-amber-300">
                  {affiliate.codigo_afiliado}
                </span>
                <button
                  onClick={copiarCodigo}
                  aria-label="Copiar código de afiliado"
                  className="rounded-lg p-2 text-amber-400 hover:bg-amber-500/20"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>

              {/* Escalão automático — 10 % → 15 % (Fase 9/10) */}
              {(() => {
                const totalEscalao =
                  affiliate.escalao.comissoes_recebidas + affiliate.escalao.proximo_escalao_em;
                const pct = totalEscalao > 0
                  ? Math.min(100, Math.round((affiliate.escalao.comissoes_recebidas / totalEscalao) * 100))
                  : 0;
                return (
                  <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/15 p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-amber-300">
                        Escalão {affiliate.comissao_percentual}%
                      </span>
                      <span className="text-slate-400">
                        {affiliate.escalao.comissoes_recebidas}{' '}
                        {affiliate.escalao.comissoes_recebidas === 1 ? 'comissão paga' : 'comissões pagas'}
                      </span>
                    </div>
                    <AnimatedBar
                      pct={affiliate.escalao.no_escalao_maximo ? 100 : pct}
                      className="mt-2 h-2 rounded-full bg-amber-500/20"
                      barClassName="bg-gradient-to-r from-amber-400 to-amber-600"
                    />
                    <p className="mt-1.5 text-xs text-slate-400">
                      {affiliate.escalao.no_escalao_maximo
                        ? `Escalão máximo atingido — ganhas ${affiliate.escalao.percentual_escalao_seguinte}% por venda. 🎉`
                        : `Faltam ${affiliate.escalao.proximo_escalao_em} ${
                            affiliate.escalao.proximo_escalao_em === 1 ? 'venda' : 'vendas'
                          } para ganhares ${affiliate.escalao.percentual_escalao_seguinte}%.`}
                    </p>
                  </div>
                );
              })()}

              <p className="mt-3 text-sm text-slate-300">
                Total ganho:{' '}
                <strong className="text-blue-300">{formatKz(affiliate.total_ganho)}</strong>
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {affiliate.earnings.length}{' '}
                {affiliate.earnings.length === 1 ? 'comissão' : 'comissões'} registadas
              </p>

              {/* Link limpo de afiliado (?ref=CODE) com janela de atribuição */}
              <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2">
                <code className="min-w-0 flex-1 truncate text-xs text-slate-300">
                  {affiliate.referral_link}
                </code>
                <button
                  onClick={() =>
                    copiarTexto(affiliate.referral_link, 'Link de afiliado copiado!', affiliate.referral_link)
                  }
                  aria-label="Copiar link de afiliado"
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-600"
                >
                  <Link2 className="h-4 w-4" />
                </button>
              </div>

              {/* Fase 11 — link de afiliado da LOJA inteira */}
              {affiliate.store_link && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                  <code className="min-w-0 flex-1 truncate text-xs text-amber-300">
                    {affiliate.store_link}
                  </code>
                  <button
                    onClick={() =>
                      copiarTexto(affiliate.store_link as string, 'Link da loja copiado!', affiliate.store_link as string)
                    }
                    aria-label="Copiar link de afiliado da loja"
                    className="rounded-lg p-2 text-amber-400 hover:bg-amber-500/20"
                  >
                    <Link2 className="h-4 w-4" />
                  </button>
                </div>
              )}
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                Válido durante {affiliate.atribuicao_dias} dias após o clique — compras feitas
                nesse prazo geram comissão. Usa as ferramentas abaixo para campanhas e links em massa.
              </p>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">
                Ganha 10% de cada venda feita com o teu código de referência — e sobe para 15%
                após 50 comissões. A comissão entra direto na tua carteira quando o pedido é pago.
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Requisito de adesão: 5 vendas concluídas (vendedor) ou 2 compras concluídas
                (cliente). O teu link fica atribuído 30 dias após o clique.
              </p>
              {affiliateElegibilidade && !affiliateElegibilidade.eligible && (
                <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  {affiliateElegibilidade.message}
                </p>
              )}
              <Button
                onClick={registarAfiliado}
                disabled={aRegistarAfiliado}
                className="mt-4 h-10 w-full bg-blue-600 font-semibold text-white shadow-lg shadow-blue-600/25 hover:bg-blue-700 disabled:opacity-60"
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
        <section aria-label="Marcar produtos em alta" className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
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
                    className="rounded-xl border border-slate-700/50 bg-slate-900/40 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-200">
                        {p.name}
                      </span>
                      <Link
                        href={`/adicionar-produto?id=${p.id}`}
                        aria-label={`Editar ${p.name} e palavras-chave`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-600 text-slate-300 transition-colors hover:border-blue-500/60 hover:text-blue-400"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Link>
                      <button
                        onClick={() => toggleHot(p)}
                        disabled={hotBusyId === p.id}
                        aria-pressed={Boolean(p.is_hot)}
                        aria-label={`Alternar «em alta» em ${p.name}`}
                        className={`flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold transition-colors disabled:opacity-50 ${
                          p.is_hot
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'border border-blue-500/40 bg-slate-800/80 text-blue-300 hover:bg-blue-500/10'
                        }`}
                      >
                        {hotBusyId === p.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Flame className="h-3.5 w-3.5" />
                        )}
                        {p.is_hot ? 'Em alta' : 'Marcar'}
                      </button>
                    </div>
                    {/* Fase 16 — keywords (Fase 15) visíveis no painel */}
                    {p.keywords && p.keywords.length > 0 && (
                      <div
                        className="mt-1.5 flex flex-wrap gap-1"
                        aria-label={`Palavras-chave de ${p.name}`}
                      >
                        {p.keywords.slice(0, 5).map((kw) => (
                          <span key={kw} className="chip-keyword-dark">
                            #{kw}
                          </span>
                        ))}
                        {p.keywords.length > 5 && (
                          <span className="inline-flex items-center rounded-full bg-slate-700/40 px-2 py-0.5 text-[11px] font-medium text-slate-400">
                            +{p.keywords.length - 5}
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {/* Fase 10 — Ferramentas de afiliado: campanha (Sub-ID), relatório por canal e links em massa */}
      {affiliate && (
        <section
          id="ferramentas-afiliado"
          aria-label="Ferramentas de afiliado"
          className="mt-8 rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/15 via-slate-800/50 to-slate-800/50 p-5 shadow-sm"
        >
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
            <Megaphone className="h-5 w-5 text-amber-500" /> Ferramentas de afiliado
          </h2>
          <div className="mt-4 grid gap-8 lg:grid-cols-2">
            {/* 1. Link de campanha (Sub-ID) */}
            <div>
              <h3 className="text-sm font-semibold text-slate-200">
                1. Link de campanha <span className="font-normal text-slate-400">(Sub-ID)</span>
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Cria um link por canal (ex.: <em>instagram</em>, <em>whatsapp</em>,{' '}
                <em>tiktok</em>) para saberes de onde vêm as tuas vendas — o canal fica
                registado na comissão.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  value={subCampanha}
                  onChange={(e) => setSubCampanha(e.target.value)}
                  placeholder="ex.: instagram"
                  maxLength={30}
                  aria-label="Nome da campanha (Sub-ID)"
                  className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-800/60 backdrop-blur-xl px-3 text-sm text-slate-200 outline-none focus:border-amber-400"
                />
                {subNormalizado() && (
                  <button
                    onClick={() => copiarTexto(linkComCampanha(), 'Link de campanha copiado!', linkComCampanha())}
                    className="flex h-10 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 hover:bg-blue-700"
                  >
                    <Copy className="h-4 w-4" /> Copiar
                  </button>
                )}
              </div>
              {subCampanha.trim() && !subNormalizado() && (
                <p className="mt-1.5 text-xs text-rose-500">
                  Usa só letras, números, hífen ou underscore (máx. 30).
                </p>
              )}
              {subNormalizado() && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-800/60 backdrop-blur-xl px-3 py-2">
                  <code className="min-w-0 flex-1 truncate text-xs text-slate-300">
                    {linkComCampanha()}
                  </code>
                </div>
              )}
            </div>

            {/* 2. Relatório de vendas por canal */}
            <div>
              <h3 className="text-sm font-semibold text-slate-200">2. Vendas por canal</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Comissões pagas por campanha — descobre qual canal vale mais a pena.
              </p>
              {affiliate.sub_id_report.length === 0 ? (
                <p className="mt-3 rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-xs text-slate-400">
                  Ainda sem comissões — partilha o teu link e o relatório aparece aqui.
                </p>
              ) : (
                <table className="mt-3 w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400">
                      <th scope="col" className="py-2 font-medium">Canal</th>
                      <th scope="col" className="py-2 text-right font-medium">Comissões</th>
                      <th scope="col" className="py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {affiliate.sub_id_report.map((r) => (
                      <tr key={r.sub_id ?? 'direto'} className="border-b border-slate-700/50 last:border-0">
                        <td className="py-2 font-medium text-slate-200">
                          {r.sub_id ?? '(sem campanha)'}
                        </td>
                        <td className="py-2 text-right text-slate-400">{r.comissoes}</td>
                        <td className="py-2 text-right font-semibold text-blue-300">
                          {formatKz(r.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* 3. Gerador em massa de links (batch — modelo Shopee) */}
            <div className="lg:col-span-2">
              <h3 className="text-sm font-semibold text-slate-200">3. Gerar links em massa</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Cola os links dos produtos (um por linha — aceita também só o número do
                produto) e gera todos os teus links de afiliado de uma vez
                {subNormalizado() ? (
                  <> com a campanha <strong>{subNormalizado()}</strong></>
                ) : (
                  <> (opcionalmente com a campanha acima)</>
                )}
                .
              </p>
              <textarea
                value={batchInput}
                onChange={(e) => setBatchInput(e.target.value)}
                rows={3}
                placeholder={'https://angostart.vercel.app/produtos/123\n124\nhttps://angostart.vercel.app/produtos/125'}
                aria-label="Links ou IDs de produtos (um por linha)"
                className="mt-3 w-full rounded-xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-3 font-mono text-xs text-slate-200 outline-none focus:border-amber-400"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  onClick={gerarLinksEmMassa}
                  className="h-9 bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Gerar links
                </Button>
                {batchLinks.length > 0 && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      copiarTexto(
                        batchLinks.map((l) => l.link).join('\n'),
                        'Todos os links copiados!',
                        `${batchLinks.length} ${batchLinks.length === 1 ? 'link' : 'links'}`
                      )
                    }
                    className="h-9 border-amber-500/40 px-4 text-sm font-semibold text-amber-300 hover:bg-amber-500/10"
                  >
                    <Copy className="h-4 w-4" /> Copiar todos
                  </Button>
                )}
                {batchAviso && <span className="text-xs text-slate-400">{batchAviso}</span>}
              </div>
              {batchLinks.length > 0 && (
                <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                  {batchLinks.map((l, i) => (
                    <li
                      key={`${i}-${l.link}`}
                      className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-800/60 backdrop-blur-xl px-3 py-2"
                    >
                      <code className="min-w-0 flex-1 truncate text-xs text-slate-300">{l.link}</code>
                      <button
                        onClick={() => copiarTexto(l.link, 'Link copiado!', l.input)}
                        aria-label={`Copiar link gerado para ${l.input}`}
                        className="rounded-lg p-1.5 text-amber-400 hover:bg-amber-500/10"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}
      </TabsContent>

      {/* ═══════════ TAB: VISÃO GERAL (parte 2) — atividade + encomendas ═══════════ */}
      <TabsContent value="geral" forceMount className="data-[state=inactive]:hidden">

      {/* Fase 5 — Atividade recente: avaliações + disponibilidade (domicílio) */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Últimas avaliações recebidas */}
        <section aria-label="Avaliações recentes" className="rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
            <Star className="h-5 w-5 text-amber-500" /> Avaliações recentes
          </h2>
          {(data?.recentReviews?.length ?? 0) === 0 ? (
            <p className="mt-4 text-sm text-slate-400">
              Ainda sem avaliações — clientes com compra confirmada podem avaliar os teus produtos.
            </p>
          ) : (
            <ul className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-1">
              {data!.recentReviews.map((r, i) => (
                <li key={i} className="rounded-xl border border-slate-700/50 bg-slate-900/40 px-3 py-2">
                  <p className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                    <span className="text-amber-500">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                    {r.product_name}
                    <span className="ml-auto font-normal text-slate-400">
                      {new Date(r.created_at).toLocaleDateString('pt-PT')}
                    </span>
                  </p>
                  {r.comment && <p className="mt-1 line-clamp-2 text-xs text-slate-400">{r.comment}</p>}
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
                ? 'border-blue-300 bg-gradient-to-br from-blue-600 to-teal-500'
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
                    estadoDisponibilidade?.is_available ? 'bg-blue-400 animate-pulse' : 'bg-white/60'
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
                className="h-10 flex-1 bg-white font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-70"
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
      <section aria-label="Encomendas recebidas" className="mt-8 rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-100">Encomendas recebidas</h2>
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
                className: 'bg-slate-700/40 text-slate-300',
              };
              return (
                <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-100">
                      #{order.id} — {order.customer_name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-400">
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
                    <span className="text-sm font-bold text-blue-300">
                      {formatKz(order.items.reduce((acc, i) => acc + i.price_kz * i.quantity, 0))}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      </TabsContent>

      {/* ═══════════ TAB: SERVIÇOS & REPUTAÇÃO ═══════════ */}
      <TabsContent value="servicos" forceMount className="data-[state=inactive]:hidden">

      {/* Ponto 4B: serviços ao domicílio pagos — iniciar deslocação + GPS em tempo real */}
      <ServicosAtivosCard />

      {/* Gamificação — selos, nível e progresso (Fase 7) */}
      <GamificationCard />

      {/* Comissão efetiva aplicada às vendas (Fase 7) */}
      <CommissionRateCard />

      {/* Propostas v2 — negociação (Fase 7) */}
      <PropostasRecebidas />
      </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

/* ════════════════════════ Fase 7 — Gamificação ════════════════════════ */

const LEVEL_STYLE: Record<string, { label: string; emoji: string; bar: string }> = {
  bronze: { label: 'Bronze', emoji: '🥉', bar: 'bg-amber-600' },
  prata: { label: 'Prata', emoji: '🥈', bar: 'bg-slate-400' },
  ouro: { label: 'Ouro', emoji: '🥇', bar: 'bg-yellow-500' },
  platina: { label: 'Platina', emoji: '💎', bar: 'bg-blue-600' },
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
    <section aria-label="Nível e selos" className="mt-8 rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-100">Nível e selos</h2>
        <Medal className="h-5 w-5 text-slate-300" />
      </div>
      <div className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1 text-sm font-bold text-white`}>
            {level.emoji} {level.label}
          </span>
          <span className="text-sm text-slate-300">
            <strong className="text-slate-100">{data.points}</strong> pontos ·{' '}
            {data.sales_count} vendas concluídas
          </span>
        </div>

        {/* Progresso para o próximo nível — anel (Fase 16, estilo Focus Timer) */}
        {data.next_level ? (
          <div className="mt-4 flex items-center gap-4">
            <div className="relative h-20 w-20 shrink-0">
              <svg viewBox="0 0 84 84" className="h-20 w-20 -rotate-90" aria-hidden="true">
                <circle cx="42" cy="42" r="36" fill="none" stroke="#334155" strokeWidth="8" />
                <circle
                  cx="42"
                  cy="42"
                  r="36"
                  fill="none"
                  stroke="url(#anel-nivel)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${Math.max(0, Math.min(1, data.progress)) * 226.19} 226.19`}
                />
                <defs>
                  <linearGradient id="anel-nivel" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" />
                    <stop offset="100%" stopColor="#8b5cf6" />
                  </linearGradient>
                </defs>
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-slate-100">
                {Math.round(data.progress * 100)}%
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-200">
                Progresso para {data.next_level.label}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                faltam <strong className="text-slate-200">{data.next_level.missing}</strong> pontos
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                Como ganhar pontos: +1 por venda concluída · +5 por avaliação 5★ · +10 por resposta
                ao chat em menos de 1 h.
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs font-semibold text-blue-300">
            Nível máximo atingido — parabéns! 💎
          </p>
        )}

        {/* Selos conquistados + bloqueados */}
        <div className="mt-4 flex flex-wrap gap-2">
          {data.badges.map((b) => (
            <span
              key={b.code}
              title={b.description}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300"
            >
              <Award className="h-3.5 w-3.5" /> {b.name}
            </span>
          ))}
          {data.locked_badges.slice(0, 6).map((b) => (
            <span
              key={b.code}
              title={b.description}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-900/40 px-3 py-1 text-xs font-medium text-slate-400"
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
      className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl px-5 py-4 shadow-sm"
    >
      <div className="flex items-center gap-3">
        <Receipt className="h-5 w-5 text-blue-300" />
        <div>
          <p className="text-sm font-semibold text-slate-100">
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
    <section aria-label="Propostas recebidas" className="mt-8 rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/50 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-100">Propostas recebidas</h2>
        <div className="flex gap-1">
          {(['todas', 'pendente', 'aceite', 'recusada'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                statusFilter === s
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700/40 text-slate-300 hover:bg-slate-600'
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
                <p className="text-sm font-semibold text-slate-100">
                  {p.client_name ?? 'Cliente'} — sobre «{p.service_name}»
                </p>
                <div className="flex items-center gap-2">
                  {p.rounds > 1 && (
                    <span className="rounded-full bg-violet-500/20 px-2.5 py-1 text-xs font-semibold text-violet-300">
                      {p.rounds} rodadas
                    </span>
                  )}
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      p.status === 'pendente'
                        ? 'bg-amber-500/20 text-amber-400'
                        : p.status === 'aceite'
                          ? 'bg-blue-600/20 text-blue-300'
                          : 'bg-slate-700/40 text-slate-300'
                    }`}
                  >
                    {p.status}
                  </span>
                </div>
              </div>
              <p className="mt-1 whitespace-pre-line text-sm text-slate-300">{p.description}</p>
              <p className="mt-1 text-xs text-slate-400">
                Oferta atual: <strong className="text-blue-700">{formatKz(p.price_kz)}</strong>
                {p.deadline_days ? ` · prazo ${p.deadline_days} dias` : ''} ·{' '}
                {p.my_offer_standing && p.status === 'pendente'
                  ? 'a tua oferta está na mesa — aguarda o cliente'
                  : new Date(p.updated_at).toLocaleString('pt-PT')}
                {p.order_id ? ` · pedido #${p.order_id}` : ''}
              </p>

              {/* Histórico da negociação */}
              {history?.proposalId === p.id && (
                <ol className="mt-3 space-y-2 rounded-xl border border-white/10 bg-slate-900/40 p-3">
                  {history.entries.map((h) => (
                    <li key={h.id} className="text-xs text-slate-300">
                      <span className={h.by_me ? 'font-semibold text-blue-700' : 'font-semibold'}>
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
                <div className="mt-3 space-y-2 rounded-xl border border-blue-500/30 bg-blue-600/10/50 p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      value={counterPrice}
                      onChange={(e) => setCounterPrice(e.target.value.replace(/[^\d]/g, ''))}
                      inputMode="numeric"
                      placeholder={`O teu preço em Kz (atual: ${p.price_kz})`}
                      className="h-9 w-full rounded-lg border border-white/10 bg-slate-800/60 backdrop-blur-xl px-3 text-sm outline-none focus:border-blue-400"
                    />
                    <input
                      value={counterDeadline}
                      onChange={(e) => setCounterDeadline(e.target.value.replace(/[^\d]/g, ''))}
                      inputMode="numeric"
                      placeholder="Prazo em dias (opcional)"
                      className="h-9 w-full rounded-lg border border-white/10 bg-slate-800/60 backdrop-blur-xl px-3 text-sm outline-none focus:border-blue-400"
                    />
                  </div>
                  <textarea
                    value={counterMessage}
                    onChange={(e) => setCounterMessage(e.target.value)}
                    rows={2}
                    maxLength={2000}
                    placeholder="Mensagem com a contraproposta (opcional)…"
                    className="w-full rounded-lg border border-white/10 bg-slate-800/60 backdrop-blur-xl p-2.5 text-sm outline-none focus:border-blue-400"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={sendCounter}
                      disabled={busyId === p.id || counterPrice.length === 0}
                      className="inline-flex h-8 items-center rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {busyId === p.id ? 'A enviar…' : 'Enviar contraproposta'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCounterFor(null)}
                      className="inline-flex h-8 items-center rounded-lg border border-slate-600 px-3 text-xs font-semibold text-slate-300 hover:bg-slate-700/40"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {p.status === 'pendente' && counterFor?.id !== p.id && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {p.my_offer_standing ? (
                    <span className="inline-flex h-8 items-center rounded-lg bg-slate-700/40 px-3 text-xs font-medium text-slate-400">
                      Aguarda a resposta do cliente
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => answer(p.id, 'aceite')}
                        disabled={busyId === p.id}
                        className="inline-flex h-8 items-center rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
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
                        className="inline-flex h-8 items-center rounded-lg border border-slate-600 px-3 text-xs font-semibold text-slate-300 hover:bg-slate-700/40 disabled:opacity-50"
                      >
                        Recusar
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => openHistory(p.id)}
                    className="inline-flex h-8 items-center rounded-lg border border-white/10 px-3 text-xs font-semibold text-slate-400 hover:bg-slate-700/40"
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
 *  2. GPS do telemóvel via watchPosition + envio ao servidor a cada 3 s (Fase 16)
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

  /** Liga o GPS contínuo para um pedido: watchPosition + envio a cada 3 s (Fase 16). */
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
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 12_000 }
    );

    // Envio periódico a cada 3 s (o servidor valida tracking ativo)
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
    }, 3_000);

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
      <section className="mt-8 rounded-2xl border border-white/10 bg-slate-800/60 backdrop-blur-xl px-5 py-8 text-center text-sm text-slate-400">
        A carregar serviços…
      </section>
    );
  }

  if (servicos.length === 0) return null;

  return (
    <section
      aria-label="Serviços ao domicílio ativos"
      className="mt-8 rounded-2xl border border-sky-500/30 bg-slate-800/60 backdrop-blur-xl shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
          <Bike className="h-5 w-5 text-sky-600" /> Serviços ao domicílio — em curso
        </h2>
        <span className="rounded-full bg-sky-500/20 px-2.5 py-0.5 text-xs font-bold text-sky-300">
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
                  <p className="text-sm font-semibold text-slate-100">
                    #{s.id} — {s.customer_name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {s.items.map((i) => `${i.quantity}× ${i.name}`).join(' · ')}
                  </p>
                  {s.delivery_address && (
                    <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-300">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-300" />
                      <span>
                        <strong>Morada:</strong> {s.delivery_address}
                        {s.notes ? ` · Nota: ${s.notes}` : ''}
                      </span>
                    </p>
                  )}
                  {!s.client_has_gps && (
                    <p className="mt-1 text-[11px] text-amber-400">
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
                      <span className="flex items-center gap-1.5 rounded-full bg-sky-500/20 px-3 py-1 text-xs font-bold text-sky-300">
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
