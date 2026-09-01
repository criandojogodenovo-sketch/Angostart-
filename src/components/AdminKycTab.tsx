'use client';

/**
 * AngoStart — Aba «Verificação de Identidade» do admin (Fase 12 + Fase 13).
 * KYC orientado a FOTOS: lista vendedores com documento submetido
 * (BI / Passaporte / Cartão de Eleitor), mostra a foto em miniatura
 * (ampliável) e permite Aprovar (selo azul) ou Rejeitar (com motivo
 * — bloqueia publicação até reenvio).
 * Fase 13 — supervisão: lista vendedores OVERDUE (prazo de 30 dias
 * expirado sem documento) com ações «Reenviar aviso», «Aceitar
 * justificação» (reabre prazo de 30 dias e desbloqueia publicação) e
 * «Bloquear conta» (impede login e vendas).
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BadgeCheck, Clock, Info, Loader2, RefreshCw, ShieldCheck, ShieldOff, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { authHeaders } from '@/context/AuthContext';
import { formatDateTime } from '@/lib/format';
import SecureImage from '@/components/SecureImage';
import { KYC_DOCUMENT_TYPE_LABELS, type KycDocumentType } from '@/lib/kyc';

interface KycSeller {
  id: number;
  name: string;
  email: string;
  role: string;
  username: string | null;
  telefone: string | null;
  bi_number: string | null;
  nif_number: string | null;
  birth_date: string | null;
  kyc_status: string;
  is_verified_bi: boolean;
  kyc_document_url: string | null;
  kyc_document_type: string | null;
  kyc_rejection_reason: string | null;
  kyc_submitted_at: string | null;
  kyc_reviewed_at: string | null;
  created_at: string;
  /* Fase 13 */
  kyc_deadline: string | null;
  kyc_overdue_notified_at: string | null;
  blocked?: boolean;
}

interface KycStats {
  not_submitted: number;
  overdue: number;
  sem_data_nascimento: number;
}

const ROLE_LABEL: Record<string, string> = {
  criador: 'Criador',
  prestador_domicilio: 'Prestador ao domicílio',
  prestador_remoto: 'Freelancer remoto',
};

export default function AdminKycTab() {
  const { toast } = useToast();
  const [pending, setPending] = useState<KycSeller[]>([]);
  const [overdue, setOverdue] = useState<KycSeller[]>([]);
  const [verified, setVerified] = useState<KycSeller[]>([]);
  const [rejected, setRejected] = useState<KycSeller[]>([]);
  const [stats, setStats] = useState<KycStats>({ not_submitted: 0, overdue: 0, sem_data_nascimento: 0 });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null);
  /* Rejeição: id em edição + motivo */
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/kyc', { headers: authHeaders(), cache: 'no-store' });
      const data = (await res.json()) as {
        pending?: KycSeller[];
        overdue?: KycSeller[];
        verified?: KycSeller[];
        rejected?: KycSeller[];
        stats?: KycStats;
      };
      if (res.ok) {
        setPending(data.pending ?? []);
        setOverdue(data.overdue ?? []);
        setVerified(data.verified ?? []);
        setRejected(data.rejected ?? []);
        setStats(
          data.stats ?? { not_submitted: 0, overdue: 0, sem_data_nascimento: 0 }
        );
      }
    } catch {
      /* silencioso */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(
    userId: number,
    action: 'aprovar' | 'rejeitar' | 'avisar' | 'aceitar_justificacao' | 'bloquear',
    note?: string
  ) {
    setBusyId(userId);
    try {
      const res = await fetch('/api/admin/kyc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ user_id: userId, action, note }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({
          title: 'Ação não concluída',
          description: data.error,
          variant: 'destructive',
        });
        return;
      }
      const sucesso: Record<string, string> = {
        aprovar: 'Documento aprovado — o vendedor já tem o selo azul.',
        rejeitar: 'Documento recusado — publicação bloqueada; email enviado com o motivo.',
        avisar: 'Aviso reenviado — o vendedor recebe novo email e notificação.',
        aceitar_justificacao: 'Justificação aceite — prazo de 30 dias reaberto e publicação desbloqueada.',
        bloquear: 'Conta bloqueada — o vendedor não consegue entrar nem vender.',
      };
      toast({ title: 'Feito ✓', description: sucesso[action] });
      setRejectId(null);
      setRejectNote('');
      load();
    } catch {
      toast({ title: 'Erro de rede', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  }

  const renderSeller = (s: KycSeller, estado: 'pending' | 'overdue' | 'verified' | 'rejected') => (
    <li key={s.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
            {s.name}
            {estado === 'verified' && <BadgeCheck className="h-4 w-4 text-sky-500" />}
            {estado === 'rejected' && <XCircle className="h-4 w-4 text-rose-500" />}
            {estado === 'overdue' && <AlertTriangle className="h-4 w-4 text-orange-500" />}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {ROLE_LABEL[s.role] ?? s.role} · {s.email}
            {s.telefone ? ` · ${s.telefone}` : ''}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            {s.bi_number ? (
              <>
                BI: <span className="font-mono font-semibold">{s.bi_number}</span>
              </>
            ) : (
              <span className="text-slate-400">Sem número de BI indicado (opcional)</span>
            )}
            {s.nif_number ? ` · NIF: ${s.nif_number}` : ''}
          </p>
          <p className="text-xs text-slate-400">
            Conta criada em {formatDateTime(s.created_at)}
            {s.kyc_submitted_at ? ` · documento submetido em ${formatDateTime(s.kyc_submitted_at)}` : ''}
            {s.kyc_reviewed_at ? ` · revisão em ${formatDateTime(s.kyc_reviewed_at)}` : ''}
          </p>
          {/* Fase 12: alerta de data de nascimento em falta (idade ≥ 15) */}
          {!s.birth_date && (estado === 'pending' || estado === 'overdue') && (
            <p className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" /> Sem data de nascimento — pede ao vendedor
              (idade mínima 15 anos) durante a revisão.
            </p>
          )}
          {estado === 'overdue' && (
            <p className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-orange-50 px-2 py-1 text-xs font-semibold text-orange-700">
              <Clock className="h-3.5 w-3.5" /> Prazo expirado em{' '}
              {s.kyc_deadline ? formatDateTime(s.kyc_deadline) : '—'}
              {s.kyc_overdue_notified_at
                ? ` · aviso enviado em ${formatDateTime(s.kyc_overdue_notified_at)}`
                : ' · sem aviso registado'}
            </p>
          )}
          {estado === 'rejected' && s.kyc_rejection_reason && (
            <p className="mt-1 text-xs text-rose-600">
              <span className="font-semibold">Motivo da recusa:</span> {s.kyc_rejection_reason}
            </p>
          )}

          {/* Formulário de rejeição inline */}
          {rejectId === s.id && (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
              <Label htmlFor={`reject-note-${s.id}`} className="text-xs font-semibold text-rose-700">
                Motivo da rejeição (enviado ao vendedor por email)
              </Label>
              <Input
                id={`reject-note-${s.id}`}
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="Ex.: foto desfocada — envia uma foto legível do documento"
                className="mt-1.5 h-9 border-rose-200 bg-white"
                maxLength={500}
              />
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  disabled={busyId === s.id || rejectNote.trim().length === 0}
                  onClick={() => decide(s.id, 'rejeitar', rejectNote.trim())}
                  className="h-8 bg-rose-500 font-semibold text-white hover:bg-rose-600"
                >
                  {busyId === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Confirmar rejeição
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setRejectId(null);
                    setRejectNote('');
                  }}
                  className="h-8 border-slate-300 text-slate-600"
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {s.kyc_document_url ? (
            <button
              type="button"
              onClick={() => setPreview({ src: s.kyc_document_url!, name: s.name })}
              className="group relative"
              aria-label={`Ver documento de ${s.name}`}
            >
              <SecureImage
                src={s.kyc_document_url}
                alt={`Documento de ${s.name}`}
                className="h-16 w-24 rounded-lg border border-slate-200 object-cover transition group-hover:opacity-80"
              />
              <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-slate-900/0 text-[10px] font-bold text-transparent group-hover:bg-slate-900/40 group-hover:text-white">
                Ampliar
              </span>
            </button>
          ) : (
            <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-400">
              Sem foto submetida
            </span>
          )}
          <p className="text-[11px] font-medium text-slate-400">
            {s.kyc_document_type
              ? KYC_DOCUMENT_TYPE_LABELS[s.kyc_document_type as KycDocumentType] ?? s.kyc_document_type
              : 'Tipo não indicado'}
          </p>
          {estado === 'pending' && (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busyId === s.id}
                onClick={() => decide(s.id, 'aprovar')}
                className="h-9 bg-blue-600 font-semibold text-white hover:bg-blue-700"
              >
                {busyId === s.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <BadgeCheck className="mr-1 h-4 w-4" />
                )}
                Aprovar
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === s.id}
                onClick={() => {
                  setRejectId(s.id);
                  setRejectNote('');
                }}
                className="h-9 border-rose-200 text-rose-600 hover:bg-rose-50"
              >
                <XCircle className="mr-1 h-4 w-4" /> Recusar
              </Button>
            </div>
          )}
          {/* Fase 13: ações de supervisão para vendedores com prazo expirado */}
          {estado === 'overdue' && (
            <div className="flex flex-col items-end gap-2">
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === s.id}
                  onClick={() => decide(s.id, 'avisar')}
                  className="h-8 border-amber-300 text-amber-700 hover:bg-amber-50"
                >
                  {busyId === s.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1 h-3.5 w-3.5" />
                  )}
                  Reenviar aviso
                </Button>
                <Button
                  size="sm"
                  disabled={busyId === s.id}
                  onClick={() => decide(s.id, 'aceitar_justificacao')}
                  className="h-8 bg-blue-600 font-semibold text-white hover:bg-blue-700"
                >
                  {busyId === s.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                  )}
                  Aceitar justificação
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === s.id}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Bloquear a conta de ${s.name}? Deixa de conseguir entrar e vender (reversível na gestão de utilizadores).`
                      )
                    ) {
                      decide(s.id, 'bloquear');
                    }
                  }}
                  className="h-8 border-rose-300 text-rose-600 hover:bg-rose-50"
                >
                  {busyId === s.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldOff className="mr-1 h-3.5 w-3.5" />
                  )}
                  Bloquear conta
                </Button>
              </div>
              {s.kyc_document_url && (
                <p className="text-[11px] text-slate-400">
                  Este vendedor tem documento submetido — podes aprovar ou recusar na fila
                  correspondente após nova submissão.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );

  return (
    <section className="mt-6" aria-label="Verificação de identidade">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
          <ShieldCheck className="h-5 w-5 text-sky-500" /> Verificação de Identidade
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={load}
          className="h-9 border-slate-300 text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Atualizar
        </Button>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Vendedores podem vender sem verificação dentro da carência de 30 dias — aprovar dá o selo
        azul; recusar ou prazo expirado bloqueia a publicação de novos produtos até reenvio.
      </p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-600">
          <Info className="h-3.5 w-3.5" /> {stats.not_submitted} sem documento submetido
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 font-semibold text-orange-700">
          <AlertTriangle className="h-3.5 w-3.5" /> {stats.overdue} com prazo expirado (30 dias)
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5" /> {stats.sem_data_nascimento} sem data de
          nascimento
        </span>
      </div>

      {loading ? (
        <p className="flex items-center justify-center py-10 text-sm text-slate-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> A carregar fila de verificação…
        </p>
      ) : (
        <>
          <h3 className="mt-5 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-amber-600">
            <Clock className="h-4 w-4" /> Pendentes ({pending.length})
          </h3>
          {pending.length === 0 ? (
            <p className="mt-2 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">
              Sem documentos à espera de validação.
            </p>
          ) : (
            <ul className="mt-2 space-y-3">{pending.map((s) => renderSeller(s, 'pending'))}</ul>
          )}

          {/* Fase 13: fila de supervisão — prazo de 30 dias expirado sem documento */}
          <h3 className="mt-6 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-orange-600">
            <AlertTriangle className="h-4 w-4" /> Em supervisão — prazo expirado ({overdue.length})
          </h3>
          {overdue.length === 0 ? (
            <p className="mt-2 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">
              Nenhum vendedor excedeu o prazo de 30 dias.
            </p>
          ) : (
            <ul className="mt-2 space-y-3 border-l-4 border-orange-300 pl-3">
              {overdue.map((s) => renderSeller(s, 'overdue'))}
            </ul>
          )}

          <h3 className="mt-6 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-rose-600">
            <XCircle className="h-4 w-4" /> Recusados ({rejected.length})
          </h3>
          {rejected.length === 0 ? (
            <p className="mt-2 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">
              Nenhum documento recusado.
            </p>
          ) : (
            <ul className="mt-2 space-y-3">{rejected.map((s) => renderSeller(s, 'rejected'))}</ul>
          )}

          <h3 className="mt-6 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-sky-600">
            <BadgeCheck className="h-4 w-4" /> Verificados ({verified.length})
          </h3>
          {verified.length === 0 ? (
            <p className="mt-2 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">
              Ainda nenhum vendedor verificado.
            </p>
          ) : (
            <ul className="mt-2 space-y-3 opacity-90">
              {verified.map((s) => renderSeller(s, 'verified'))}
            </ul>
          )}
        </>
      )}

      {/* Ampliar documento (imagem já carregada de forma segura) */}
      {preview && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/70 p-6"
          onClick={() => setPreview(null)}
          role="dialog"
          aria-label={`Documento de ${preview.name}`}
        >
          <SecureImage
            src={preview.src}
            alt={`Documento de ${preview.name} (ampliado)`}
            className="max-h-[85dvh] max-w-full rounded-2xl border-4 border-white object-contain shadow-2xl"
          />
        </div>
      )}
    </section>
  );
}
