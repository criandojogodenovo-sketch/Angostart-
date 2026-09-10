'use client';

/**
 * GOMBUONE — Painel de campanhas do vendedor (/dashboard/vendedor/campanhas).
 *
 * 🔒 Acesso: apenas vendedores autenticados (como o painel principal).
 *
 * Tabs:
 *  1. Campanhas      — lista + criar + editar status (publicar/pausar/terminar)
 *  2. Oportunidades  — gestão por campanha (criar, pausar, terminar)
 *  3. Validar código — o consumidor apresenta GMB-XXXXXX na loja → validação
 *  4. Distribuição   — resultados das partilhas com link de afiliado (?ref=)
 *
 * Toda a validação de segurança acontece nas APIs (role guard, rate limit,
 * sanitização, validação atómica) — esta página apenas interage.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Lock,
  Megaphone,
  Percent,
  Plus,
  ScanSearch,
  Share2,
  Target,
  Ticket,
  Trash2,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth, authHeaders } from '@/context/AuthContext';

interface Campaign {
  id: number;
  title: string;
  description: string | null;
  status: 'rascunho' | 'ativa' | 'pausada' | 'terminada';
  starts_at: string | null;
  ends_at: string | null;
  opportunity_count: number;
  codes_issued: number;
  codes_used: number;
}

interface Opportunity {
  id: number;
  campaign_id: number;
  title: string;
  kind: string;
  discount_percent: number | null;
  mission_text: string | null;
  total_codes: number;
  status: string;
  codes_issued?: number;
}

interface DistributionRow {
  campaign_title: string;
  opportunity_title: string;
  issued: number;
  used: number;
}

const STATUS_BADGE: Record<string, string> = {
  rascunho: 'bg-slate-100 text-slate-600',
  ativa: 'bg-emerald-50 text-emerald-700',
  pausada: 'bg-amber-50 text-amber-700',
  terminada: 'bg-slate-100 text-slate-500',
  esgotada: 'bg-rose-50 text-rose-700',
};

const inputClass =
  'h-11 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const labelClass = 'text-xs font-semibold text-slate-600';

export default function CampanhasDashboardPage() {
  const { user, loading: authLoading, isSeller } = useAuth();
  const { toast } = useToast();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  /* Formulário: nova campanha */
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');

  /* Gestão de oportunidades */
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [oppTitle, setOppTitle] = useState('');
  const [oppKind, setOppKind] = useState('oferta');
  const [oppDescription, setOppDescription] = useState('');
  const [oppDiscount, setOppDiscount] = useState('');
  const [oppMission, setOppMission] = useState('');
  const [oppTotal, setOppTotal] = useState('');
  const [oppBusy, setOppBusy] = useState(false);

  /* Validação de código */
  const [validateCode, setValidateCode] = useState('');
  const [validateBusy, setValidateBusy] = useState(false);
  const [validateResult, setValidateResult] = useState<
    { ok: true; campaign_title: string; opportunity_title: string } | { ok: false; error: string } | null
  >(null);

  /* Distribuição */
  const [distributions, setDistributions] = useState<DistributionRow[]>([]);

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await fetch('/api/campanhas?minhas=1', { headers: authHeaders(), cache: 'no-store' });
      const data = (await res.json()) as { campaigns?: Campaign[]; error?: string };
      setCampaigns(res.ok ? (data.campaigns ?? []) : []);
    } catch {
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDistributions = useCallback(async () => {
    try {
      const res = await fetch('/api/campanhas/distribuicoes', { headers: authHeaders(), cache: 'no-store' });
      const data = (await res.json()) as { distributions?: DistributionRow[] };
      setDistributions(res.ok ? (data.distributions ?? []) : []);
    } catch {
      setDistributions([]);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user && isSeller) {
      loadCampaigns();
      loadDistributions();
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [authLoading, user, isSeller, loadCampaigns, loadDistributions]);

  async function handleCreateCampaign() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/campanhas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          title,
          description: description || undefined,
          starts_at: startsAt || undefined,
          ends_at: endsAt || undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        toast({ title: 'Não foi possível criar', description: data.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Campanha criada!', description: 'Adiciona agora as tuas oportunidades.' });
      setTitle('');
      setDescription('');
      setStartsAt('');
      setEndsAt('');
      loadCampaigns();
    } catch {
      toast({ title: 'Erro de ligação', variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  }

  async function handleStatusChange(campaign: Campaign, status: string) {
    try {
      const res = await fetch(`/api/campanhas/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        toast({ title: 'Não foi possível atualizar', description: data.error, variant: 'destructive' });
        return;
      }
      toast({
        title:
          status === 'ativa' ? 'Campanha publicada!' : status === 'pausada' ? 'Campanha pausada.' : 'Campanha terminada.',
      });
      loadCampaigns();
      if (selectedCampaign?.id === campaign.id) setSelectedCampaign(null);
    } catch {
      toast({ title: 'Erro de ligação', variant: 'destructive' });
    }
  }

  async function handleDeleteCampaign(campaign: Campaign) {
    try {
      const res = await fetch(`/api/campanhas/${campaign.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = (await res.json()) as { ok?: boolean; archived?: boolean; message?: string; error?: string };
      if (!res.ok) {
        toast({ title: 'Não foi possível eliminar', description: data.error, variant: 'destructive' });
        return;
      }
      toast({ title: data.archived ? 'Campanha arquivada' : 'Campanha eliminada', description: data.message });
      loadCampaigns();
    } catch {
      toast({ title: 'Erro de ligação', variant: 'destructive' });
    }
  }

  async function handleOpportunityStatus(o: Opportunity, status: string) {
    try {
      const res = await fetch(`/api/oportunidades/${o.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        toast({ title: 'Não foi possível atualizar', description: data.error, variant: 'destructive' });
        return;
      }
      toast({
        title: status === 'ativa' ? 'Oportunidade reativada.' : status === 'pausada' ? 'Oportunidade pausada.' : 'Oportunidade terminada.',
      });
      if (selectedCampaign) handleSelectCampaign(selectedCampaign);
      loadCampaigns();
    } catch {
      toast({ title: 'Erro de ligação', variant: 'destructive' });
    }
  }

  async function handleSelectCampaign(campaign: Campaign) {
    setSelectedCampaign(campaign);
    setOpportunities([]);
    try {
      const res = await fetch(`/api/campanhas/${campaign.id}/oportunidades`, {
        headers: authHeaders(),
        cache: 'no-store',
      });
      const data = (await res.json()) as { opportunities?: Opportunity[] };
      setOpportunities(res.ok ? (data.opportunities ?? []) : []);
    } catch {
      setOpportunities([]);
    }
  }

  async function handleCreateOpportunity() {
    if (!selectedCampaign || oppBusy) return;
    setOppBusy(true);
    try {
      const res = await fetch(`/api/campanhas/${selectedCampaign.id}/oportunidades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          title: oppTitle,
          description: oppDescription || undefined,
          kind: oppKind,
          discount_percent: oppKind === 'desconto' && oppDiscount ? Number(oppDiscount) : undefined,
          mission_text: oppMission || undefined,
          total_codes: oppTotal ? Number(oppTotal) : undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        toast({ title: 'Não foi possível criar', description: data.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Oportunidade criada!' });
      setOppTitle('');
      setOppDescription('');
      setOppDiscount('');
      setOppMission('');
      setOppTotal('');
      handleSelectCampaign(selectedCampaign);
      loadCampaigns();
    } catch {
      toast({ title: 'Erro de ligação', variant: 'destructive' });
    } finally {
      setOppBusy(false);
    }
  }

  async function handleValidate() {
    if (validateBusy || !validateCode.trim()) return;
    setValidateBusy(true);
    setValidateResult(null);
    try {
      const res = await fetch('/api/oportunidades/validar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ code: validateCode }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        campaign_title?: string;
        opportunity_title?: string;
      };
      if (!res.ok || !data.ok) {
        setValidateResult({ ok: false, error: data.error ?? 'Erro desconhecido.' });
        return;
      }
      setValidateResult({
        ok: true,
        campaign_title: data.campaign_title ?? '',
        opportunity_title: data.opportunity_title ?? '',
      });
      toast({ title: 'Código validado!', description: 'A vantagem foi aplicada ao consumidor.' });
      setValidateCode('');
      loadCampaigns();
    } catch {
      setValidateResult({ ok: false, error: 'Erro de ligação — tenta novamente.' });
    } finally {
      setValidateBusy(false);
    }
  }

  /* ─── Ecrã de acesso restrito (igual ao painel principal) ─── */
  if (!authLoading && (!user || !isSeller)) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
        <Lock className="h-12 w-12 text-slate-300" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-extrabold text-slate-900">Acesso restrito</h1>
        <p className="mt-2 text-sm text-slate-500">
          O motor de campanhas está disponível para vendedores. Entra com a tua conta de vendedor para gerir campanhas.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar ao início
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 text-white shadow-lg shadow-blue-600/25">
          <Megaphone className="h-6 w-6" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">Motor de campanhas</h1>
          <p className="mt-1 text-sm text-slate-500">
            Cria campanhas, publica oportunidades, valida códigos e acompanha os resultados.
          </p>
        </div>
      </div>

      <Tabs defaultValue="campanhas" className="mt-6">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-slate-100 p-1">
          <TabsTrigger value="campanhas" className="gap-1.5 text-xs sm:text-sm">
            <Megaphone className="h-4 w-4" /> Campanhas
          </TabsTrigger>
          <TabsTrigger value="oportunidades" className="gap-1.5 text-xs sm:text-sm">
            <Ticket className="h-4 w-4" /> Oportunidades
          </TabsTrigger>
          <TabsTrigger value="validar" className="gap-1.5 text-xs sm:text-sm">
            <ScanSearch className="h-4 w-4" /> Validar código
          </TabsTrigger>
          <TabsTrigger value="distribuicao" className="gap-1.5 text-xs sm:text-sm">
            <Share2 className="h-4 w-4" /> Distribuição
          </TabsTrigger>
        </TabsList>

        {/* ─── Tab 1: Campanhas ─── */}
        <TabsContent value="campanhas" className="mt-4 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <h2 className="flex items-center gap-1.5 text-base font-bold text-slate-900">
              <Plus className="h-4 w-4 text-blue-600" /> Nova campanha
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="campanha-titulo" className={labelClass}>Título *</label>
                <input
                  id="campanha-titulo"
                  className={inputClass}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder='Ex.: "Campanha de lançamento"'
                  maxLength={120}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="campanha-desc" className={labelClass}>Descrição</label>
                <textarea
                  id="campanha-desc"
                  className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Estratégia da campanha — o que a empresa pretende divulgar…"
                  maxLength={2000}
                />
              </div>
              <div>
                <label htmlFor="campanha-inicio" className={labelClass}>Início</label>
                <input id="campanha-inicio" type="date" className={inputClass} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </div>
              <div>
                <label htmlFor="campanha-fim" className={labelClass}>Fim</label>
                <input id="campanha-fim" type="date" className={inputClass} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
              </div>
            </div>
            <Button
              onClick={handleCreateCampaign}
              disabled={creating || title.trim().length < 3}
              className="mt-4 bg-blue-600 hover:bg-blue-700"
            >
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Criar campanha (rascunho)
            </Button>
            <p className="mt-2 text-xs text-slate-400">
              A campanha nasce como rascunho — publica-a quando as oportunidades estiverem prontas.
            </p>
          </motion.div>

          {loading ? (
            <p className="py-10 text-center text-sm text-slate-400">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> A carregar campanhas…
            </p>
          ) : campaigns.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">
              Ainda não tens campanhas — cria a primeira acima!
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {campaigns.map((c) => (
                <motion.article
                  key={c.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-bold text-slate-900">{c.title}</h3>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_BADGE[c.status]}`}>
                      {c.status}
                    </span>
                  </div>
                  {(c.starts_at || c.ends_at) && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {c.starts_at && <span>{new Date(c.starts_at).toLocaleDateString('pt-PT')}</span>}
                      {c.ends_at && <span>→ {new Date(c.ends_at).toLocaleDateString('pt-PT')}</span>}
                    </p>
                  )}
                  <p className="mt-2 text-sm text-slate-600">
                    {c.opportunity_count} oportunidade(s) · {c.codes_issued} código(s) emitidos ·{' '}
                    <span className="font-semibold text-emerald-600">{c.codes_used} utilizados</span>
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={`/campanhas/${c.id}`}
                      className="inline-flex h-9 items-center rounded-lg border border-blue-200 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                    >
                      Ver página pública
                    </Link>
                    {c.status === 'rascunho' && (
                      <Button size="sm" variant="outline" className="h-9 border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => handleStatusChange(c, 'ativa')}>
                        Publicar
                      </Button>
                    )}
                    {c.status === 'ativa' && (
                      <Button size="sm" variant="outline" className="h-9 border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => handleStatusChange(c, 'pausada')}>
                        Pausar
                      </Button>
                    )}
                    {c.status === 'pausada' && (
                      <Button size="sm" variant="outline" className="h-9 border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => handleStatusChange(c, 'ativa')}>
                        Reativar
                      </Button>
                    )}
                    {c.status !== 'terminada' && (
                      <Button size="sm" variant="outline" className="h-9 border-slate-300 text-slate-600 hover:bg-slate-50" onClick={() => handleStatusChange(c, 'terminada')}>
                        Terminar
                      </Button>
                    )}
                    {c.status !== 'terminada' && (
                      <Button size="sm" variant="ghost" className="h-9 text-rose-500 hover:bg-rose-50" onClick={() => handleDeleteCampaign(c)} aria-label="Eliminar campanha">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </motion.article>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ─── Tab 2: Oportunidades ─── */}
        <TabsContent value="oportunidades" className="mt-4 space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold text-slate-900">Escolhe a campanha</h2>
            {campaigns.filter((c) => c.status !== 'terminada').length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">Cria primeiro uma campanha (tab Campanhas).</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {campaigns
                  .filter((c) => c.status !== 'terminada')
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelectCampaign(c)}
                      className={`h-9 rounded-full border px-4 text-xs font-semibold transition-colors ${
                        selectedCampaign?.id === c.id
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-slate-200 text-slate-600 hover:border-blue-300'
                      }`}
                    >
                      {c.title}
                    </button>
                  ))}
              </div>
            )}
          </div>

          {selectedCampaign && (
            <>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <h2 className="flex items-center gap-1.5 text-base font-bold text-slate-900">
                  <Plus className="h-4 w-4 text-blue-600" /> Nova oportunidade em «{selectedCampaign.title}»
                </h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label htmlFor="opp-titulo" className={labelClass}>Título *</label>
                    <input
                      id="opp-titulo"
                      className={inputClass}
                      value={oppTitle}
                      onChange={(e) => setOppTitle(e.target.value)}
                      placeholder='Ex.: "Desconto de lançamento de 20%"'
                      maxLength={120}
                    />
                  </div>
                  <div>
                    <label htmlFor="opp-tipo" className={labelClass}>Tipo</label>
                    <select id="opp-tipo" className={inputClass} value={oppKind} onChange={(e) => setOppKind(e.target.value)}>
                      <option value="oferta">Oferta</option>
                      <option value="desconto">Desconto</option>
                      <option value="missao">Missão</option>
                      <option value="brinde">Brinde</option>
                      <option value="evento">Evento</option>
                    </select>
                  </div>
                  {oppKind === 'desconto' && (
                    <div>
                      <label htmlFor="opp-desconto" className={labelClass}>Desconto (%)</label>
                      <input
                        id="opp-desconto"
                        type="number"
                        min={1}
                        max={100}
                        className={inputClass}
                        value={oppDiscount}
                        onChange={(e) => setOppDiscount(e.target.value)}
                        placeholder="20"
                      />
                    </div>
                  )}
                  <div className="sm:col-span-2">
                    <label htmlFor="opp-desc" className={labelClass}>Descrição</label>
                    <textarea
                      id="opp-desc"
                      className="min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      value={oppDescription}
                      onChange={(e) => setOppDescription(e.target.value)}
                      placeholder="A oferta concreta apresentada ao consumidor…"
                      maxLength={2000}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="opp-missao" className={labelClass}>
                      <Target className="mr-1 inline h-3.5 w-3.5 text-violet-500" /> Missão (ação verificável)
                    </label>
                    <input
                      id="opp-missao"
                      className={inputClass}
                      value={oppMission}
                      onChange={(e) => setOppMission(e.target.value)}
                      placeholder='Ex.: "Visita a loja e utiliza o código na compra"'
                      maxLength={1000}
                    />
                  </div>
                  <div>
                    <label htmlFor="opp-total" className={labelClass}>Total de códigos (vazio = ilimitado)</label>
                    <input
                      id="opp-total"
                      type="number"
                      min={-1}
                      className={inputClass}
                      value={oppTotal}
                      onChange={(e) => setOppTotal(e.target.value)}
                      placeholder="100"
                    />
                  </div>
                </div>
                <Button
                  onClick={handleCreateOpportunity}
                  disabled={oppBusy || oppTitle.trim().length < 3}
                  className="mt-4 bg-blue-600 hover:bg-blue-700"
                >
                  {oppBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Criar oportunidade
                </Button>
              </motion.div>

              {opportunities.length > 0 && (
                <div className="space-y-3">
                  {opportunities.map((o) => (
                    <motion.div
                      key={o.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
                          {o.title}
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_BADGE[o.status] ?? ''}`}>
                            {o.status}
                          </span>
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {o.kind}
                          {o.discount_percent !== null && ` · -${o.discount_percent}%`}
                          {o.total_codes >= 0 ? ` · ${o.total_codes} códigos` : ' · códigos ilimitados'}
                          {typeof o.codes_issued === 'number' && ` · ${o.codes_issued} emitidos`}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {o.status === 'ativa' && (
                          <Button size="sm" variant="outline" className="h-9 border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => handleOpportunityStatus(o, 'pausada')}>
                            Pausar
                          </Button>
                        )}
                        {o.status === 'pausada' && (
                          <Button size="sm" variant="outline" className="h-9 border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => handleOpportunityStatus(o, 'ativa')}>
                            Reativar
                          </Button>
                        )}
                        {o.status !== 'terminada' && (
                          <Button size="sm" variant="outline" className="h-9 border-slate-300 text-slate-600 hover:bg-slate-50" onClick={() => handleOpportunityStatus(o, 'terminada')}>
                            Terminar
                          </Button>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ─── Tab 3: Validar código ─── */}
        <TabsContent value="validar" className="mt-4">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 className="flex items-center gap-1.5 text-base font-bold text-slate-900">
              <ScanSearch className="h-4 w-4 text-blue-600" /> Validar código na loja
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              O consumidor apresenta o código GMB-XXXXXX (na app, print ou mensagem). Introduz-o aqui para validar a vantagem — cada código é utilizável uma única vez.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                className={`${inputClass} font-mono uppercase tracking-widest`}
                value={validateCode}
                onChange={(e) => setValidateCode(e.target.value.toUpperCase())}
                placeholder="GMB-XXXXXX"
                maxLength={14}
                aria-label="Código a validar"
              />
              <Button onClick={handleValidate} disabled={validateBusy || !validateCode.trim()} className="h-11 bg-blue-600 hover:bg-blue-700">
                {validateBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Validar
              </Button>
            </div>

            {validateResult && (
              <div
                className={`mt-4 rounded-xl border p-4 ${
                  validateResult.ok
                    ? 'border-teal-200 bg-teal-50'
                    : 'border-rose-200 bg-rose-50'
                }`}
                role="status"
                aria-live="polite"
              >
                {validateResult.ok ? (
                  <>
                    <p className="flex items-center gap-1.5 text-sm font-bold text-teal-800">
                      <CheckCircle2 className="h-4 w-4" /> Código validado com sucesso!
                    </p>
                    <p className="mt-1 text-xs text-teal-700">
                      {validateResult.opportunity_title} — {validateResult.campaign_title}
                    </p>
                  </>
                ) : (
                  <p className="flex items-center gap-1.5 text-sm font-bold text-rose-700">
                    <XCircle className="h-4 w-4" /> {validateResult.error}
                  </p>
                )}
              </div>
            )}
          </motion.div>
        </TabsContent>

        {/* ─── Tab 4: Distribuição (resultados do afiliado) ─── */}
        <TabsContent value="distribuicao" className="mt-4">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 className="flex items-center gap-1.5 text-base font-bold text-slate-900">
              <TrendingUp className="h-4 w-4 text-blue-600" /> Resultados das tuas distribuições
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Códigos emitidos e utilizados a partir dos teus links de distribuidor (com o teu{' '}
              <Percent className="inline h-3.5 w-3.5" aria-hidden="true" />
              <code className="mx-0.5 rounded bg-slate-100 px-1 text-[11px]">?ref=</code>
              de afiliado) — consulta o teu código no teu perfil.
            </p>
            {distributions.length === 0 ? (
              <p className="mt-6 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
                Ainda não há códigos atribuídos às tuas partilhas — partilha campanhas com o teu link de afiliado!
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                      <th className="pb-2 pr-4 font-semibold">Campanha</th>
                      <th className="pb-2 pr-4 font-semibold">Oportunidade</th>
                      <th className="pb-2 pr-4 font-semibold">Emitidos</th>
                      <th className="pb-2 font-semibold">Utilizados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {distributions.map((d, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0">
                        <td className="py-2.5 pr-4 text-slate-700">{d.campaign_title}</td>
                        <td className="py-2.5 pr-4 text-slate-600">{d.opportunity_title}</td>
                        <td className="py-2.5 pr-4 font-semibold text-blue-700">{d.issued}</td>
                        <td className="py-2.5 font-semibold text-emerald-600">{d.used}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        </TabsContent>
      </Tabs>

      <div className="mt-8">
        <Link
          href="/dashboard/vendedor"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-blue-700"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar ao painel principal
        </Link>
      </div>
    </main>
  );
}
