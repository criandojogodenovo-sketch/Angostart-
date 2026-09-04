'use client';

/**
 * AngoStart — Secção "Comprovativos de pagamentos" (partilhada pelos
 * painéis /admin e /admin-limitado).
 *
 * Lista as encomendas à espera de validação (KWiK, PayPay, Multicaixa
 * Express — badge por método), permite VER o comprovativo (imagem ou PDF
 * — carregado em binário com autenticação Bearer, nunca num URL público)
 * e Aprovar/Rejeitar com observação interna.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BadgeCheck,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  ShieldQuestion,
  Smartphone,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { authHeaders } from '@/context/AuthContext';
import { formatKz } from '@/lib/format';
import { buildKwikReference, ORDER_STATUS_BADGES, ORDER_STATUS_LABELS } from '@/lib/kwik';
import { PAYMENT_METHOD_BADGES, PAYMENT_METHOD_LABELS } from '@/lib/payments-manual';
import { useToast } from '@/hooks/use-toast';

export interface KwikAdminOrder {
  id: number;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  items: { id: number; name: string; price_kz: number; quantity: number }[];
  total_kz: number;
  status: string;
  comprovativo_url: string | null;
  payment_method: string | null;
  payment_proof_name: string | null;
  payment_proof_type: string | null;
  has_payment_proof: boolean;
  admin_note: string | null;
  validated_at: string | null;
  created_at: string;
  /** Fase 21: auditoria da análise IA do comprovativo (JSONB — só admin). */
  ai_verification?: AiProofAudit | null;
}

/** Auditoria gravada por lib/ai-proof.ts (verifyOrderProof). */
export interface AiProofAudit {
  extracted: {
    valor: number | null;
    data: string | null;
    referencia: string | null;
    confianca: 'alta' | 'media' | 'baixa';
    notas: string;
  };
  expected: { total_kz: number; order_id: number };
  matched: { valor: boolean; referencia: boolean };
  verdict: 'aprovado' | 'revisao';
  motivo: string;
  model: string;
  provider: string;
  at: string;
}

const CONFIANCA_STYLES: Record<string, string> = {
  alta: 'bg-teal-500/15 text-teal-600',
  media: 'bg-amber-500/15 text-amber-600',
  baixa: 'bg-rose-500/15 text-rose-600',
};

interface ProofReviewListProps {
  orders: KwikAdminOrder[];
  loading: boolean;
  emptyMessage: string;
  onReload: () => void;
  onReview: (order: KwikAdminOrder, approve: boolean, note: string) => Promise<void>;
  /**
   * Fase 21 (visibilidade por perfil): o parecer da IA só é mostrado no
   * painel de admin TOTAL — admin_limitado continua a validar à mão.
   */
  showAi?: boolean;
}

export default function ProofReviewList({
  orders,
  loading,
  emptyMessage,
  onReload,
  onReview,
  showAi = false,
}: ProofReviewListProps) {
  const { toast } = useToast();
  const [openOrderId, setOpenOrderId] = useState<number | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofType, setProofType] = useState<string>('');
  const [proofName, setProofName] = useState<string>('comprovativo');
  const [proofLoadingId, setProofLoadingId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [deciding, setDeciding] = useState(false);

  /* Object URL atual — limpo ao fechar e no unmount */
  const proofUrlRef = useRef<string | null>(null);
  const rememberProofUrl = useCallback((url: string | null) => {
    if (proofUrlRef.current && proofUrlRef.current !== url) {
      URL.revokeObjectURL(proofUrlRef.current);
    }
    proofUrlRef.current = url;
    setProofUrl(url);
  }, []);

  useEffect(
    () => () => {
      if (proofUrlRef.current) URL.revokeObjectURL(proofUrlRef.current);
    },
    []
  );

  const closeDialog = useCallback(() => {
    setOpenOrderId(null);
    rememberProofUrl(null);
    setProofType('');
    setNote('');
  }, [rememberProofUrl]);

  async function openProofDialog(order: KwikAdminOrder) {
    setOpenOrderId(order.id);
    setNote(order.admin_note ?? '');
    setProofName(order.payment_proof_name ?? 'comprovativo');
    setProofLoadingId(order.id);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/proof`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: 'Comprovativo indisponível',
          description: data.error ?? `Erro ${res.status}.`,
        });
        setOpenOrderId(null);
        return;
      }
      const blob = await res.blob();
      setProofType(blob.type);
      rememberProofUrl(URL.createObjectURL(blob));
    } catch {
      toast({
        title: 'Erro de ligação',
        description: 'Não foi possível carregar o comprovativo.',
      });
      setOpenOrderId(null);
    } finally {
      setProofLoadingId(null);
    }
  }

  /** Decisão a partir do diálogo (usa a nota editada). */
  async function decide(approve: boolean) {
    const order = orders.find((o) => o.id === openOrderId);
    if (!order) return;
    setDeciding(true);
    try {
      await onReview(order, approve, note.trim());
      closeDialog();
    } finally {
      setDeciding(false);
    }
  }

  /** Aprovar/rejeitar diretamente na lista (mantém a nota existente). */
  async function quickReview(order: KwikAdminOrder, approve: boolean) {
    await onReview(order, approve, order.admin_note ?? '');
  }

  const openOrder = orders.find((o) => o.id === openOrderId) ?? null;
  const isImage = proofType.startsWith('image/');
  const dialogBusy = proofLoadingId === openOrderId;

  return (
    <>
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Smartphone className="h-4 w-4 text-blue-600" />
            Comprovativos de pagamentos ({orders.length})
          </h2>
          <Button variant="ghost" size="sm" onClick={onReload}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
        </div>

        {loading ? (
          <p className="flex items-center justify-center py-10 text-sm text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> A carregar…
          </p>
        ) : orders.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">{emptyMessage}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {orders.map((order) => (
              <li key={order.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        #{order.id} — {order.customer_name}{' '}
                        <span className="font-normal text-slate-400">
                          ({order.customer_phone})
                        </span>
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          ORDER_STATUS_BADGES[order.status] ?? 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {ORDER_STATUS_LABELS[order.status] ?? order.status}
                      </span>
                      {order.payment_method && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            PAYMENT_METHOD_BADGES[order.payment_method] ??
                            'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {PAYMENT_METHOD_LABELS[order.payment_method] ??
                            order.payment_method}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                      {buildKwikReference(order.id)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {order.items.map((i) => `${i.quantity}× ${i.name}`).join(' · ')}
                    </p>
                    <p className="text-xs text-slate-400">
                      {new Date(order.created_at).toLocaleString('pt-PT')}
                    </p>
                    {order.admin_note && (
                      <p className="mt-0.5 text-[11px] italic text-slate-400">
                        Nota: {order.admin_note}
                      </p>
                    )}

                    {/* Fase 21: resumo da análise IA (só admin total). */}
                    {showAi && order.ai_verification && (
                      <AiProofSummary audit={order.ai_verification} compact />
                    )}

                    {order.has_payment_proof ? (
                      <button
                        type="button"
                        onClick={() => openProofDialog(order)}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-sky-600 hover:underline"
                      >
                        <FileText className="h-3.5 w-3.5" /> Ver comprovativo
                        {order.payment_proof_name && (
                          <span className="font-normal text-slate-400">
                            ({order.payment_proof_name})
                          </span>
                        )}
                        {proofLoadingId === order.id && (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        )}
                      </button>
                    ) : order.comprovativo_url ? (
                      <a
                        href={order.comprovativo_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-sky-600 hover:underline"
                      >
                        <FileText className="h-3.5 w-3.5" /> Ver comprovativo (link){' '}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">
                        Sem comprovativo anexado
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-base font-bold text-blue-600">
                      {formatKz(order.total_kz)}
                    </span>
                    <Button
                      size="sm"
                      onClick={() => quickReview(order, true)}
                      className="h-9 bg-blue-600 text-white hover:bg-blue-700"
                    >
                      <CheckCircle2 className="mr-1 h-4 w-4" /> Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => quickReview(order, false)}
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

      {/* ── Diálogo: comprovativo + decisão ── */}
      <Dialog open={openOrderId !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent aria-describedby={undefined} className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Encomenda #{openOrder?.id} — {openOrder?.customer_name}
            </DialogTitle>
            <DialogDescription>
              {openOrder && (
                <>
                  {formatKz(openOrder.total_kz)} ·{' '}
                  <span className="font-mono">{buildKwikReference(openOrder.id)}</span> ·{' '}
                  {openOrder.customer_phone}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {/* Fase 21: parecer completo da IA antes da decisão (só admin). */}
          {showAi && openOrder?.ai_verification && (
            <AiProofSummary audit={openOrder.ai_verification} />
          )}

          {dialogBusy ? (
            <p className="flex items-center justify-center py-10 text-sm text-slate-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> A carregar comprovativo…
            </p>
          ) : proofUrl ? (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                {isImage ? (
                  <img
                    src={proofUrl}
                    alt={`Comprovativo da encomenda #${openOrderId}`}
                    className="mx-auto max-h-[50vh] w-auto object-contain"
                  />
                ) : (
                  <iframe
                    src={proofUrl}
                    title={`Comprovativo da encomenda #${openOrderId}`}
                    className="h-[50vh] w-full"
                  />
                )}
              </div>
              <a
                href={proofUrl}
                download={proofName}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-600 hover:underline"
              >
                <Download className="h-3.5 w-3.5" /> Descarregar ({proofName})
              </a>
            </div>
          ) : openOrder && !openOrder.has_payment_proof ? (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Esta encomenda não tem comprovativo KWiK anexado. Confirma o
              pagamento por outro meio antes de aprovar.
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="kwik-nota">Observações internas (opcional)</Label>
            <textarea
              id="kwik-nota"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="Ex.: valor confirmado na conta KWiK às 14:32"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => decide(false)}
              disabled={deciding}
              className="h-10 border-rose-300 text-rose-600 hover:bg-rose-50"
            >
              <XCircle className="mr-1.5 h-4 w-4" /> Rejeitar
            </Button>
            <Button
              onClick={() => decide(true)}
              disabled={deciding}
              className="h-10 bg-blue-600 text-white hover:bg-blue-700"
            >
              {deciding ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
              )}
              Aprovar (marcar como pago)
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ───────────────── Fase 21: parecer da IA (só admin total) ───────────────── */

/**
 * Mostra a auditoria da análise IA do comprovativo: valor extraído vs.
 * esperado, referência, data, confiança e a SUGESTÃO de decisão
 * (aprovado/revisão). A decisão final continua a ser do admin — a IA
 * nunca aprova nem rejeita sozinha sem cumprir a regra de segurança.
 */
export function AiProofSummary({
  audit,
  compact = false,
}: {
  audit: AiProofAudit;
  compact?: boolean;
}) {
  const aprovado = audit.verdict === 'aprovado';
  const confianca = audit.extracted?.confianca ?? 'baixa';

  if (compact) {
    return (
      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold ${
            aprovado ? 'bg-teal-500/15 text-teal-600' : 'bg-amber-500/15 text-amber-600'
          }`}
        >
          <Sparkles className="h-3 w-3" />
          IA sugere: {aprovado ? 'aprovar' : 'revisão'}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 font-semibold ${CONFIANCA_STYLES[confianca]}`}
        >
          confiança {confianca}
        </span>
        {typeof audit.extracted?.valor === 'number' && (
          <span className="text-slate-500">
            extraído {formatKz(audit.extracted.valor)}
          </span>
        )}
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs font-bold text-blue-800">
        <Sparkles className="h-3.5 w-3.5" /> Análise automática do comprovativo
        <span
          className={`ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
            aprovado ? 'bg-teal-500/15 text-teal-700' : 'bg-amber-500/15 text-amber-700'
          }`}
        >
          {aprovado ? <BadgeCheck className="h-3 w-3" /> : <ShieldQuestion className="h-3 w-3" />}
          sugere {aprovado ? 'aprovar' : 'revisão manual'}
        </span>
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-700">
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Valor extraído</dt>
          <dd className="font-semibold">
            {typeof audit.extracted?.valor === 'number'
              ? formatKz(audit.extracted.valor)
              : 'ilegível'}
            {typeof audit.extracted?.valor === 'number' && (
              <span className={audit.matched?.valor ? 'text-teal-600' : 'text-rose-600'}>
                {' '}
                ({audit.matched?.valor ? 'coincide' : 'não coincide'})
              </span>
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Esperado</dt>
          <dd className="font-semibold">{formatKz(audit.expected?.total_kz ?? 0)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Referência</dt>
          <dd className="max-w-[160px] truncate font-mono" title={audit.extracted?.referencia ?? ''}>
            {audit.extracted?.referencia ?? '—'}
            {audit.extracted?.referencia && (
              <span
                className={audit.matched?.referencia ? 'text-teal-600' : 'text-rose-600'}
              >
                {' '}
                ({audit.matched?.referencia ? 'ok' : 'sem n.º'})
              </span>
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Data / confiança</dt>
          <dd className="font-semibold">
            {audit.extracted?.data ?? '—'} · {confianca}
          </dd>
        </div>
      </dl>
      {audit.motivo && (
        <p className="mt-2 border-t border-blue-100 pt-2 text-[11px] leading-relaxed text-slate-600">
          {audit.motivo}
          {audit.extracted?.notas ? ` — ${audit.extracted.notas}` : ''}
        </p>
      )}
    </div>
  );
}
